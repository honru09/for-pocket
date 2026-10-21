import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.mjs';
import { createTelegramHandler } from '../telegram-ai.mjs';
import { createTelegramExpenseSync, expenseNotificationText } from '../telegram-expense-sync.mjs';

const at = Date.parse('2026-10-12T03:00:00.000Z');

async function storeFixture(t, state = null) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'for-chat-sync-'));
  if (state) await writeFile(path.join(dir, '_pocket-v2.json'), JSON.stringify(state));
  const store = createStore(dir);
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, store };
}

const message = (id, text) => ({ update_id: id, message: {
  message_id: id, date: Math.floor(at / 1000), chat: { id: 101, type: 'private' },
  from: { id: 101, first_name: 'Kojun', language_code: 'zh' }, text,
} });

test('ordinary Telegram conversation is answered in the chat branch', async t => {
  const { store } = await storeFixture(t), calls = [], parsed = [];
  const handler = createTelegramHandler({ store, now: () => at, aiParser: {
    async parse(input) { parsed.push(input); return []; },
    async chat(input) { assert.equal(input.language, 'zh'); return '哇哦，今天也辛苦啦，先去吃点热乎的，哼哼。'; },
  }, callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 5 }; } });
  const result = await handler.handle(message(1, '今天上班好累'));
  assert.equal(result.kind, 'chat');
  assert.equal(parsed.length, 0);
  assert.match(calls[0].params.text, /辛苦/);
  assert.equal(calls[0].params.disable_notification, true);
  const db = await store.run(value => structuredClone(value));
  assert.equal(db.telegram.preferences['101'].chatId, '101');
});

test('a spending sentence still uses the existing parser', async t => {
  const { store } = await storeFixture(t), calls = [], parsed = [];
  const handler = createTelegramHandler({ store, now: () => at, aiParser: {
    async parse(input) { parsed.push(input); return [{ type: 'expense', amountMinor: 850, currency: 'JPY', categoryId: 'stomach', occurredAt: new Date(at).toISOString(), timezone: 'Asia/Tokyo' }]; },
    async chat() { throw new Error('chat should not run'); },
  }, callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 5 }; } });
  const result = await handler.handle(message(2, '午饭拉面 850 日元'));
  assert.equal(result.kind, 'draft');
  assert.equal(parsed.length, 1);
  assert.match(calls[0].params.text, /850/);
  assert.equal(calls[0].params.disable_notification, true);
});

test('ordinary numbers and future shopping plans stay in conversation while bare amounts remain recordable', async t => {
  const { store } = await storeFixture(t), calls = [], parsed = [];
  const handler = createTelegramHandler({ store, now: () => at, aiParser: {
    async parse(input) { parsed.push(input); return [{ type: 'expense', amountMinor: 850, currency: 'JPY', categoryId: 'stomach', occurredAt: new Date(at).toISOString(), timezone: 'Asia/Tokyo' }]; },
    async chat({ text }) { return `chat:${text}`; },
  }, callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 5 }; } });
  assert.equal((await handler.handle(message(4, 'I have 2 cats'))).kind, 'chat');
  assert.equal((await handler.handle(message(5, '明天买面包'))).kind, 'chat');
  assert.equal((await handler.handle(message(6, '850'))).kind, 'draft');
  assert.equal(parsed.length, 1);
});

test('auto confirmation also hands saved entries to the companion sync hook', async t => {
  const notified = [];
  const { store } = await storeFixture(t);
  const handler = createTelegramHandler({ store, autoConfirm: true, expenseSync: { async notify(entry, options) { notified.push({ entry, options }); } }, aiParser: {
    async parse() { return [{ amountMinor: 850, currency: 'JPY', type: 'expense', categoryId: 'stomach', categoryLabel: '胃', occurredAt: new Date(at).toISOString(), timezone: 'Asia/Tokyo' }]; },
  }, callTelegram: async () => ({ message_id: 8 }), now: () => at });
  const result = await handler.handle(message(3, '午饭拉面 850 日元'));
  assert.equal(result.kind, 'confirmed');
  assert.equal(notified.length, 1);
  assert.equal(String(notified[0].options.excludeChatId), '101');
  assert.equal(notified[0].entry.amountMinor, 850);
});

