import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, rmdir, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.mjs';
import { createApp } from '../server.mjs';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { deriveTelegramWebhookSecret } from '../telegram-config.mjs';

const token = '12345:store-fixture';
function signed() {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 101, first_name: 'User 101' }) };
  const check = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
}
async function appFixture(t, options) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-store-test-'));
  const server = createApp({ dataDir, storeOptions: { debounceMs: 5000 }, token, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { server, dataDir, base: `http://127.0.0.1:${server.address().port}` };
}

function cloudEnvironment(t, asyncMode) {
  const previous = { K_SERVICE: process.env.K_SERVICE, STORE_ASYNC_PERSIST: process.env.STORE_ASYNC_PERSIST };
  process.env.K_SERVICE = 'for-pocket-test';
  if (asyncMode) process.env.STORE_ASYNC_PERSIST = 'true'; else delete process.env.STORE_ASYNC_PERSIST;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

const telegramMessage = id => ({ update_id: id, message: { message_id: id, from: { id: 101, first_name: 'User 101', language_code: 'zh' }, chat: { id: 101, type: 'private' }, text: '午饭100日元' } });
const telegramConfirm = (id, draftId) => ({ update_id: id, callback_query: { id: `query-${id}`, from: { id: 101 }, message: { message_id: 7, chat: { id: 101, type: 'private' } }, data: `fp:confirm:${draftId}` } });
const telegramParser = { enabled: true, async parse() { return [{ amountMinor: 100, currency: 'JPY', type: 'expense', categoryId: 'stomach', note: 'Lunch', occurredAt: new Date().toISOString(), timezone: 'Asia/Tokyo' }]; } };
async function webhook(f, update) {
  const response = await fetch(`${f.base}/api/telegram-webhook`, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': deriveTelegramWebhookSecret(token),
  }, body: JSON.stringify(update) });
  return { status: response.status, data: await response.json() };
}

test('store updates memory before debounced persistence and flushes the latest revision', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-store-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = createStore(dataDir, { debounceMs: 1000, logger: { error() {} } });
  await Promise.all(Array.from({ length: 4 }, (_, i) => store.run(db => {
    db.values ||= [];
    db.values.push(i);
  })));
  // The request path does not wait for the delayed file write.
  await assert.rejects(readFile(path.join(dataDir, '_pocket-v2.json')), { code: 'ENOENT' });
  await store.flush();
  const persisted = JSON.parse(await readFile(path.join(dataDir, '_pocket-v2.json'), 'utf8'));
  assert.equal(persisted.revision, 4);
  assert.deepEqual(persisted.values, [0, 1, 2, 3]);
});

test('close flushes queued writes before a restart can read the store', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-store-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = createStore(dataDir, { debounceMs: 5000, logger: { error() {} } });
  await store.run(db => { db.marker = 'saved'; });
  await store.close();
  const restarted = createStore(dataDir, { debounceMs: 5000, logger: { error() {} } });
  assert.equal(await restarted.run(db => db.marker), 'saved');
  await restarted.close();
});

test('explicit flush waits for a mutation that is still queued', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-store-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = createStore(dataDir, { debounceMs: 5000 });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const mutation = store.run(async db => { await pending; db.marker = 'last mutation'; });
  const closing = store.close();
  release();
  await Promise.all([mutation, closing]);
  const persisted = JSON.parse(await readFile(path.join(dataDir, '_pocket-v2.json'), 'utf8'));
  assert.equal(persisted.marker, 'last mutation');
});

test('Cloud Run defaults to durable success before ending its response', async t => {
  cloudEnvironment(t, false);
  const f = await appFixture(t);
  const response = await fetch(`${f.base}/api/profile`, { headers: { 'X-Telegram-Init-Data': signed() } });
  assert.equal(response.status, 200);
  await response.json();
  const persisted = JSON.parse(await readFile(path.join(f.dataDir, '_pocket-v2.json'), 'utf8'));
  assert.equal(persisted.users['101'].name, 'User 101');
});

test('Cloud Run background persistence requires the explicit async environment flag', async t => {
  cloudEnvironment(t, true);
  const f = await appFixture(t);
  const response = await fetch(`${f.base}/api/profile`, { headers: { 'X-Telegram-Init-Data': signed() } });
  assert.equal(response.status, 200);
  await response.json();
  await assert.rejects(readFile(path.join(f.dataDir, '_pocket-v2.json')), { code: 'ENOENT' });
  await f.server.flushStore();
  const persisted = JSON.parse(await readFile(path.join(f.dataDir, '_pocket-v2.json'), 'utf8'));
  assert.equal(persisted.users['101'].name, 'User 101');
});

