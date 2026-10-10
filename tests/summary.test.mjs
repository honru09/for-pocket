import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { expenseStats, summaryPrompt, summarizeExpenses } from '../ai-summary.mjs';
import { createApp } from '../server.mjs';
import { initialSettings } from '../public/shared.mjs';

const now = Date.parse('2026-10-11T00:00:00.000Z');
const token = '123456:summary-test-fixture';
const expense = (id, patch = {}) => ({ id, consumer: 'u_101', type: 'expense', categoryId: 'stomach',
  category: { id: 'stomach', label: '胃' }, amountMinor: 100, currency: 'JPY', note: '', timezone: 'Asia/Tokyo',
  occurredAt: '2026-10-10T03:00:00.000Z', ...patch });
const profileWith = expenses => ({ settings: { ...initialSettings(), consumers: [
  { id: 'u_101', name: 'Akira' }, { id: 'u_202', name: 'Olena' },
] }, expenses });

function signed(id) {
  const fields = { auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id, first_name: `User ${id}`, language_code: 'zh' }) };
  const text = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(text).digest('hex') }).toString();
}

async function fixture(t, provider) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-summary-test-'));
  const calls = [];
  const aiSummarizer = provider || { enabled: true, async summarize(input) { calls.push(input); return '餐饮是本月主要支出。'; } };
  const server = createApp({ token, dataDir, now: () => now, aiSummarizer, aiParser: { enabled: false } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-summary-test-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { calls, async request(route, { user = 101, body, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json',
      ...(user ? { 'X-Telegram-Init-Data': signed(user) } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  } };
}

test('weekly and monthly totals use local calendar boundaries, keep currencies separate and count payers once', () => {
  const profile = profileWith([
    expense('before-month', { amountMinor: 900, occurredAt: '2026-09-30T14:59:59.000Z' }),
    expense('month-start', { occurredAt: '2026-09-30T15:00:00.000Z' }),
    expense('before-week', { amountMinor: 200, occurredAt: '2026-10-04T14:59:59.000Z' }),
    expense('week-start', { amountMinor: 300, occurredAt: '2026-10-04T15:00:00.000Z', splitMode: 'equal', splitParticipants: ['u_101', 'u_202'] }),
    expense('week-book', { consumer: 'u_202', amountMinor: 700, categoryId: 'learning', category: { id: 'learning', label: '学习' } }),
    expense('income', { type: 'income', amountMinor: 5000, categoryId: 'wage' }),
    expense('dollars', { amountMinor: 1234, currency: 'USD' }),
    expense('deleted', { amountMinor: 99999, deletedAt: '2026-10-10T04:00:00.000Z' }),
    expense('invalid-date', { amountMinor: 99999, occurredAt: 'not a date' }),
    expense('unsafe-amount', { amountMinor: Number.MAX_SAFE_INTEGER + 1 }),
    expense('tomorrow', { amountMinor: 99999, occurredAt: '2026-10-11T15:00:00.000Z' }),
  ]);
  const week = expenseStats({ period: 'week', timezone: 'Asia/Tokyo', currency: 'JPY' }, profile, now);
  assert.equal(week.startDay, '2026-10-05');
  assert.equal(week.endDay, '2026-10-11');
  assert.equal(week.count, 3);
  assert.equal(week.expenseMinor, 1000);
  assert.equal(week.incomeMinor, 5000);
  assert.deepEqual(week.byConsumer, [
    { id: 'u_202', name: 'Olena', amountMinor: 700 },
    { id: 'u_101', name: 'Akira', amountMinor: 300 },
  ], 'equal splits must not count a purchase twice or attribute payment to beneficiaries');
  assert.deepEqual(week.byCategory.map(item => [item.id, item.amountMinor]), [['learning', 700], ['stomach', 300]]);

  const month = expenseStats({ period: 'month', timezone: 'Asia/Tokyo', currency: 'JPY' }, profile, now);
  assert.equal(month.startDay, '2026-10-01');
  assert.equal(month.count, 5);
  assert.equal(month.expenseMinor, 1300);
  assert.equal(month.incomeMinor, 5000);
  const usd = expenseStats({ period: 'month', currency: 'USD', timezone: 'Asia/Tokyo' }, profile, now);
  assert.equal(usd.count, 1);
  assert.equal(usd.expenseMinor, 1234);
  assert.equal(usd.incomeMinor, 0);
});

test('week boundaries follow the requested timezone when local Monday is still Sunday in UTC', () => {
  const anchor = Date.parse('2026-10-04T15:30:00.000Z');
  const profile = profileWith([expense('boundary-entry', { occurredAt: '2026-10-04T15:00:00.000Z' })]);
  const tokyo = expenseStats({ period: 'week', timezone: 'Asia/Tokyo' }, profile, anchor);
  const utc = expenseStats({ period: 'week', timezone: 'UTC' }, profile, anchor);
  assert.deepEqual([tokyo.startDay, tokyo.endDay], ['2026-10-05', '2026-10-05']);
  assert.deepEqual([utc.startDay, utc.endDay], ['2026-09-28', '2026-10-04']);
  assert.equal(tokyo.count, 1);
  assert.equal(utc.count, 1);
});

test('summary prompts use verified currency totals and never send raw notes or receipt text', () => {
  const profile = profileWith([expense('private-note', { currency: 'USD', amountMinor: 1234,
    note: 'PRIVATE_RECEIPT_NOTE_SENTINEL', rawText: 'PRIVATE_SCREENSHOT_TEXT_SENTINEL', merchant: 'PRIVATE_MERCHANT_SENTINEL',
  })]);
  const input = { period: 'month', currency: 'USD', question: 'Which category was largest?' };
  const prompt = summaryPrompt(input, profile, expenseStats(input, profile, now));
  assert.ok(prompt.includes('12.34 USD'));
  assert.ok(prompt.includes('Akira'));
  assert.ok(prompt.includes('Which category was largest?'));
  assert.ok(!prompt.includes('PRIVATE_'));
  assert.ok(!prompt.includes('1234 USD'), 'minor units must be formatted exactly once');
  profile.settings.language = 'uk';
  assert.ok(summaryPrompt(input, profile, expenseStats(input, profile, now)).includes('Ukrainian'));
});

test('empty, disabled and failed AI summaries retain correct local statistics without invented prose', async () => {
  const profile = profileWith([expense('summary-entry')]);
  let calls = 0;
  const good = { enabled: true, async summarize() { calls++; return 'A short verified summary.'; } };
  const empty = await summarizeExpenses({ period: 'month' }, profileWith([]), good, now);
  assert.equal(empty.generated, false);
  assert.equal(empty.text, '');
  assert.equal(calls, 0, 'empty periods do not spend a model request');
  const disabled = await summarizeExpenses({}, profile, { ...good, enabled: false }, now);
  assert.equal(disabled.stats.expenseMinor, 100);
  assert.equal(disabled.generated, false);
  assert.equal(calls, 0);
  const successful = await summarizeExpenses({}, profile, good, now);
  assert.equal(successful.generated, true);
  assert.equal(successful.text, 'A short verified summary.');
  const failed = await summarizeExpenses({}, profile, { enabled: true, async summarize() { throw new Error('provider private detail'); } }, now);
  assert.equal(failed.stats.expenseMinor, 100);
  assert.deepEqual([failed.generated, failed.text], [false, '']);
  const blank = await summarizeExpenses({}, profile, { enabled: true, async summarize() { return ' \n '; } }, now);
  assert.deepEqual([blank.generated, blank.text], [false, '']);
});

test('summary API authenticates, scopes the active ledger and sends only selected-currency aggregates', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/ai/summary', { user: null, body: { period: 'month' } })).status, 401);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('/expenses', { body: expense('personal-private', { amountMinor: 43210 }) })).status, 200);
  const created = await f.request('/circles/create', { body: { name: 'Summary circle' } });
  const ledgerId = created.data.ledgerId;
  for (const entry of [expense('circle-yen', { amountMinor: 1200, note: 'DO_NOT_SEND_THIS_NOTE' }), expense('circle-usd', { amountMinor: 1234, currency: 'USD' })]) {
    assert.equal((await f.request('/expenses', { body: { ...entry, ledgerId } })).status, 200);
  }
  const stale = await f.request('/ai/summary', { body: { period: 'month', ledgerId: '101' } });
  assert.equal(stale.status, 409);
  assert.equal(f.calls.length, 0);
  const result = await f.request('/ai/summary', { body: { period: 'month', ledgerId, timezone: 'Asia/Tokyo', currency: 'JPY', question: '花在哪里了？' } });
  assert.equal(result.status, 200);
  assert.equal(result.data.stats.expenseMinor, 1200);
  assert.equal(result.data.stats.currency, 'JPY');
  assert.equal(result.data.stats.count, 1);
  assert.equal(result.data.generated, true);
  assert.equal(result.data.text, '餐饮是本月主要支出。');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(Object.keys(f.calls[0]), ['prompt']);
  assert.ok(f.calls[0].prompt.includes('1200 JPY'));
  assert.ok(!/43210|DO_NOT_SEND_THIS_NOTE|12\.34 USD/.test(f.calls[0].prompt));
  const dollars = await f.request('/ai/summary', { body: { period: 'month', ledgerId, currency: 'USD' } });
  assert.equal(dollars.status, 200);
  assert.equal(dollars.data.stats.expenseMinor, 1234);
  assert.equal(dollars.data.stats.currency, 'USD');
  const otherUser = await f.request('/ai/summary', { user: 202, body: { period: 'month', ledgerId } });
  assert.equal(otherUser.status, 409);
  assert.equal(f.calls.length, 2, 'another user cannot send this circle ledger to the model');
});

test('summary API returns local totals when the provider fails and rejects malformed summary requests', async t => {
  const f = await fixture(t, { enabled: true, async summarize() { throw new Error('PRIVATE_PROVIDER_DETAIL'); } });
  await f.request('/expenses', { body: expense('fallback-entry') });
  const result = await f.request('/ai/summary', { body: { period: 'week', currency: 'JPY', timezone: 'Asia/Tokyo' } });
  assert.equal(result.status, 200);
  assert.equal(result.data.stats.expenseMinor, 100);
  assert.deepEqual([result.data.generated, result.data.text], [false, '']);
  assert.ok(!JSON.stringify(result.data).includes('PRIVATE_PROVIDER_DETAIL'));
  const invalidBodies = [null, [], { period: 'year' }, { currency: 'EUR' }, { timezone: 'not/a-zone' }, { question: { text: 'bad input' } }];
  const invalidStatuses = [];
  for (const body of invalidBodies) invalidStatuses.push((await f.request('/ai/summary', { body })).status);
  assert.deepEqual(invalidStatuses, invalidBodies.map(() => 400), `invalid report parameters: ${JSON.stringify(invalidBodies)}`);
});

test('a summary started in a previous ledger is not returned after the active circle changes', async t => {
  let signalStarted, releaseModel;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const ready = new Promise(resolve => { releaseModel = resolve; });
  const f = await fixture(t, { enabled: true, async summarize() { signalStarted(); await ready; return 'Previous ledger summary.'; } });
  assert.equal((await f.request('/expenses', { body: expense('summary-inflight') })).status, 200);
  const pending = f.request('/ai/summary', { body: { period: 'month', ledgerId: '101' } });
  await started;
  try {
    assert.equal((await f.request('/circles/create', { body: { name: 'Another circle' } })).status, 200);
  } finally { releaseModel(); }
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(result.data.error, 'errorLedgerChanged');
  assert.equal(result.data.text, undefined);
});