function syncState() {
  const member = (id, name) => ({ id, name, color: 'blue', avatar: 'cloud', settings: { currency: 'JPY', language: id === '101' ? 'zh' : 'en', timezone: 'Asia/Tokyo' } });
  const entry = { id: 'sync-entry-1', ledgerId: 'cir_ledger', type: 'expense', amountMinor: 850, currency: 'JPY', categoryId: 'stomach', category: { id: 'stomach', label: '胃', icon: 'bowl', color: 'peach' }, consumer: 'u_101', member: { id: 'u_101', name: 'Kojun' }, note: '拉面', occurredAt: new Date(at).toISOString() };
  return { version: 2, revision: 0,
    users: { '101': member('101', 'Kojun'), '202': member('202', 'Liia') },
    identities: { 'telegram:101': '101', 'telegram:202': '202' }, sessions: {}, links: {},
    circles: { c1: { id: 'c1', name: 'Two', members: ['101', '202'], admins: ['101'], ledgerId: 'cir_ledger', invite: null } },
    ledgers: { cir_ledger: { settings: { currency: 'JPY', language: 'zh', timezone: 'Asia/Tokyo', categories: [entry.category] }, expenses: [entry] } },
    telegram: { preferences: { '101': { chatId: '101', language: 'zh' }, '202': { chatId: '202', language: 'en' } }, expenseMessages: {} },
  };
}

test('expense notifications are silent and edits/deletes reuse stored Telegram messages', async t => {
  const { store } = await storeFixture(t, syncState()), calls = [];
  const sync = createTelegramExpenseSync({ store, now: () => at, callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 100 + calls.length }; } });
  const entry = await store.run(db => structuredClone(db.ledgers.cir_ledger.expenses[0]));
  const sent = await sync.notify(entry);
  assert.equal(sent.sent, 2);
  assert.equal(calls.filter(item => item.method === 'sendMessage').every(item => item.params.disable_notification === true), true);
  assert.match(calls[0].params.text, /Kojun|850/);
  await sync.sync({ ...entry, note: '改过的拉面' }, 'edit');
  assert.equal(calls.filter(item => item.method === 'editMessageText').length, 2);
  await sync.sync({ ...entry, deletedAt: new Date(at).toISOString() }, 'delete');
  assert.equal(calls.filter(item => item.method === 'deleteMessage').length, 2);
  const db = await store.run(value => structuredClone(value));
  assert.deepEqual(db.telegram.expenseMessages, {});
  assert.match(expenseNotificationText(entry, 'uk'), /850/);
});

test('expense notification fan-out excludes the Telegram account that recorded it', async t => {
  const { store } = await storeFixture(t, syncState()), calls = [];
  const sync = createTelegramExpenseSync({ store, now: () => at, callTelegram: async (method, params) => {
    calls.push({ method, params }); return { message_id: 900 + calls.length };
  } });
  const entry = await store.run(db => structuredClone(db.ledgers.cir_ledger.expenses[0]));
  const result = await sync.notify(entry, { excludeUid: '101' });
  assert.equal(result.sent, 1);
  assert.deepEqual(calls.map(item => item.params.chat_id), ['202']);
  assert.equal(calls[0].params.disable_notification, true);
});

for (const chatType of [undefined, 'supergroup']) test(`expense notifications reject negative chat ids with ${chatType || 'missing'} chat type`, async t => {
  const fixture = syncState();
  fixture.telegram.preferences['101'] = { chatId: '-100555', chatType, language: 'en' };
  const { store } = await storeFixture(t, fixture), calls = [];
  const sync = createTelegramExpenseSync({ store, callTelegram: async (method, params) => {
    calls.push({ method, params }); return { message_id: 901 };
  } });
  const entry = await store.run(db => structuredClone(db.ledgers.cir_ledger.expenses[0]));
  const result = await sync.notify(entry);
  assert.equal(result.sent, 1);
  assert.deepEqual(calls.map(call => call.params.chat_id), ['202']);
  assert.equal(calls[0].params.disable_notification, true);
});

