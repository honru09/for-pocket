import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.mjs';
import { createApp } from '../server.mjs';
import { createDigestService, filterDigestEntries, getDigestWindow } from '../digest.mjs';

const at = Date.parse('2026-10-11T01:00:00.000Z'); // Tokyo 10:00, New York 21:00
const category = { id: 'stomach', label: '胃', icon: 'bowl', color: 'peach' };

function user(id, language = 'zh') {
  return { id, name: id === '101' ? 'Kojun' : '芝士', color: 'blue', avatar: 'cloud', settings: { currency: 'JPY', language, timezone: id === '101' ? 'Asia/Tokyo' : 'America/New_York' }, activeCircleId: null };
}
function expense(id, occurredAt, amountMinor = 850, consumer = 'u_101') {
  return { id, type: 'expense', amountMinor, currency: 'JPY', categoryId: 'stomach', category, consumer, member: { id: consumer, name: consumer === 'u_101' ? 'Kojun' : '芝士' }, occurredAt, timezone: 'Asia/Tokyo', note: '拉面' };
}
function state({ two = false, expenses = [] } = {}) {
  const users = { '101': user('101') };
  const identities = { 'telegram:101': '101' };
  const ledgers = { '101': { settings: { currency: 'JPY', language: 'zh', timezone: 'Asia/Tokyo', categories: [category] }, expenses } };
  if (two) {
    users['202'] = user('202', 'en'); identities['telegram:202'] = '202';
    ledgers['202'] = { settings: { currency: 'JPY', language: 'en', timezone: 'America/New_York', categories: [category] }, expenses: [] };
  }
  return { version: 2, revision: 0, users, identities, sessions: {}, links: {}, circles: {}, ledgers };
}

async function serviceFixture(t, initial, now = at, options = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-digest-test-'));
  await writeFile(path.join(dataDir, '_pocket-v2.json'), JSON.stringify(initial));
  const store = createStore(dataDir), calls = [];
  const service = createDigestService({ store, now: () => now, summarizer: { enabled: true, async summarize() { return '咳咳，哇哦，抓到了！'; } }, callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 1 }; }, ...options });
  t.after(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { service, store, calls, dataDir };
}

test('digest windows split Tokyo morning, noon and evening at local boundaries', () => {
  const morning = getDigestWindow('morning', at, 'Asia/Tokyo');
  assert.equal(morning.start, '2026-10-09T15:00:00.000Z');
  assert.equal(morning.end, '2026-10-11T01:00:00.000Z');
  const noon = getDigestWindow('noon', at, 'Asia/Tokyo');
  assert.equal(noon.start, '2026-10-11T01:00:00.000Z');
  assert.equal(noon.end, '2026-10-11T04:00:00.000Z');
  const evening = getDigestWindow('evening', at, 'Asia/Tokyo');
  assert.equal(evening.start, '2026-10-10T15:00:00.000Z');
  assert.equal(evening.end, '2026-10-11T11:00:00.000Z');
  const entries = [expense('digest-old', '2026-10-10T14:59:59.000Z'), expense('digest-night', '2026-10-10T16:00:00.000Z'), expense('digest-ten', '2026-10-11T01:00:00.000Z')];
  const picked = filterDigestEntries(entries, morning, { settings: { categories: [category] }, names: new Map([['u_101', 'Kojun']]) });
  assert.deepEqual(picked.map(item => item.id), ['digest-old', 'digest-night']);
});

test('hourly tick follows each ledger timezone and does not trigger the wrong country', async t => {
  const f = await serviceFixture(t, state({ two: true }), at);
  const tokyo = await f.service.tick({ at });
  assert.equal(tokyo.triggered, 1);
  assert.equal(tokyo.results[0].results[0].timezone, 'Asia/Tokyo');
  assert.equal(f.calls.length, 1);
  const newYorkAt = Date.parse('2026-10-11T14:00:00.000Z'); // New York 10:00
  const ny = await f.service.tick({ at: newYorkAt });
  assert.equal(ny.triggered, 1);
  assert.equal(ny.results[0].results[0].ledgerId, '202');
  assert.equal(f.calls.length, 2);
});