test('Cloud Run does not acknowledge success when persistence fails and returns a bounded error response', async t => {
  cloudEnvironment(t, false);
  let entered, release;
  const reached = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const f = await appFixture(t, { aiParser: { enabled: true, async parse() { entered(); await waiting; return []; } } });
  const responsePromise = fetch(`${f.base}/api/ai/parse-expense`, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Telegram-Init-Data': signed(),
  }, body: JSON.stringify({ text: 'lunch 100' }) });
  await reached;
  // An empty directory at the target path makes the atomic swap fail while
  // keeping the already-loaded memory state valid for this request.
  const blocker = path.join(f.dataDir, '_pocket-v2.json');
  await mkdir(blocker);
  release();
  const response = await responsePromise;
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'errorSave' });
  await rmdir(blocker);
  await f.server.flushStore();
});

test('server close stops new requests, waits for an active login and flushes its resulting mutation', async t => {
  let release, entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { entered = resolve; });
  const clientId = 'store-test.apps.googleusercontent.com';
  const f = await appFixture(t, { asyncPersist: true, googleClientId: clientId, verifyGoogle: async () => {
    entered();
    await waiting;
    return { sub: 'pending-login', name: 'Pending user', aud: clientId, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 3600 };
  } });
  const pending = fetch(`${f.base}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: 'fixture' }) });
  await reached;
  let finished = false;
  const close = new Promise((resolve, reject) => f.server.close(error => {
    finished = true;
    if (error) reject(error); else resolve();
  }));
  assert.equal(f.server.listening, false);
  assert.equal(finished, false);
  release();
  const response = await pending;
  assert.equal(response.status, 200);
  const result = await response.json();
  await close;
  const persisted = JSON.parse(await readFile(path.join(f.dataDir, '_pocket-v2.json'), 'utf8'));
  assert.equal(persisted.users[result.profile.user.id.slice(2)].name, 'Pending user');
});

test('safe Telegram delivery persists the draft and expense before sending visible messages', async t => {
  const snapshots = [], calls = [];
  let f;
  f = await appFixture(t, { asyncPersist: false, aiParser: telegramParser, callTelegram: async (method, params) => {
    calls.push({ method, params });
    if (['sendMessage', 'editMessageText'].includes(method)) {
      snapshots.push(JSON.parse(await readFile(path.join(f.dataDir, '_pocket-v2.json'), 'utf8')));
    }
    return { message_id: 7 };
  } });
  assert.equal((await webhook(f, telegramMessage(1))).status, 200);
  const draftId = calls.find(call => call.method === 'sendMessage').params.reply_markup.inline_keyboard[0][0].callback_data.split(':').at(-1);
  assert.equal(snapshots[0].telegram.drafts[draftId].status, 'pending');
  assert.equal((await webhook(f, telegramConfirm(2, draftId))).status, 200);
  assert.equal(snapshots.at(-1).telegram.drafts[draftId].status, 'confirmed');
  assert.equal(snapshots.at(-1).ledgers['101'].expenses.length, 1);
});

test('failed Telegram persistence does not send a success message and the same confirmation can retry', async t => {
  const calls = [];
  const f = await appFixture(t, { asyncPersist: false, aiParser: telegramParser, callTelegram: async (method, params) => {
    calls.push({ method, params }); return { message_id: 7 };
  } });
  assert.equal((await webhook(f, telegramMessage(1))).status, 200);
  const draftId = calls.find(call => call.method === 'sendMessage').params.reply_markup.inline_keyboard[0][0].callback_data.split(':').at(-1);
  const target = path.join(f.dataDir, '_pocket-v2.json'), backup = `${target}.last-good`;
  await rename(target, backup);
  await mkdir(target);
  const before = calls.filter(call => ['sendMessage', 'editMessageText'].includes(call.method)).length;
  const blocked = await webhook(f, telegramConfirm(2, draftId));
  assert.equal(blocked.status, 503);
  assert.equal(calls.filter(call => ['sendMessage', 'editMessageText'].includes(call.method)).length, before);
  const lastGood = JSON.parse(await readFile(backup, 'utf8'));
  assert.equal(lastGood.telegram.drafts[draftId].status, 'pending');
  assert.equal(lastGood.ledgers['101'].expenses.length, 0);
  await rmdir(target);
  await rename(backup, target);
  assert.equal((await webhook(f, telegramConfirm(2, draftId))).status, 200);
  const persisted = JSON.parse(await readFile(target, 'utf8'));
  assert.equal(persisted.ledgers['101'].expenses.length, 1);
  assert.equal(calls.filter(call => ['sendMessage', 'editMessageText'].includes(call.method)).length, before + 1);
});
