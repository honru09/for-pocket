import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { missingEntryReminderText } from '../missing-entry-reminder.mjs';

const token = '123456789:http-reactions-fixture', cronSecret = 'http-reactions-test-secret';
const start = Date.parse('2026-10-13T00:00:00.000Z');
function signed(id, at) {
  const fields = { auth_date: String(Math.floor(at / 1000)), user: JSON.stringify({ id, first_name: id === 101 ? 'Kojun' : 'Cheese', language_code: id === 101 ? 'zh' : 'uk' }) };
  const data = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(data).digest('hex') }).toString();
}

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-reaction-routes-'));
  let app, base, at = start, serial = 0, failSend = false, failTask = false;
  const calls = [], tasks = [];
  const close = () => new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
  async function startApp() {
    app = createApp({ dataDir, token, cronSecret, now: () => at, publicUrl: 'https://pocket.example',
      aiParser: { enabled: false }, aiSummarizer: { enabled: false }, aiChat: { enabled: false },
      reactionOptions: { localTimers: false },
      enqueueReactionTask: async task => { if (failTask) throw new Error('queue temporarily unavailable'); tasks.push(structuredClone(task)); return { name: `fixture-task-${tasks.length}` }; },
      callTelegram: async (method, parameters) => { calls.push({ method, parameters: structuredClone(parameters) }); if (failSend) throw new Error('mock Telegram unavailable'); return { message_id: 100 + calls.length }; },
    });
    app.listen(0, '127.0.0.1'); await once(app, 'listening');
    base = `http://127.0.0.1:${app.address().port}`;
  }
  await startApp();
  t.after(async () => { await close(); assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir())); assert.ok(path.basename(dataDir).startsWith('for-reaction-routes-')); await rm(dataDir, { recursive: true, force: true }); });
  async function request(route, { user, body, secret, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Telegram-Init-Data': signed(user, at) } : {}), ...(secret === undefined ? {} : { 'X-Cron-Secret': secret }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  const created = await request('/api/circles/create', { user: 101, body: { name: 'Two' } });
  assert.equal(created.status, 200);
  const circleId = created.body.social.activeCircleId, ledgerId = created.body.ledgerId;
  const invited = await request('/api/circles/invite', { user: 101, body: { circleId } });
  assert.equal((await request('/api/circles/join', { user: 202, body: { code: invited.body.code, confirm: true } })).status, 200);
  return { request, circleId, ledgerId, calls, tasks,
    advance: ms => { at += ms; }, failTelegram: value => { failSend = value; }, failEnqueue: value => { failTask = value; },
    send: (id = `route-reaction-${String(++serial).padStart(6, '0')}`, emoji = '❤️', user = 101) => request('/api/circles/reactions', { user, body: { id, emoji, recipientId: 'u_202', circleId, ledgerId } }),
    worker: (body, secret = cronSecret) => request('/api/cron/reactions', { secret, body }),
    restart: async () => { await close(); await startApp(); },
    persisted: async () => { await app.flushStore(); return JSON.parse(await readFile(path.join(dataDir, '_pocket-v2.json'), 'utf8')); },
  };
}

test('reaction HTTP routes require user authentication and the worker requires its independent cron secret', async t => {
  const f = await fixture(t);
  assert.equal((await f.send('route-anonymous', '❤️', null)).status, 401);
  const first = await f.send(); assert.equal(first.status, 200);
  assert.equal((await f.request('/api/cron/reactions', { body: first.body })).status, 401);
  assert.equal((await f.worker(first.body, 'wrong-secret')).status, 401);
  assert.equal((await f.request('/api/cron/reactions', { user: 101, body: first.body })).status, 401, 'a normal Telegram session cannot invoke the worker');
  assert.equal((await f.worker({ circleId: f.circleId })).status, 400);
  assert.equal((await f.request('/api/cron/tick', { body: {} })).status, 401);
  assert.equal(f.calls.length, 0);
});

test('HTTP ten-tap burst schedules once and the worker sends one silent notification at the last tap plus thirteen seconds', async t => {
  const f = await fixture(t);
  let last;
  for (let i = 0; i < 10; i++) { if (i) f.advance(200); const sent = await f.send(); assert.equal(sent.status, 200); last = sent.body; }
  assert.equal(last.burstCount, 10); assert.equal(f.tasks.length, 1); assert.equal(f.calls.length, 0);
  const inbox = await f.request('/api/circles/reactions', { user: 202 });
  assert.equal(inbox.body.items.length, 10);
  assert.deepEqual(inbox.body.items.map(item => item.burstIndex), Array.from({ length: 10 }, (_, i) => i + 1));
  assert.ok(inbox.body.items.every(item => item.burstId === last.burstId && item.burstCount === 10));
  f.advance(12999);
  const early = await f.worker({ ...f.tasks[0], at: Date.parse('2099-01-01T00:00:00Z') });
  assert.equal(early.status, 200); assert.equal(early.body.sent, 0); assert.equal(f.calls.length, 0, 'worker ignores a caller-supplied clock');
  assert.equal(f.tasks.length, 2);
  f.advance(1);
  const delivered = await f.worker(f.tasks[1]);
  assert.equal(delivered.status, 200); assert.equal(delivered.body.sent, 1);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { method: 'sendMessage', parameters: { chat_id: '202', text: 'Від Kojun тобі ❤️ ×10', disable_notification: true } });
  const retries = await Promise.all([f.worker(f.tasks[0]), f.worker(f.tasks[1])]);
  assert.ok(retries.every(item => item.status === 200 && item.body.sent === 0));
  assert.equal(f.calls.length, 1);
});