test('empty digest describes missing records and deduplicates same local day', async t => {
  const f = await serviceFixture(t, state(), at);
  const first = await f.service.processSlot('evening', { at });
  assert.equal(first.results[0].count, 0);
  assert.match(first.results[0].text, /没记新账/);
  assert.doesNotMatch(first.results[0].text, /修仙|没花|毫发无损/);
  assert.equal(f.calls.length, 1);
  const second = await f.service.processSlot('evening', { at });
  assert.equal(second.results[0].skipped, true);
  assert.equal(f.calls.length, 1);
});

test('mixed currencies stay separate in category and payer aggregates', async t => {
  const entries = [expense('jpy-food', '2026-10-10T16:00:00.000Z', 850), { ...expense('usd-food', '2026-10-10T17:00:00.000Z', 250), currency: 'USD', consumer: 'u_101' }];
  const f = await serviceFixture(t, state({ expenses: entries }), at);
  const result = await f.service.processSlot('morning', { at });
  assert.deepEqual(result.results[0].aggregate.totals.map(item => item.currency).sort(), ['JPY', 'USD']);
  assert.equal(result.results[0].aggregate.categories.length, 2);
  assert.deepEqual(result.results[0].aggregate.payers.map(item => item.currency).sort(), ['JPY', 'USD']);
});

test('preferences keyed by uid discover a bound chat and failed recipients retry alone', async t => {
  const initial = state({ two: true });
  const sharedExpense = expense('bound', '2026-10-10T16:00:00.000Z');
  initial.circles = { cir_shared: { id: 'cir_shared', ledgerId: 'shared', members: ['101', '202'], admins: ['101'] } };
  initial.users['101'].activeCircleId = 'cir_shared';
  initial.users['202'].activeCircleId = 'cir_shared';
  initial.ledgers.shared = { settings: { currency: 'JPY', language: 'zh', timezone: 'Asia/Tokyo', categories: [category] }, expenses: [sharedExpense] };
  delete initial.identities['telegram:202'];
  initial.telegram = { preferences: { '202': { chatId: '202', language: 'en' } } };
  let fail202 = true;
  const f = await serviceFixture(t, initial, at, { callTelegram: async (method, params) => {
    f.calls.push({ method, params });
    if (String(params.chat_id) === '202' && fail202) throw new Error('temporary Telegram outage');
    return { message_id: Number(params.chat_id) };
  } });
  const first = await f.service.processSlot('morning', { at });
  const firstShared = first.results.find(item => item.ledgerId === 'shared');
  assert.equal(firstShared.deliveryFailed, true);
  assert.equal(firstShared.recipients.find(item => item.chatId === '101').status, 'sent');
  assert.equal(firstShared.recipients.find(item => item.chatId === '202').status, 'failed');
  assert.equal(f.calls[0].params.disable_notification, true, 'digest notifications are silent');
  fail202 = false;
  const second = await f.service.processSlot('morning', { at: at + 1 });
  const retried = f.calls.filter(call => String(call.params.chat_id) === '202');
  const healthy = f.calls.filter(call => String(call.params.chat_id) === '101');
  assert.equal(retried.length, 2);
  assert.equal(healthy.length, 1, 'successful recipient is checkpointed');
  assert.equal(second.results.find(item => item.ledgerId === 'shared').deliveryFailed, false);
});

test('cron digest rejects a missing or incorrect X-Cron-Secret with 401', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-digest-http-'));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  const app = createApp({ dataDir, token: '', cronSecret: 'digest-secret', now: () => at, aiParser: { enabled: false } });
  app.listen(0, '127.0.0.1');
  await new Promise(resolve => app.once('listening', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const url = `http://127.0.0.1:${app.address().port}/api/cron/digest`;
  const missing = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: 'morning' }) });
  assert.equal(missing.status, 401);
  const allowed = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cron-secret': 'digest-secret' }, body: JSON.stringify({ slot: 'morning' }) });
  assert.equal(allowed.status, 200);
});
