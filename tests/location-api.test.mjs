import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomInt } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

const token = '123456:location-api-test-fixture';
const now = Date.parse('2026-10-11T03:00:00.000Z');
const point = { lat: 35.6895123, lng: 139.7005123, accuracy: 12 };
const image = { mimeType: 'image/png', data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') };

function signed(id = 101) {
  const fields = { auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id, first_name: `User ${id}`, language_code: 'zh' }) };
  const check = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
}

async function fixture(t, { resolver, parser, local = false } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-location-api-'));
  const geocodeCalls = [], parseCalls = [];
  const resolveLocation = async (...args) => {
    geocodeCalls.push(args);
    return resolver ? resolver(...args) : { ...args[0], area: '新宿', countryCode: 'JP' };
  };
  const aiParser = { enabled: true, async parse(input, settings) {
    parseCalls.push({ input, settings });
    return parser ? parser(input, settings) : [];
  } };
  let server;
  // This host can assign listen(0) a port blocked by Fetch. Match the store
  // fixture's safe high range and retry only an actual address collision.
  for (let attempt = 0; attempt < 12; attempt++) {
    server = createApp({ token: local ? '' : token, dataDir, resolveLocation, aiParser, now: () => now });
    server.listen(randomInt(20000, 60000), '127.0.0.1');
    try { await once(server, 'listening'); break; }
    catch (error) {
      await new Promise(resolve => server.close(resolve));
      if (error.code !== 'EADDRINUSE' || attempt === 11) throw error;
    }
  }
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await server.flushStore();
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-location-api-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  return {
    geocodeCalls, parseCalls,
    database: async () => { await server.flushStore(); return JSON.parse(await readFile(path.join(dataDir, '_pocket-v2.json'), 'utf8')); },
    request: async (route, { user = 101, body, bytes, method = 'POST', headers = {} } = {}) => {
      const response = await fetch(base + route, { method,
        headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Telegram-Init-Data': signed(user) } : {}), ...headers },
        body: bytes ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      return { status: response.status, data: await response.json() };
    },
  };
}

test('reverse location requires authentication before contacting a provider in remote mode', async t => {
  const f = await fixture(t);
  const result = await f.request('/location/reverse', { user: null, body: { location: point } });
  assert.equal(result.status, 401);
  assert.equal(f.geocodeCalls.length, 0);
});

test('reverse endpoint normalizes both caller and provider data and accepts latitude/longitude zero', async t => {
  const f = await fixture(t, { resolver: async input => ({ ...input, name: '  Cafe\nZero  ', area: ' Central ',
    countryCode: 'jp', address: ' A\u0000Street ', internal: 'private-provider-data', accuracy: 99 }) });
  const result = await f.request('/location/reverse', { body: { ledgerId: '101', location: { lat: 0, lng: 0, accuracy: 9, unexpected: 'ignore' } } });
  assert.equal(result.status, 200);
  assert.deepEqual(f.geocodeCalls, [[{ lat: 0, lng: 0, accuracy: 9 }, { language: 'zh' }]]);
  assert.deepEqual(result.data, { location: { lat: 0, lng: 0, name: 'Cafe Zero', area: 'Central', countryCode: 'JP', address: 'A Street' }, suggestedCurrency: 'JPY' });
  const database = await f.database();
  assert.ok(Object.values(database.ledgers).every(ledger => ledger.expenses.length === 0), 'reverse lookup is not an expense or a persisted trail');
  assert.ok(!JSON.stringify(database).includes('Cafe Zero'));
});

test('reverse endpoint rejects an outdated or foreign ledger before performing geocoding', async t => {
  const f = await fixture(t);
  const personal = await f.request('/profile', { method: 'GET' });
  const circle = await f.request('/circles/create', { body: { name: 'Location scope' } });
  assert.equal(circle.status, 200);
  const stale = await f.request('/location/reverse', { body: { ledgerId: personal.data.ledgerId, location: point } });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error, 'errorLedgerChanged');
  const foreign = await f.request('/location/reverse', { user: 202, body: { ledgerId: circle.data.ledgerId, location: point } });
  assert.equal(foreign.status, 409);
  assert.equal(f.geocodeCalls.length, 0);
});

test('late geocoding results are discarded if the user changes ledgers while resolving', async t => {
  let started, release;
  const waiting = new Promise(resolve => { started = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { resolver: async input => { started(); await resume; return { ...input, name: 'Delayed cafe', countryCode: 'JP' }; } });
  const pending = f.request('/location/reverse', { body: { ledgerId: '101', location: point } });
  await waiting;
  try {
    assert.equal((await f.request('/circles/create', { body: { name: 'Changed during lookup' } })).status, 200);
  } finally { release(); }
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(result.data.error, 'errorLedgerChanged');
  const database = await f.database();
  assert.ok(Object.values(database.ledgers).every(ledger => ledger.expenses.length === 0));
  assert.ok(!JSON.stringify(database).includes('Delayed cafe'));
});

test('declined location, missing coordinates and malformed optional metadata degrade to a successful empty result', async t => {
  const f = await fixture(t);
  for (const location of [undefined, null, false, [], 'denied', {}, { lat: 91, lng: 139 }, { lat: '35.6', lng: 139 }, { lat: null, lng: false }]) {
    const result = await f.request('/location/reverse', { body: { location } });
    assert.equal(result.status, 200, JSON.stringify(location));
    assert.deepEqual(result.data, { location: null, suggestedCurrency: null });
  }
  assert.equal(f.geocodeCalls.length, 0);
  const invalidBody = await f.request('/location/reverse', { body: null });
  assert.equal(invalidBody.status, 400);
  assert.equal(invalidBody.data.error, 'errorJson');
});

test('provider errors retain valid coordinates while unknown country never defaults to USD', async t => {
  const f = await fixture(t, { resolver: async () => { throw new Error('private upstream error'); } });
  const result = await f.request('/location/reverse', { body: { location: point } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { location: { lat: 35.689512, lng: 139.700512 }, suggestedCurrency: null });
  assert.ok(!JSON.stringify(result.data).includes('private upstream'));
  const unknown = await f.request('/location/reverse', { body: { location: { name: 'Somewhere', countryCode: 'ZZ' } } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.suggestedCurrency, null);
  assert.equal(f.geocodeCalls.length, 1, 'venue-only metadata does not trigger a GPS lookup');
});

test('local-only mode permits optional reverse lookup without an account', async t => {
  const f = await fixture(t, { local: true });
  const result = await f.request('/location/reverse', { user: null, body: { language: 'uk', location: point } });
  assert.equal(result.status, 200);
  assert.equal(result.data.suggestedCurrency, 'JPY');
  assert.equal(f.geocodeCalls[0][1].language, 'uk');
});

test('parse API passes sanitized numeric location context and explicit input choices to the parser', async t => {
  const f = await fixture(t);
  const result = await f.request('/ai/parse-expense', { body: { text: '850', ledgerId: '101', currency: 'CNY', categoryId: 'learning', type: 'expense',
    locationContext: { ...point, name: ' Lawson\nShop ', countryCode: 'jp', extra: 'ignore', area: '新宿' } } });
  assert.equal(result.status, 200);
  const input = f.parseCalls[0].input;
  assert.deepEqual(input.locationContext, { lat: 35.689512, lng: 139.700512, name: 'Lawson Shop', countryCode: 'JP', area: '新宿' });
  assert.equal(input.currency, 'CNY');
  assert.equal(input.categoryId, 'learning');
  assert.equal(input.type, 'expense');
  assert.equal(input.text, '850');
  assert.equal(input.now, now);
  assert.equal(f.geocodeCalls.length, 0, 'parse uses the supplied context rather than doing another location lookup');
});

test('parse API never forwards the current location into images, PDFs or extracted document text', async t => {
  const f = await fixture(t);
  for (const attachment of [
    { image },
    { file: { mimeType: 'application/pdf', data: Buffer.from('%PDF-fixture').toString('base64') } },
    { file: { mimeType: 'text/plain', data: Buffer.from('850').toString('base64') } },
    { file: { mimeType: 'text/csv', data: Buffer.from('850').toString('base64') } },
  ]) {
    const result = await f.request('/ai/parse-expense', { body: { ...attachment, text: '850', locationContext: { ...point, name: 'Current venue' }, currency: 'USD', categoryId: 'stomach' } });
    assert.equal(result.status, 200);
    assert.equal(f.parseCalls.at(-1).input.locationContext, undefined);
    assert.equal(f.parseCalls.at(-1).input.currency, undefined);
    assert.equal(f.parseCalls.at(-1).input.categoryId, undefined);
  }
  const raw = await f.request('/ai/parse-expense', { bytes: '850', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(raw.status, 200);
  assert.equal(f.parseCalls.at(-1).input.locationContext, undefined);
});

test('parse API rejects unauthenticated or stale-context location requests without calling the model', async t => {
  const f = await fixture(t);
  const body = { text: '850', locationContext: { ...point, name: 'Cafe' } };
  assert.equal((await f.request('/ai/parse-expense', { user: null, body })).status, 401);
  assert.equal((await f.request('/circles/create', { body: { name: 'New active ledger' } })).status, 200);
  const result = await f.request('/ai/parse-expense', { body: { ...body, ledgerId: '101' } });
  assert.equal(result.status, 409);
  assert.equal(result.data.error, 'errorLedgerChanged');
  assert.equal(f.parseCalls.length, 0);
});