test('closing and restarting preserves pending delivery and the successful checkpoint', async t => {
  const f = await fixture(t);
  const first = await f.send();
  const saved = await f.persisted();
  assert.equal(saved.circles[f.circleId].reactionBursts[0].notification.enqueuedFor, f.tasks[0].scheduledFor);
  await f.restart(); f.advance(13000);
  assert.equal((await f.worker(f.tasks[0])).body.sent, 1); assert.equal(f.calls.length, 1);
  await f.restart();
  assert.equal((await f.worker(first.body)).body.sent, 0); assert.equal(f.calls.length, 1);
  const restored = await f.persisted();
  assert.equal(restored.circles[f.circleId].reactionBursts[0].notification.status, 'sent');
  assert.equal(restored.circles[f.circleId].reactionBursts[0].notification.messageId, 101);
});

test('HTTP task and Telegram failures are retryable, and cron tick repairs overdue bursts', async t => {
  const f = await fixture(t);
  const first = await f.send();
  f.advance(2000); await f.send(); f.advance(11000); f.failEnqueue(true);
  assert.equal((await f.worker(f.tasks[0])).status, 503);
  f.failEnqueue(false);
  assert.equal((await f.worker(f.tasks[0])).status, 200);
  f.advance(2000); f.failTelegram(true);
  assert.equal((await f.worker(f.tasks[1])).status, 503);
  f.failTelegram(false);
  const repaired = await f.request('/api/cron/tick', { secret: cronSecret, body: {} });
  assert.equal(repaired.status, 200); assert.equal(repaired.body.reactions.sent, 1);
  assert.equal((await f.worker(first.body)).body.sent, 0);
  assert.equal(f.calls.length, 2, 'one failed attempt and one successful retry');
});

test('cron HTTP tick dispatches local 22:00 missing-entry reminders only once and survives restart', async t => {
  const f = await fixture(t);
  f.advance(13 * 3600000);
  const rejected = await f.request('/api/cron/tick', { body: {} });
  assert.equal(rejected.status, 401); assert.equal(f.calls.length, 0);
  const first = await f.request('/api/cron/tick', { secret: cronSecret, body: {} });
  assert.equal(first.status, 200); assert.equal(first.body.reminders.sent, 2);
  assert.equal(f.calls.find(item => item.parameters.chat_id === '101').parameters.text, missingEntryReminderText('zh'));
  assert.equal(f.calls.find(item => item.parameters.chat_id === '202').parameters.text, missingEntryReminderText('uk'));
  assert.ok(f.calls.every(item => item.method === 'sendMessage' && item.parameters.disable_notification === true));
  f.advance(15 * 60000);
  const duplicate = await f.request('/api/cron/tick', { secret: cronSecret, body: {} });
  assert.equal(duplicate.body.reminders.sent, 0); assert.equal(f.calls.length, 2);
  await f.restart();
  assert.equal((await f.request('/api/cron/tick', { secret: cronSecret, body: {} })).body.reminders.sent, 0);
  assert.equal(f.calls.length, 2);
});
