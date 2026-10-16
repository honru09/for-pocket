import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { localService, remoteService, SESSION_KEY } from '../src/services.mjs';

const token = '123456:fixed-capital-test-fixture';
const now = Date.parse('2026-11-09T03:00:00.000Z');
const nativeFetch = globalThis.fetch;

function signed(id, at = now) {
  const fields = {
    auth_date: String(Math.floor(at / 1000)),
    user: JSON.stringify({ id, first_name: `User ${id}`, language_code: 'en' }),
  };
  const text = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(text).digest('hex') }).toString();
}

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function fixture(t, { aiSummarizer, clock } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-fixed-capital-test-'));
  const calls = [];
  const summarizer = aiSummarizer || {
    enabled: true,
    async summarize(input) { calls.push(input); return 'The model claims a deliberately incorrect total of 999999 JPY.'; },
  };
  const server = createApp({ token, dataDir, now: clock || (() => now), aiSummarizer: summarizer, aiParser: { enabled: false } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-fixed-capital-test-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  return {
    base,
    calls,
    async request(route, { user = 101, body, method = body === undefined ? 'GET' : 'POST', session, raw, headers = {} } = {}) {
      const auth = user === null ? {} : raw ? { 'X-Telegram-Init-Data': raw } : session ? { Authorization: `Bearer ${session}` } : { 'X-Telegram-Init-Data': signed(user) };
      const result = await nativeFetch(base + '/api' + route, {
        method,
        headers: { 'Content-Type': 'application/json', ...auth, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: result.status, data: await result.json() };
    },
  };
}

const capital = (patch = {}) => ({
  enabled: true,
  currency: 'JPY',
  incomesTotal: 100000,
  expensesTotal: 30000,
  savingsTarget: 10000,
  dailyAllowance: 1,
  payday: 10,
  lastCalculatedAt: '2000-01-01T00:00:00.000Z',
  ...patch,
});

const expense = (id, amountMinor, patch = {}) => ({
  id,
  consumer: 'u_101',
  type: 'expense',
  categoryId: 'stomach',
  amountMinor,
  currency: 'JPY',
  note: 'fixed capital fixture note',
  timezone: 'Asia/Tokyo',
  occurredAt: '2026-11-09T03:00:00.000Z',
  ...patch,
});

test('fixed-capital API authenticates, validates minor units, persists authoritative currency and protects shared ledgers', async t => {
  const f = await fixture(t);
  const unauthenticated = await f.request('/fixed-capital', { user: null, method: 'PUT', body: { fixedCapital: capital(), ledgerId: '101' } });
  assert.equal(unauthenticated.status, 401);

  const wrongLedger = await f.request('/fixed-capital', { method: 'PUT', body: { fixedCapital: capital(), ledgerId: 'not-the-active-ledger' } });
  assert.equal(wrongLedger.status, 409);

  const invalidBodies = [
    { ...capital(), incomesTotal: 1.5 },
    { ...capital(), expensesTotal: -1 },
    { ...capital(), savingsTarget: Number.MAX_SAFE_INTEGER + 1 },
    { ...capital(), enabled: true, incomesTotal: 0 },
    { ...capital(), expensesTotal: 70000, savingsTarget: 40000 },
  ];
  for (const fixedCapital of invalidBodies) {
    const result = await f.request('/fixed-capital', { method: 'PUT', body: { fixedCapital, ledgerId: '101' } });
    assert.equal(result.status, 400, `invalid fixed-capital payload should be rejected: ${JSON.stringify(fixedCapital)}`);
  }

  const initialLedgerFallback = capital();
  delete initialLedgerFallback.currency;
  const initialFallback = await f.request('/fixed-capital', { method: 'PUT', body: { fixedCapital: initialLedgerFallback, ledgerId: '101' } });
  assert.equal(initialFallback.status, 200);
  assert.equal(initialFallback.data.settings.fixedCapital.currency, 'JPY', 'an omitted currency falls back to the ledger currency');

  const saved = await f.request('/fixed-capital', { method: 'PUT', body: { fixedCapital: capital(), ledgerId: '101' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.ledgerId, '101');
  assert.equal(saved.data.settings.fixedCapital.currency, 'JPY');
  assert.equal(saved.data.settings.fixedCapital.incomesTotal, 100000);
  assert.equal(saved.data.settings.fixedCapital.expensesTotal, 30000);
  assert.equal(saved.data.settings.fixedCapital.savingsTarget, 10000);
  assert.equal(saved.data.settings.fixedCapital.dailyAllowance, 1935, 'the client supplied allowance is ignored and recalculated for the cycle');
  assert.equal(saved.data.settings.fixedCapital.lastCalculatedAt, new Date(now).toISOString());

  // An ordinary settings save may change the ledger currency without clearing
  // the fixed-capital currency that was explicitly persisted above.
  const settings = { ...saved.data.settings, currency: 'USD', ledgerId: '101' };
  delete settings.fixedCapital;
  const changedSettings = await f.request('/settings', { method: 'PUT', body: settings });
  assert.equal(changedSettings.status, 200);
  assert.equal(changedSettings.data.settings.currency, 'USD');
  assert.equal(changedSettings.data.settings.fixedCapital.currency, 'JPY');
  assert.equal(changedSettings.data.settings.fixedCapital.dailyAllowance, 1935);

  // A later budget write may omit currency. The previously persisted budget
  // currency is authoritative even though the ledger's ordinary currency is
  // now USD.
  const omittedCurrency = { ...changedSettings.data.settings.fixedCapital };
  delete omittedCurrency.currency;
  const retainedCurrency = await f.request('/fixed-capital', { method: 'PUT', body: { fixedCapital: omittedCurrency, ledgerId: '101' } });
  assert.equal(retainedCurrency.status, 200);
  assert.equal(retainedCurrency.data.settings.fixedCapital.currency, 'JPY');

  const created = await f.request('/circles/create', { body: { name: 'Budget circle' } });
  assert.equal(created.status, 200);
  const circleId = created.data.social.activeCircleId;
  const invite = await f.request('/circles/invite', { body: { circleId } });
  assert.equal((await f.request('/circles/join', { user: 202, body: { code: invite.data.code, confirm: true } })).status, 200);
  const sharedProfile = await f.request('/profile', { user: 202 });
  const sharedConfig = { ...sharedProfile.data.settings.fixedCapital, incomesTotal: 120000, dailyAllowance: 7 };

  const nonAdminFixedCapital = await f.request('/fixed-capital', { user: 202, method: 'PUT', body: { fixedCapital: sharedConfig, ledgerId: created.data.ledgerId } });
  assert.equal(nonAdminFixedCapital.status, 403);
  const nonAdminSettings = await f.request('/settings', {
    user: 202,
    method: 'PUT',
    body: { ...sharedProfile.data.settings, fixedCapital: sharedConfig, ledgerId: created.data.ledgerId },
  });
  assert.equal(nonAdminSettings.status, 403, 'settings must not provide a second path around fixed-capital admin checks');
  const unchanged = await f.request('/profile');
  assert.equal(unchanged.data.settings.fixedCapital.incomesTotal, 100000);
});

test('analyze-budget returns deterministic cycle accounting, never activates the supplied config, and isolates provider text', async t => {
  const f = await fixture(t);
  for (const item of [
    expense('cycle-start-01', 2000, { occurredAt: '2026-10-10T03:00:00.000Z' }),
    expense('cycle-end-01', 700),
    expense('before-cycle-01', 500, { occurredAt: '2026-10-01T03:00:00.000Z' }),
    expense('other-currency-01', 9999, { currency: 'USD' }),
  ]) {
    const created = await f.request('/expenses', { body: item });
    assert.equal(created.status, 200);
  }

  const before = await f.request('/profile');
  assert.equal(before.data.settings.fixedCapital.enabled, false);
  const requestCapital = capital({ dailyAllowance: 999999, lastCalculatedAt: null });
  const analyzed = await f.request('/ai/analyze-budget', {
    method: 'POST',
    body: { fixedCapital: requestCapital, currency: 'JPY', timezone: 'Asia/Tokyo', ledgerId: '101' },
  });
  assert.equal(analyzed.status, 200);
  assert.equal(analyzed.data.fixedCapital.enabled, true);
  assert.equal(analyzed.data.fixedCapital.currency, 'JPY');
  assert.deepEqual(Object.keys(analyzed.data.summary).sort(), [
    'currency', 'cycleDays', 'cycleEnd', 'cycleRemaining', 'cycleSpent', 'cycleStart',
    'dailyAllowance', 'enabled', 'monthlyPool', 'todayRemaining', 'todaySpent',
  ].sort());
  assert.deepEqual(analyzed.data.summary, {
    enabled: true,
    currency: 'JPY',
    monthlyPool: 60000,
    dailyAllowance: 1935,
    todaySpent: 700,
    todayRemaining: 1235,
    cycleSpent: 2700,
    cycleRemaining: 57300,
    cycleDays: 31,
    cycleStart: '2026-10-10',
    cycleEnd: '2026-11-09',
  });
  assert.equal(typeof analyzed.data.generated, 'boolean');
  assert.equal(typeof analyzed.data.text, 'string');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(Object.keys(f.calls[0]), ['prompt']);
  assert.match(f.calls[0].prompt, /2700 JPY/);

  const after = await f.request('/profile');
  assert.equal(after.data.settings.fixedCapital.enabled, false, 'analysis must not write or activate a budget');
  assert.equal(after.data.settings.fixedCapital.lastCalculatedAt, null);
});

test('analyze-budget falls back to local accounting when the provider is unavailable', async t => {
  const f = await fixture(t, { aiSummarizer: { enabled: true, async summarize() { throw new Error('provider is unavailable'); } } });
  assert.equal((await f.request('/expenses', { body: expense('fallback-entry-01', 1200) })).status, 200);
  const result = await f.request('/ai/analyze-budget', {
    method: 'POST',
    body: { fixedCapital: capital(), currency: 'JPY', timezone: 'Asia/Tokyo', ledgerId: '101' },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.summary.cycleSpent, 1200);
  assert.equal(result.data.summary.currency, 'JPY');
  assert.deepEqual([result.data.generated, result.data.text], [false, '']);
  assert.ok(!JSON.stringify(result.data).includes('provider is unavailable'));
});

test('shared members can save ordinary settings after the budget timestamp advances', async t => {
  let at = now;
  const f = await fixture(t, { clock: () => at });
  const created = await f.request('/circles/create', { body: { name: 'Budget circle' } });
  const circleId = created.data.social.activeCircleId;
  const invite = await f.request('/circles/invite', { body: { circleId } });
  assert.equal((await f.request('/circles/join', { user: 202, body: { code: invite.data.code, confirm: true } })).status, 200);
  const enabled = await f.request('/fixed-capital', { method: 'PUT', body: { fixedCapital: capital(), ledgerId: created.data.ledgerId } });
  assert.equal(enabled.status, 200);
  at += 90_000;
  const member = await f.request('/profile', { user: 202 });
  const saved = await f.request('/settings', {
    user: 202,
    method: 'PUT',
    body: { ...member.data.settings, ledgerId: member.data.ledgerId },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.fixedCapital.incomesTotal, capital().incomesTotal);
  assert.equal(saved.data.settings.fixedCapital.lastCalculatedAt, new Date(at).toISOString());
});

test('localService persists fixed capital, computes summaries, and rejects storage failures', async t => {
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });

  const service = localService('en');
  const saved = await service.saveFixedCapital(capital(), 'local');
  assert.equal(saved.ledgerId, 'local');
  assert.equal(saved.settings.fixedCapital.currency, 'JPY');
  assert.equal(saved.settings.fixedCapital.dailyAllowance, 1935);
  await service.addExpense(expense('local-budget-01', 1200, { consumer: 'u_local', occurredAt: '2026-10-15T03:00:00.000Z' }));
  const analyzed = await service.analyzeBudget({ fixedCapital: capital({ dailyAllowance: 888 }), currency: 'JPY', timezone: 'Asia/Tokyo', ledgerId: 'local' });
  assert.equal(analyzed.summary.cycleSpent, 1200);
  assert.equal(analyzed.summary.dailyAllowance, 1935);
  assert.equal(analyzed.generated, false);
  assert.equal(analyzed.text, '');
  assert.equal((await service.getProfile()).settings.fixedCapital.enabled, true, 'analysis must not overwrite local settings');

  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: () => { throw new Error('storage is full'); },
    removeItem: key => values.delete(key),
  };
  await assert.rejects(service.saveFixedCapital(capital({ incomesTotal: 120000 }), 'local'), /errorLocalSpace|storage is full/);
});

test('remoteService exposes fixed-capital methods and retries an API failure without losing the request', async t => {
  const f = await fixture(t);
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  let failed = false;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (!failed && String(url).endsWith('/api/fixed-capital')) {
      failed = true;
      return Promise.resolve(response({ error: 'errorSave' }, 503));
    }
    return nativeFetch(new URL(url, f.base), options);
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });

  const service = remoteService({ initData: signed(101) });
  const profile = await service.getProfile();
  assert.equal(profile.ledgerId, '101');
  await assert.rejects(service.saveFixedCapital(capital(), '101'), error => error.status === 503 && error.message === 'errorSave');
  const saved = await service.saveFixedCapital(capital(), '101');
  assert.equal(saved.settings.fixedCapital.dailyAllowance, 1935);
  const analyzed = await service.analyzeBudget({ fixedCapital: capital(), currency: 'JPY', timezone: 'Asia/Tokyo', ledgerId: '101' });
  assert.equal(analyzed.summary.currency, 'JPY');
  assert.equal(analyzed.summary.cycleDays, 31);
  assert.equal(values.has(SESSION_KEY), true);
});
