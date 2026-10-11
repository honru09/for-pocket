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
