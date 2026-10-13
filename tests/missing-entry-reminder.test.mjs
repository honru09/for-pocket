import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.mjs';
import { createMissingEntryReminderService, hasRecordedToday, missingEntryReminderText, reminderEntries, reminderEntryOwner } from '../missing-entry-reminder.mjs';

const tokyo22 = Date.parse('2026-10-13T13:00:00.000Z');
const instant = value => new Date(value).toISOString();
const user = (id, timezone = 'Asia/Tokyo', language = 'zh') => ({ id, name: id, settings: { timezone, language }, activeCircleId: null });
const entry = (id, uid = '101', at = tokyo22 - 3600000, extra = {}) => ({
  id, ledgerId: uid, createdBy: uid, consumer: `u_${uid}`, type: 'expense', currency: 'JPY', amountMinor: 850,
  occurredAt: instant(at), createdAt: instant(at), ...extra,
});

function initialState() {
  return { version: 2, revision: 0, users: { '101': user('101'), '202': user('202') }, identities: { 'telegram:101': '101', 'telegram:202': '202' },
    ledgers: { '101': { expenses: [] }, '202': { expenses: [] } }, circles: {}, sessions: {}, links: {},
    telegram: { preferences: { '101': { chatId: '101', chatType: 'private', language: 'zh' }, '202': { chatId: '202', chatType: 'private', language: 'uk' } } } };
}

function memoryStore(state) {
  let queue = Promise.resolve();
  return { run(callback) { const task = queue.then(() => callback(state)); queue = task.catch(() => {}); return task; } };
}

function fixture(state = initialState(), options = {}) {
  const calls = [], store = memoryStore(state);
  const service = createMissingEntryReminderService({ store, now: () => tokyo22, callTelegram: async (method, params) => {
    calls.push({ method, params }); return { message_id: calls.length };
  }, ...options });
  return { state, store, calls, service };
}

test('22:00 reminders use each user timezone and recent Telegram language, with one send per local date', async () => {
  const state = initialState();
  state.users['202'].settings = { timezone: 'America/New_York', language: 'en' };
  state.users['101'].activeCircleId = 'shared';
  state.circles.shared = { id: 'shared', ledgerId: 'circle', members: ['101', '202'] };
  state.ledgers.circle = { settings: { timezone: 'America/New_York' }, expenses: [] };
  const f = fixture(state);
  assert.equal((await f.service.tick({ at: tokyo22 - 1 })).sent, 0);
  assert.equal((await f.service.tick()).sent, 1);
  assert.equal(f.calls[0].params.chat_id, '101');
  assert.equal(f.calls[0].params.text, missingEntryReminderText('zh'));
  assert.equal(f.calls[0].params.disable_notification, undefined);
  assert.equal((await f.service.tick({ at: tokyo22 + 15 * 60000 })).sent, 0);
  const newYork22 = Date.parse('2026-10-14T02:00:00.000Z');
  assert.equal((await f.service.tick({ at: newYork22 })).sent, 1);
  assert.equal(f.calls[1].params.chat_id, '202');
  assert.equal(f.calls[1].params.text, missingEntryReminderText('uk'), 'latest chat language wins over profile language');
  assert.equal((await f.service.tick({ at: tokyo22 + 86400000 })).sent, 1, 'next local day is a fresh reminder');
});

test('half-hour and quarter-hour timezones hit their local 22:00 and invalid timezone falls back to Tokyo', async () => {
  const state = initialState();
  state.users['101'].settings.timezone = 'Asia/Kathmandu';
  state.users['202'].settings.timezone = 'not/a-zone';
  const f = fixture(state);
  const kathmandu22 = Date.parse('2026-10-13T16:15:00.000Z');
  assert.equal((await f.service.tick({ at: kathmandu22 - 1 })).sent, 0);
  assert.equal((await f.service.tick({ at: kathmandu22 })).sent, 1);
  assert.equal(f.calls[0].params.chat_id, '101');
  assert.equal((await f.service.tick({ at: tokyo22 })).sent, 1);
  assert.equal(f.calls[1].params.chat_id, '202');
});

