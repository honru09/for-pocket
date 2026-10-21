import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm, mkdir, rename, rmdir } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

const token = '123456789:expense-notification-fixture';
const webhookSecret = 'expense-notification-fixture-secret';
const at = Date.parse('2026-10-13T03:00:00.000Z');

function signed(id) {
  const fields = { auth_date: String(Math.floor(at / 1000)), user: JSON.stringify({ id, first_name: `Member ${id}`, language_code: 'en' }) };
  const text = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', key).update(text).digest('hex') }).toString();
}

async function fixture(t, { asyncPersist = false } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-expense-notification-routes-'));
  const calls = [];
  const app = createApp({ dataDir, token, webhookSecret, now: () => at, asyncPersist,
    storeOptions: { debounceMs: 60000, logger: { error() {} } },
    aiParser: { enabled: false }, aiSummarizer: { enabled: false }, aiChat: { enabled: false },
    reactionOptions: { localTimers: false }, enqueueReactionTask: null,
    callTelegram: async (method, parameters) => {
      calls.push({ method, parameters: structuredClone(parameters) });
      return { message_id: 100 + calls.length };
    },
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-expense-notification-routes-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  async function request(route, { user = 101, body, method = body === undefined ? 'GET' : 'POST', headers = {}, expectedStatus = 200 } = {}) {
    const response = await fetch(base + '/api' + route, { method,
      headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Telegram-Init-Data': signed(user) } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify(data));
    return data;
  }
  const created = await request('/circles/create', { body: { name: 'Two' } });
  const circleId = created.social.activeCircleId;
  const invited = await request('/circles/invite', { body: { circleId } });
  await request('/circles/join', { user: 202, body: { code: invited.code, confirm: true } });
  // Bind each private Telegram destination through the real webhook handler.
  // All Bot API effects are intercepted by callTelegram above.
  for (const id of [101, 202]) await request('/telegram/webhook', { user: null,
    headers: { 'X-Telegram-Bot-Api-Secret-Token': webhookSecret },
    body: { update_id: id, message: { message_id: id, date: Math.floor(at / 1000),
      chat: { id, type: 'private' }, from: { id, first_name: `Member ${id}`, language_code: 'en' }, text: '/start' } },
  });
  calls.length = 0;
  const expense = (id, user = 101) => ({ id, ledgerId: created.ledgerId, consumer: `u_${user}`,
    amountMinor: 850, currency: 'JPY', categoryId: 'stomach', type: 'expense', note: 'Ramen', timezone: 'Asia/Tokyo' });
  return { request, expense, calls, ledgerId: created.ledgerId, app, dataDir };
}

function assertPartnerOnly(calls, chatId, count) {
  const sent = calls.filter(call => call.method === 'sendMessage');
  assert.equal(sent.length, count);
  assert.ok(sent.every(call => String(call.parameters.chat_id) === String(chatId)), 'only the partner receives expense notifications');
  assert.ok(sent.every(call => call.parameters.disable_notification === true), 'all notifications remain silent');
}

test('HTTP expense creation excludes its recorder, including idempotent retries and either partner', async t => {
  const f = await fixture(t);
  const payload = f.expense('web-notification-101');
  await f.request('/expenses', { body: payload });
  await f.request('/expenses', { body: payload });
  assertPartnerOnly(f.calls, 202, 1);
  f.calls.length = 0;
  await f.request('/expenses', { user: 202, body: f.expense('web-notification-202', 202) });
  assertPartnerOnly(f.calls, 101, 1);
});

test('HTTP batch expense imports notify only the partner for every saved entry', async t => {
  const f = await fixture(t);
  await f.request('/expenses/import', { body: { ledgerId: f.ledgerId,
    entries: [f.expense('web-import-notify-1'), f.expense('web-import-notify-2')] } });
  assertPartnerOnly(f.calls, 202, 2);
});

test('HTTP delete and restore reuse the partner notification without sending one to the recorder', async t => {
  const f = await fixture(t);
  const entry = await f.request('/expenses', { body: f.expense('web-restore-notify') });
  assertPartnerOnly(f.calls, 202, 1);
  const original = f.calls.find(call => call.method === 'sendMessage');
  f.calls.length = 0;
  await f.request(`/expenses/${entry.id}`, { method: 'DELETE' });
  const deleted = f.calls.filter(call => call.method === 'deleteMessage');
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].parameters.chat_id, original.parameters.chat_id);
  f.calls.length = 0;
  await f.request(`/expenses/${entry.id}/restore`, { body: {} });
  assertPartnerOnly(f.calls, 202, 1);
});

async function blockSnapshot(f) {
  await f.app.flushStore();
  const snapshot = path.join(f.dataDir, '_pocket-v2.json'), backup = path.join(f.dataDir, '_pocket-v2.fixture-backup');
  assert.equal(path.dirname(snapshot), f.dataDir);
  assert.equal(path.dirname(f.dataDir), path.resolve(os.tmpdir()));
  await rename(snapshot, backup);
  await mkdir(snapshot);
  return async () => {
    // This is the empty directory created above, not a data-tree deletion.
    await rmdir(snapshot);
    await rename(backup, snapshot);
  };
}

test('a failed HTTP expense flush sends no success card; the same id retries once after recovery', async t => {
  const f = await fixture(t), payload = f.expense('web-flush-failure-1');
  const restore = await blockSnapshot(f);
  try {
    await f.request('/expenses', { body: payload, expectedStatus: 500 });
    assert.equal(f.calls.length, 0, 'unpersisted expenses must not be announced');
  } finally { await restore(); }
  await f.request('/expenses', { body: payload });
  await f.request('/expenses', { body: payload });
  assertPartnerOnly(f.calls, 202, 1);
  const profile = await f.request('/profile');
  assert.equal(profile.expenses.filter(entry => entry.id === payload.id).length, 1);
});

test('failed edit persistence leaves the existing Telegram card unchanged until a successful retry', async t => {
  const f = await fixture(t), payload = f.expense('web-edit-flush-1');
  await f.request('/expenses', { body: payload });
  f.calls.length = 0;
  const restore = await blockSnapshot(f);
  const patch = { note: 'Changed after persistence', ledgerId: f.ledgerId };
  try {
    await f.request(`/expenses/${payload.id}`, { method: 'PATCH', body: patch, expectedStatus: 500 });
    assert.equal(f.calls.length, 0);
  } finally { await restore(); }
  await f.request(`/expenses/${payload.id}`, { method: 'PATCH', body: patch });
  await f.request(`/expenses/${payload.id}`, { method: 'PATCH', body: patch });
  assert.equal(f.calls.filter(call => call.method === 'editMessageText').length, 1);
});

test('explicit background persistence responds immediately but defers companion delivery until durable', async t => {
  const f = await fixture(t, { asyncPersist: true }), payload = f.expense('web-async-flush-1');
  const restore = await blockSnapshot(f);
  try {
    await f.request('/expenses', { body: payload });
    await assert.rejects(f.app.flushStore());
    assert.equal(f.calls.length, 0);
  } finally { await restore(); }
  await f.request('/expenses', { body: payload });
  await f.request('/expenses', { body: payload });
  // Closing drains background delivery before checking its durable bindings.
  await new Promise((resolve, reject) => f.app.close(error => error ? reject(error) : resolve()));
  assertPartnerOnly(f.calls, 202, 1);
});