test('expense sync deduplicates concurrent sends and never leaks a personal ledger', async t => {
  const fixture = syncState();
  const { store } = await storeFixture(t, fixture);
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const sync = createTelegramExpenseSync({ store, now: () => at, callTelegram: async (method, params) => {
    calls.push({ method, params });
    await gate;
    return { message_id: 500 + calls.length };
  } });
  const entry = await store.run(db => structuredClone(db.ledgers.cir_ledger.expenses[0]));
  const first = sync.notify(entry);
  const second = sync.notify(entry);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(calls.filter(item => item.method === 'sendMessage').length, 2);
  assert.equal(results[0].sent + results[1].sent, 2);

  const personal = structuredClone(fixture);
  personal.circles = {};
  personal.ledgers = { '101': { settings: personal.ledgers.cir_ledger.settings, expenses: [entry] } };
  personal.ledgers['101'].expenses[0].ledgerId = '101';
  const personalStore = await storeFixture(t, personal);
  t.after(() => personalStore.store.close());
  const personalCalls = [];
  const personalSync = createTelegramExpenseSync({ store: personalStore.store, callTelegram: async (...args) => { personalCalls.push(args); return { message_id: 1 }; } });
  const personalEntry = await personalStore.store.run(db => structuredClone(db.ledgers['101'].expenses[0]));
  assert.equal((await personalSync.notify(personalEntry)).sent, 0);
  assert.equal(personalCalls.length, 0);
});

test('failed Telegram sends and edits remain retryable', async t => {
  const { store } = await storeFixture(t, syncState());
  const entry = await store.run(db => structuredClone(db.ledgers.cir_ledger.expenses[0]));
  let failSend = true;
  const calls = [];
  const sync = createTelegramExpenseSync({ store, now: () => at, callTelegram: async (method, params) => {
    calls.push({ method, params });
    if (method === 'sendMessage' && failSend && params.chat_id === '202') throw new Error('temporary');
    if (method === 'editMessageText' && params.chat_id === '101') throw new Error('temporary edit');
    return { message_id: 700 + calls.length };
  } });
  assert.equal((await sync.notify(entry)).sent, 1);
  failSend = false;
  assert.equal((await sync.notify(entry)).sent, 1);
  const stateAfterRetry = await store.run(db => structuredClone(db.telegram.expenseMessages['cir_ledger:sync-entry-1']));
  assert.equal(stateAfterRetry.length, 2);
  await sync.sync({ ...entry, note: 'updated' }, 'edit');
  const stateAfterEdit = await store.run(db => structuredClone(db.telegram.expenseMessages['cir_ledger:sync-entry-1']));
  assert.equal(stateAfterEdit.length, 2);
  assert.equal(stateAfterEdit.some(item => item.lastError), true);
  assert.equal(calls.filter(item => item.method === 'editMessageText').length, 2);
  await sync.sync({ ...entry, note: 'updated' }, 'edit');
  assert.equal(calls.filter(item => item.method === 'editMessageText').length, 3);
});

test('income companion cards use received wording instead of spent', async () => {
  assert.match(expenseNotificationText({ type: 'income', amountMinor: 1000, currency: 'JPY', member: { name: 'Kojun' } }, 'en'), /received/);
  assert.doesNotMatch(expenseNotificationText({ type: 'income', amountMinor: 1000, currency: 'JPY', member: { name: 'Kojun' } }, 'en'), /spent/);
});

test('departed members lose old companion bindings before edits, deletes, or retries', async t => {
  const { store } = await storeFixture(t, syncState()), calls = [];
  const sync = createTelegramExpenseSync({ store, callTelegram: async (method, params) => {
    calls.push({ method, params }); return { message_id: 1000 + calls.length };
  } });
  const entry = await store.run(db => structuredClone(db.ledgers.cir_ledger.expenses[0]));
  await sync.notify(entry);
  await store.run(db => { db.circles.c1.members = ['101']; });
  calls.length = 0;
  await sync.sync({ ...entry, note: 'private update' }, 'edit');
  await sync.retry({ ...entry, note: 'private retry' }, 'edit');
  await sync.sync(entry, 'delete');
  assert.ok(calls.length > 0, 'remaining circle member still receives edits and deletion');
  assert.ok(calls.every(call => call.params.chat_id === '101'));
  assert.deepEqual(await store.run(db => db.telegram.expenseMessages), {});
});