test('a partner record copied into the private ledger does not count as the owner recording today', async () => {
  const state = initialState();
  const partnerExpense = entry('partner', '202', tokyo22 - 1000, { createdBy: '101' });
  state.ledgers['101'].expenses.push(partnerExpense);
  state.ledgers['202'].expenses.push(structuredClone(partnerExpense));
  state.ledgers.circle = { expenses: [structuredClone(partnerExpense)] };
  const f = fixture(state);
  const result = await f.service.tick();
  assert.equal(result.sent, 1);
  assert.equal(f.calls[0].params.chat_id, '101');
  assert.equal(result.results.find(item => item.uid === '202').reason, 'already-recorded');
});

test('a user record in any circle counts once, including legacy author ownership and income/transfer', () => {
  const state = initialState();
  const created = entry('one', '101', tokyo22 - 1000, { ledgerId: 'circle' });
  state.ledgers.circle = { expenses: [created, structuredClone(created)] };
  assert.equal(reminderEntries(state).length, 1);
  assert.equal(hasRecordedToday(state, '101', { at: tokyo22 }), true);
  assert.equal(reminderEntryOwner(state, { consumer: 'old-role', createdBy: '101' }), '101');
  assert.equal(reminderEntryOwner(state, { consumer: 'u_202', createdBy: '101' }), '202');
  for (const extra of [{ type: 'income' }, { recordKind: 'transfer' }, { recordKind: 'reimbursement' }]) {
    state.ledgers.circle.expenses = [entry('one', '101', tokyo22 - 1000, extra)];
    assert.equal(hasRecordedToday(state, '101', { at: tokyo22 }), true);
  }
});

test('latest deletion wins over stale mirrors and a newer undo makes the record count again', () => {
  const state = initialState();
  const original = entry('gone');
  const deleted = { ...original, deletedAt: instant(tokyo22 - 1000), updatedAt: instant(tokyo22 - 1000) };
  state.ledgers['101'].expenses.push(original);
  state.ledgers.circle = { expenses: [deleted] };
  assert.equal(hasRecordedToday(state, '101', { at: tokyo22 }), false);
  state.ledgers['101'].expenses = [{ ...original, updatedAt: instant(tokyo22) }];
  assert.equal(hasRecordedToday(state, '101', { at: tokyo22 }), true);
});

test('local date boundaries exclude yesterday, future records and invalid amounts', async () => {
  const state = initialState();
  const localMidnight = Date.parse('2026-10-12T15:00:00.000Z');
  state.ledgers['101'].expenses = [entry('yesterday', '101', localMidnight - 1), entry('future', '101', tokyo22 + 1000),
    entry('bad-amount', '101', tokyo22, { amountMinor: 0 }), entry('bad-date', '101', tokyo22, { occurredAt: 'invalid', createdAt: 'invalid' })];
  assert.equal(hasRecordedToday(state, '101', { at: tokyo22 }), false);
  state.ledgers['101'].expenses.push(entry('midnight', '101', localMidnight));
  assert.equal(hasRecordedToday(state, '101', { at: tokyo22 }), true);
});

test('missing private bindings and group chats never receive personal reminders', async () => {
  const state = initialState();
  state.identities = {};
  state.telegram.preferences = { '101': { chatId: '-100123456', chatType: 'supergroup' }, '202': { chatId: '202', chatType: 'group' } };
  const f = fixture(state);
  assert.equal((await f.service.tick()).sent, 0);
  assert.equal(f.calls.length, 0);
  state.telegram.preferences['101'] = { chatId: '202', chatType: 'private' };
  state.identities['telegram:202'] = '202';
  const result = await f.service.tick();
  assert.equal(result.results.find(item => item.uid === '101').reason, 'no-private-chat', 'a stale preference cannot send to another account');
});

