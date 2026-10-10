import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { remoteService, SESSION_KEY } from '../src/services.mjs';

const botToken = '123456:test-session-fixture';
const nativeFetch = globalThis.fetch;
const DAY = 86400000;

function signed(id, time) {
  const fields = { auth_date: String(Math.floor(time / 1000)), user: JSON.stringify({ id, first_name: `User ${id}` }) };
  const check = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
}

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-auth-test-'));
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  let time = Date.now(), server, base;
  const start = async () => {
    server = createApp({ token: botToken, dataDir, now: () => time });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  };
  await start();
  const calls = [];
  globalThis.fetch = (url, options) => { calls.push({ url, headers: { ...options?.headers } }); return nativeFetch(new URL(url, base), options); };
  t.after(async () => {
    globalThis.fetch = nativeFetch; globalThis.localStorage = previousStorage;
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-auth-test-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  return {
    calls, values, init: id => signed(id, time), advance: duration => { time += duration; },
    restart: async () => { await new Promise(resolve => server.close(resolve)); await start(); },
    database: async () => JSON.parse(await readFile(path.join(dataDir, '_pocket-v2.json'), 'utf8')),
    request: async (route, { raw, session, method = 'GET', body } = {}) => {
      const response = await nativeFetch(base + '/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(raw ? { 'X-Telegram-Init-Data': raw } : {}), ...(session ? { Authorization: `Bearer ${session}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    },
  };
}

test('Telegram session survives a refresh without initData and with the original aged WebApp payload', async t => {
  const f = await fixture(t), telegram = { initData: f.init(101) };
  const first = await remoteService(telegram).getProfile();
  assert.equal(first.user.id, 'u_101');
  const token = f.values.get(SESSION_KEY);
  assert.ok(token, 'a Telegram login must persist a reusable session');
  await f.restart();
  assert.equal((await remoteService().getProfile()).user.id, 'u_101');
  f.advance(2 * DAY);
  assert.equal((await remoteService(telegram).getProfile()).user.id, 'u_101');
  assert.equal(f.values.get(SESSION_KEY), token, 'reopening the same WebApp must reuse its session');
  assert.ok(f.calls.filter(call => call.url === '/api/profile').every(call => !call.headers['X-Telegram-Init-Data']), 'ordinary requests must use the established session');
});

test('fresh Telegram identities supersede a different cached account and stale unexchanged payloads cannot authorize', async t => {
  const f = await fixture(t);
  await remoteService({ initData: f.init(101) }).getProfile();
  const oldToken = f.values.get(SESSION_KEY), staleOther = f.init(202);
  f.advance(2 * DAY);
  await assert.rejects(remoteService({ initData: staleOther }).getProfile(), { status: 401 });
  const newRaw = f.init(202);
  const newProfile = await remoteService({ initData: newRaw }).getProfile();
  assert.equal(newProfile.user.id, 'u_202', 'the cached account must never override the current Telegram user');
  assert.notEqual(f.values.get(SESSION_KEY), oldToken);
  assert.equal((await f.request('/profile', { raw: newRaw, session: oldToken })).data.user.id, 'u_202');
  const forged = new URLSearchParams(newRaw); forged.set('user', JSON.stringify({ id: 303 }));
  assert.equal((await f.request('/auth/telegram', { raw: forged.toString(), session: f.values.get(SESSION_KEY), method: 'POST', body: {} })).status, 401);
});

test('expired sessions require fresh Telegram authentication and logout revokes without minting another session', async t => {
  const f = await fixture(t), telegram = { initData: f.init(101) };
  const service = remoteService(telegram); await service.getProfile();
  const expiredToken = f.values.get(SESSION_KEY);
  f.advance(31 * DAY);
  await assert.rejects(remoteService().getProfile(), { status: 401 });
  await assert.rejects(remoteService(telegram).getProfile(), { status: 401 });
  telegram.initData = f.init(101);
  assert.equal((await service.getProfile()).user.id, 'u_101');
  const token = f.values.get(SESSION_KEY); assert.notEqual(token, expiredToken);
  await service.logout();
  assert.equal(f.values.has(SESSION_KEY), false);
  assert.equal((await f.request('/profile', { session: token })).status, 401);
  await assert.rejects(service.getProfile(), { status: 401 }, 'the logged-out client must not silently reauthenticate');
  const logout = await f.request('/auth/logout', { raw: telegram.initData, session: token, method: 'POST', body: {} });
  assert.equal(logout.status, 200, 'logout is idempotent for an already-revoked token');
  assert.equal(logout.data.sessionToken, undefined);
  assert.equal(Object.keys((await f.database()).sessions).length, 0);
});

test('authentication responses cannot contaminate stored expenses with plaintext session tokens', async t => {
  const f = await fixture(t), raw = f.init(101), service = remoteService({ initData: raw });
  await service.getProfile();
  await service.addExpense({ id: 'auth-safe-expense-01', consumer: 'u_101', amountMinor: 100, currency: 'JPY', categoryId: 'stomach', type: 'expense', note: '', timezone: 'Asia/Tokyo' });
  await f.request('/expenses', { raw, method: 'POST', body: { id: 'auth-legacy-expense-02', consumer: 'u_101', amountMinor: 200, currency: 'JPY', categoryId: 'stomach', type: 'expense', note: '', timezone: 'Asia/Tokyo' } });
  const profile = await service.getProfile();
  assert.ok(profile.expenses.every(entry => !Object.hasOwn(entry, 'sessionToken')));
  await service.updateUserProfile({ name: 'Persistent name', color: 'yellow', avatar: 'cloud' });
  const database = await f.database();
  assert.ok(database.ledgers['101'].expenses.every(entry => !Object.hasOwn(entry, 'sessionToken')));
  assert.ok(!JSON.stringify(database).includes(f.values.get(SESSION_KEY)), 'only hashed session secrets belong in storage');
});