test('companion dispatch rechecks membership while another recipient request is in flight', async t => {
  const { store } = await storeFixture(t, syncState()), calls = [];
  const sync = createTelegramExpenseSync({ store, callTelegram: async (method, params) => {
    calls.push({ method, params });
    if (params.chat_id === '101') await store.run(db => { db.circles.c1.members = ['101']; });
    return { message_id: 2000 + calls.length };
  } });
  const entry = await store.run(db => structuredClone(db.ledgers.cir_ledger.expenses[0]));
  assert.equal((await sync.notify(entry)).sent, 1);
  assert.deepEqual(calls.map(call => call.params.chat_id), ['101']);
});

test('old companion cards cannot follow a private chat rebound to a different identity', async t => {
  const { store } = await storeFixture(t, syncState()), calls = [];
  const sync = createTelegramExpenseSync({ store, callTelegram: async (method, params) => {
    calls.push({ method, params }); return { message_id: 3000 + calls.length };
  } });
  const entry = await store.run(db => structuredClone(db.ledgers.cir_ledger.expenses[0]));
  await sync.notify(entry);
  await store.run(db => { db.identities['telegram:202'] = '101'; });
  calls.length = 0;
  await sync.sync({ ...entry, note: 'changed identity' }, 'edit');
  await sync.notify(entry);
  assert.ok(calls.every(call => call.params.chat_id !== '202'));
});

test('legacy companion bindings are reauthorized individually during an edit batch', async t => {
  const fixture = syncState();
  fixture.telegram.expenseMessages['cir_ledger:sync-entry-1'] = [{ chatId: '101', messageId: 1 }, { chatId: '202', messageId: 2 }];
  const { store } = await storeFixture(t, fixture), calls = [];
  const sync = createTelegramExpenseSync({ store, callTelegram: async (method, params) => {
    calls.push({ method, params });
    if (params.chat_id === '101') await store.run(db => { db.circles.c1.members = ['101']; });
    return true;
  } });
  const entry = await store.run(db => structuredClone(db.ledgers.cir_ledger.expenses[0]));
  assert.equal((await sync.sync({ ...entry, note: 'legacy card update' }, 'edit')).synced, 1);
  assert.deepEqual(calls.map(call => call.params.chat_id), ['101']);
  const bindings = await store.run(db => db.telegram.expenseMessages['cir_ledger:sync-entry-1']);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].uid, '101');
});

test('a persistence failure after capturing a companion snapshot blocks delivery and remains retryable', async t => {
  const { store } = await storeFixture(t, syncState()), calls = [];
  let failPersistence = true;
  const sync = createTelegramExpenseSync({ store,
    beforeDeliver: async () => {
      if (failPersistence) throw new Error('injected persistence failure');
      await store.flush();
    },
    callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 5000 + calls.length }; },
  });
  const entry = await store.run(db => structuredClone(db.ledgers.cir_ledger.expenses[0]));
  assert.equal((await sync.notify(entry, { excludeUid: '101' })).sent, 0);
  assert.equal(calls.length, 0);
  failPersistence = false;
  assert.equal((await sync.notify(entry, { excludeUid: '101' })).sent, 1);
  failPersistence = true;
  await sync.sync({ ...entry, note: 'not durable' }, 'edit');
  await sync.sync(entry, 'delete');
  assert.equal(calls.length, 1, 'failed update/delete persistence cannot change the card');
  failPersistence = false;
  assert.equal((await sync.sync(entry, 'delete')).synced, 1);
});

for (const action of ['notify', 'edit', 'delete']) test(`membership revoked during the persistence gate blocks ${action}`, async t => {
  const fixture = syncState();
  if (action !== 'notify') fixture.telegram.expenseMessages['cir_ledger:sync-entry-1'] = [{ chatId: '202', uid: '202', messageId: 10 }];
  const { store } = await storeFixture(t, fixture), calls = [];
  const sync = createTelegramExpenseSync({ store,
    beforeDeliver: () => store.run(db => { db.circles.c1.members = ['101']; }),
    callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 11 }; },
  });
  const entry = await store.run(db => structuredClone(db.ledgers.cir_ledger.expenses[0]));
  if (action === 'notify') assert.equal((await sync.notify(entry, { excludeUid: '101' })).sent, 0);
  else assert.equal((await sync.sync({ ...entry, note: 'changed' }, action)).synced, 0);
  assert.equal(calls.length, 0);
  assert.equal(await store.run(db => db.telegram.expenseMessages['cir_ledger:sync-entry-1']), undefined);
});