test('failed recipients retry alone, including after the 22:00 hour', async () => {
  const state = initialState(), calls = [];
  let failSecond = true;
  const f = fixture(state, { callTelegram: async (method, params) => {
    calls.push({ method, params });
    if (params.chat_id === '202' && failSecond) throw new Error('temporary network issue');
    return { message_id: calls.length };
  } });
  const first = await f.service.tick();
  assert.equal(first.sent, 1); assert.equal(first.failed, 1); assert.equal(first.ok, false);
  failSecond = false;
  const retry = await f.service.tick({ at: tokyo22 + 3600000 });
  assert.equal(retry.sent, 1); assert.equal(retry.failed, 0);
  assert.equal(calls.filter(item => item.params.chat_id === '101').length, 1);
  assert.equal(calls.filter(item => item.params.chat_id === '202').length, 2);
  assert.equal((await f.service.tick({ at: tokyo22 + 3600001 })).sent, 0);
});

test('retry rechecks the ledger and does not send after a user records a bill', async () => {
  const state = initialState();
  const f = fixture(state, { callTelegram: async () => { throw new Error('offline'); } });
  assert.equal((await f.service.tick()).failed, 2);
  state.ledgers['101'].expenses.push(entry('late-record', '101', tokyo22 + 1000));
  const retry = await f.service.tick({ at: tokyo22 + 2000 });
  assert.equal(retry.results.find(item => item.uid === '101').reason, 'already-recorded');
  assert.equal(retry.failed, 1);
});

test('overlapping ticks share a persisted claim and only one sends each reminder', async () => {
  const state = initialState();
  delete state.users['202'];
  let finishSend;
  const gate = new Promise(resolve => { finishSend = resolve; });
  const calls = [];
  const f = fixture(state, { callTelegram: async (method, params) => { calls.push(params); await gate; return { message_id: 1 }; } });
  const first = f.service.tick();
  await new Promise(resolve => setImmediate(resolve));
  const second = await f.service.tick();
  assert.equal(second.sent, 0);
  assert.equal(second.results[0].reason, 'processing');
  finishSend();
  assert.equal((await first).sent, 1);
  assert.equal(calls.length, 1);
});

test('sent reminder checkpoints survive store reloads and never leak between users', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'for-night-reminder-'));
  const state = initialState();
  await writeFile(path.join(dir, '_pocket-v2.json'), JSON.stringify(state));
  let store = createStore(dir), sends = 0;
  const options = { now: () => tokyo22, callTelegram: async () => ({ message_id: ++sends }) };
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  const first = createMissingEntryReminderService({ store, ...options });
  assert.equal((await first.tick()).sent, 2);
  await store.close();
  store = createStore(dir);
  const restored = createMissingEntryReminderService({ store, ...options });
  assert.equal((await restored.tick()).sent, 0);
  assert.equal(sends, 2);
});

test('a disabled Telegram sender does not mark reminders as delivered', async () => {
  const state = initialState();
  const service = createMissingEntryReminderService({ store: memoryStore(state), token: '', now: () => tokyo22 });
  assert.equal((await service.tick()).disabled, true);
  assert.equal(state.cron, undefined);
});

test('a successful Telegram reminder is not resent when its following disk flush fails', async () => {
  const state = initialState();
  delete state.users['202'];
  const f = fixture(state);
  let flushes = 0;
  f.store.flush = async () => { if (++flushes === 2) throw new Error('temporary disk failure'); };
  assert.equal((await f.service.tick()).failed, 1);
  assert.equal(state.cron.missingEntryReminders['101:2026-10-13'].status, 'sent');
  assert.equal((await f.service.tick({ at: tokyo22 + 60000 })).sent, 0);
  assert.equal(f.calls.length, 1);
});

test('all reminder languages mention a voice note and month-end without technology language', () => {
  assert.match(missingEntryReminderText('zh'), /语音.*月底/);
  assert.match(missingEntryReminderText('en'), /voice note.*month-end/);
  assert.match(missingEntryReminderText('uk'), /голосове.*місяця/);
  for (const language of ['zh', 'en', 'uk']) assert.doesNotMatch(missingEntryReminderText(language), /\bAI\b|智能|нейромереж|assistant/i);
});
