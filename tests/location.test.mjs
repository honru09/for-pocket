import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { normalizeLocation, currencyForCountry, locationLabel, locationArea, summarizeFootprints } from '../public/location.mjs';
import { CURRENCIES, initialSettings, validateExpense } from '../public/shared.mjs';
import { createLocationResolver } from '../location.mjs';
import { createStore, emptyState } from '../store.mjs';
import { ensureUser, handleDomain, visible, hash } from '../domain.mjs';

const tokyo = { lat: 35.6895, lng: 139.7005 };
const venue = { ...tokyo, name: 'ローソン 新宿店', address: '新宿区', countryCode: 'JP', area: '新宿' };
const profile = { ...initialSettings(), consumers: [{ id: 'u_101', name: 'Me', color: 'milk', avatar: 'cloud' }] };
const expense = extras => ({ id: 'location-expense-001', currency: 'JPY', amountMinor: 850, categoryId: 'stomach', consumer: 'u_101', note: '', timezone: 'Asia/Tokyo', ...extras });
const photon = (extras = {}) => ({ features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [tokyo.lng, tokyo.lat] }, properties: { name: 'ローソン 新宿店', district: '新宿', city: '東京都', countrycode: 'JP', osm_key: 'shop', osm_value: 'convenience', ...extras } }] });
const response = data => ({ ok: true, async json() { return data; } });
const resolver = (name, options = {}) => createLocationResolver({ provider: 'photon', endpoint: `https://${name}.test/reverse`, minIntervalMs: 0, ...options });
const domain = (db, uid, route, body = {}, method = 'POST') => handleDomain(db, uid, route, method, body, { now: Date.UTC(2026, 9, 11), limit() {} });
function accounts() {
  const db = emptyState();
  for (const id of ['101', '202', '303']) ensureUser(db, `telegram:${id}`);
  db.telegram = { locations: {} };
  return db;
}
function pending(db, uid, ledgerId = uid) {
  db.telegram.locations[`${uid}:${uid}`] = { uid, chatId: Number(uid), ledgerId, location: venue, expiresAt: Date.UTC(2026, 9, 12) };
}

test('optional location sanitization handles zero, boundaries, unsafe input and invalid coordinate pairs', () => {
  assert.deepEqual(normalizeLocation({ lat: 0, lng: 0 }), { lat: 0, lng: 0 });
  assert.deepEqual(normalizeLocation({ lat: -90, lng: 180 }), { lat: -90, lng: 180 });
  for (const input of [null, undefined, [], 'somewhere', {}, { lat: 90.01, lng: 1 }, { lat: 1, lng: Infinity }, { lat: '1', lng: 2 }, { lat: null, lng: 1 }, { lat: 1 }]) assert.equal(normalizeLocation(input), undefined);
  assert.deepEqual(normalizeLocation({ lat: NaN, lng: 2, name: ' Café\u0000\n cloud ', countryCode: ' jp ', secret: 'discarded' }), { name: 'Café cloud', countryCode: 'JP' });
  const long = normalizeLocation({ name: '🐱'.repeat(200), address: 'a'.repeat(400), area: 'b'.repeat(100), countryCode: 'Japan' });
  assert.equal(Array.from(long.name).length, 120);
  assert.equal(long.address.length, 240);
  assert.equal(long.area.length, 80);
  assert.equal(long.countryCode, undefined);
});

test('country currency recommendations are supported and unknown countries never silently become USD', () => {
  for (const [country, currency] of Object.entries({ JP: 'JPY', CN: 'CNY', US: 'USD', UA: 'UAH', KR: 'KRW', TW: 'TWD', HK: 'HKD', SG: 'SGD', AU: 'AUD', CA: 'CAD', GB: 'GBP', CH: 'CHF', DE: 'EUR', FR: 'EUR' })) {
    assert.equal(currencyForCountry(country.toLowerCase()), currency);
    assert.ok(Object.hasOwn(CURRENCIES, currency));
  }
  for (const country of ['', undefined, 'ZZ', 'constructor', '__proto__']) assert.equal(currencyForCountry(country), undefined);
});

test('location labels and footprints use districts and omit nonspending/deleted entries', () => {
  assert.equal(locationLabel(venue), 'ローソン 新宿店');
  assert.equal(locationLabel({ area: '新宿', name: 'ローソン' }), '新宿 · ローソン');
  assert.equal(locationLabel({ area: '新宿', name: '新宿カフェ' }), '新宿カフェ');
  assert.equal(locationLabel(tokyo), '');
  assert.equal(locationArea(venue), '新宿');
  assert.deepEqual(summarizeFootprints([
    { location: venue }, { location: { ...venue, name: 'Cafe' } }, { location: { area: '渋谷' } },
    { location: venue, type: 'income' }, { location: venue, recordKind: 'transfer' }, { location: venue, recordKind: 'reimbursement' },
    { location: venue, deletedAt: 'today' }, {},
  ]), [{ name: '新宿', count: 2 }, { name: '渋谷', count: 1 }]);
});

test('validateExpense keeps only optional normalized location without changing legacy payloads', () => {
  const original = expense();
  assert.equal(Object.hasOwn(validateExpense(original, profile), 'location'), false);
  assert.deepEqual(validateExpense(expense({ location: venue }), profile).location, venue);
  assert.equal(Object.hasOwn(validateExpense(expense({ location: { lat: 999, lng: 4 } }), profile), 'location'), false);
  assert.deepEqual(validateExpense(expense({ location: { ...venue, token: 'hidden' } }), profile).location, venue);
});

test('location survives authorized creation, retry, time edits and store restart', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-location-test-'));
  let store = createStore(dataDir);
  t.after(async () => {
    await store.close();
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-location-test-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  const first = await store.run(db => {
    ensureUser(db, 'telegram:101');
    return domain(db, '101', '/expenses', expense({ location: venue }));
  });
  assert.deepEqual(first.location, venue);
  await store.run(db => {
    const retry = domain(db, '101', '/expenses', expense({ location: { name: 'different' } }));
    assert.deepEqual(retry.location, venue);
    domain(db, '101', `/expenses/${first.id}`, { occurredAt: '2026-10-10T03:00:00.000Z', timezone: 'Asia/Tokyo' }, 'PUT');
  });
  await store.close();
  store = createStore(dataDir);
  const saved = await store.run(db => visible(db, '101').expenses);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].location, venue);
  assert.equal(saved[0].occurredAt, '2026-10-10T03:00:00.000Z');
});

test('resolver skips invalid coordinates and preserves explicit venue on transport failure', async () => {
  let calls = 0;
  const resolve = resolver('invalid', { fetchImpl: async () => { calls++; throw new Error('offline'); } });
  assert.equal(await resolve({ lat: 181, lng: 3 }), undefined);
  assert.deepEqual(await resolve({ name: 'Cafe' }), { name: 'Cafe' });
  assert.equal(calls, 0);
  assert.deepEqual(await resolve(venue), venue);
  assert.deepEqual(await resolve(venue), venue);
  assert.equal(calls, 1, 'failed locations are briefly cached to avoid hammering the provider');
});

test('Photon resolves district/country with identifying headers and only a precise nearby merchant suggestion', async () => {
  const requests = [];
  const resolve = resolver('photon', { fetchImpl: async (url, options) => { requests.push({ url, options }); return response(photon()); } });
  const place = await resolve({ ...tokyo, accuracy: 12 }, { language: 'zh' });
  assert.equal(place.countryCode, 'JP');
  assert.equal(place.area, '新宿');
  assert.equal(place.name, venue.name);
  assert.equal(place.accuracy, undefined);
  assert.equal(requests[0].url.searchParams.get('lat'), String(tokyo.lat));
  assert.equal(requests[0].url.searchParams.get('limit'), '1');
  assert.equal(requests[0].url.searchParams.has('lang'), false);
  assert.match(requests[0].options.headers['User-Agent'], /for-pocket/);
  assert.equal((await resolve(tokyo)).name, undefined, 'unknown GPS accuracy must not claim a visited merchant');
  assert.equal((await resolve({ ...tokyo, accuracy: 200 })).name, undefined);
  assert.equal((await resolve({ ...tokyo, accuracy: 12, name: 'My chosen venue', address: 'My address' })).name, 'My chosen venue');
  assert.equal((await resolve({ ...tokyo, accuracy: 12, name: 'My chosen venue', address: 'My address' })).address, 'My address');
});

test('reverse nearby streets and distant POIs are not reported as visited businesses', async () => {
  const street = resolver('street', { fetchImpl: async () => response(photon({ osm_key: 'highway', osm_value: 'residential', name: 'Some road' })) });
  assert.equal((await street({ ...tokyo, accuracy: 1 })).name, undefined);
  const data = photon(); data.features[0].geometry.coordinates[1] += 0.01;
  const distant = resolver('distant', { fetchImpl: async () => response(data) });
  assert.equal((await distant({ ...tokyo, accuracy: 1 })).name, undefined);
});

test('Photon geographic feature names remain useful when hierarchy fields are absent', async () => {
  for (const [type,name] of [['suburb','新宿'],['city','Kyiv'],['village','Kamakura']]) {
    const resolve = resolver(`named-area-${type}`,{fetchImpl:async()=>response(photon({osm_key:'place',osm_value:type,name,district:undefined,city:undefined}))});
    const place = await resolve(tokyo);
    assert.equal(place.area,name);
    assert.equal(locationLabel(place),name);
    assert.equal(place.name,undefined,'a geographic area is not a visited merchant');
  }
  const road = resolver('named-road',{fetchImpl:async()=>response(photon({osm_key:'highway',osm_value:'residential',name:'神楽坂通り',district:undefined,city:undefined}))});
  assert.equal(locationLabel(await road(tokyo)),'神楽坂通り');
  const unknown = resolver('unclassified-name',{fetchImpl:async()=>response(photon({osm_key:'building',osm_value:'yes',name:'Some building',district:undefined,city:undefined}))});
  assert.equal(locationLabel(await unknown(tokyo)),'');
});

test('singleflight cache shares geographic data without leaking one callers explicit venue to another', async () => {
  let calls = 0, release;
  const waiting = new Promise(resolve => { release = resolve; });
  const resolve = resolver('singleflight', { fetchImpl: async () => { calls++; await waiting; return response(photon()); } });
  const first = resolve({ ...tokyo, name: 'Private venue A' });
  const second = resolve({ ...tokyo, name: 'Private venue B' });
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.name, 'Private venue A');
  assert.equal(b.name, 'Private venue B');
  assert.equal((await resolve(tokyo)).name, undefined);
  assert.equal(calls, 1);
});

test('cache expiry and bounds permit new lookups without retaining every coordinate', async () => {
  let time = 1000, calls = 0;
  const resolve = resolver('cache', { now: () => time, ttlMs: 20, maxEntries: 1, fetchImpl: async () => { calls++; return response(photon()); } });
  await resolve(tokyo); await resolve(tokyo);
  assert.equal(calls, 1);
  time += 21;
  await resolve(tokyo);
  assert.equal(calls, 2);
  await resolve({ lat: tokyo.lat + 1, lng: tokyo.lng });
  await resolve(tokyo);
  assert.equal(calls, 4);
});

test('resolver timeout aborts a stalled request and returns usable raw coordinates', async () => {
  let signal;
  const resolve = resolver('timeout', { timeoutMs: 25, fetchImpl: async (_, options) => { signal = options.signal; return new Promise(() => {}); } });
  assert.deepEqual(await resolve(tokyo), tokyo);
  assert.equal(signal.aborted, true);
});

test('malformed response, HTTP errors and empty coverage quietly keep the original location', async () => {
  for (const [index, fetchImpl] of [
    async () => ({ ok: false }), async () => ({ ok: true, json() { throw new Error('invalid json'); } }),
    async () => response({ features: [] }), async () => response(null),
  ].entries()) {
    assert.deepEqual(await resolver(`failure-${index}`, { fetchImpl })(tokyo), tokyo);
  }
});

test('Nominatim is configurable and public use needs explicit single-instance acknowledgment', async () => {
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    assert.equal(url.searchParams.get('format'), 'jsonv2');
    assert.equal(url.searchParams.get('accept-language'), 'uk');
    return response({ name: 'Cafe', category: 'amenity', type: 'cafe', lat: String(tokyo.lat), lon: String(tokyo.lng), address: { country_code: 'jp', suburb: '新宿', city: '東京都' } });
  };
  const blocked = createLocationResolver({ provider: 'nominatim', endpoint: 'https://nominatim.openstreetmap.org/reverse', allowPublicNominatim: false, fetchImpl });
  assert.deepEqual(await blocked(tokyo), tokyo);
  assert.equal(calls, 0);
  const configured = createLocationResolver({ provider: 'nominatim', endpoint: 'https://private-nominatim.test/reverse', fetchImpl, minIntervalMs: 0 });
  const result = await configured({ ...tokyo, accuracy: 20 }, { language: 'uk' });
  assert.equal(result.name, 'Cafe');
  assert.equal(result.countryCode, 'JP');
  assert.equal(calls, 1);
});

test('provider requests are paced and excessive queueing silently falls back', async () => {
  let time = 1000;
  const starts = [], delays = [];
  const resolve = resolver('pacing', {
    now: () => time, minIntervalMs: 1000, timeoutMs: 3000,
    sleep: async ms => { delays.push(ms); time += ms; },
    fetchImpl: async () => { starts.push(time); return response(photon()); },
  });
  await resolve(tokyo);
  await resolve({ ...tokyo, lat: tokyo.lat + 1 });
  await resolve({ ...tokyo, lat: tokyo.lat + 2 });
  assert.deepEqual(starts, [1000, 2000, 3000]);
  assert.deepEqual(delays, [1000, 1000]);
  const overloaded = resolver('overloaded', { minIntervalMs: 1000, timeoutMs: 20, fetchImpl: async () => response(photon()) });
  await overloaded(tokyo);
  const other = { lat: 1, lng: 2 };
  assert.deepEqual(await overloaded(other), other);
});

test('circle creation and switching discard pending places even after switching back', () => {
  const db = accounts(); pending(db, '101'); pending(db, '202');
  const circle = domain(db, '101', '/circles/create', { name: 'Together' }).social.activeCircleId;
  assert.equal(db.telegram.locations['101:101'], undefined);
  assert.ok(db.telegram.locations['202:202']);
  pending(db, '101', circle);
  db.telegram.updates = { retry: { locationEntry: { ...db.telegram.locations['101:101'] } }, other: { locationEntry: { ...db.telegram.locations['202:202'] } } };
  domain(db, '101', '/circles/switch', {});
  domain(db, '101', '/circles/switch', { circleId: circle });
  assert.equal(db.telegram.locations['101:101'], undefined);
  assert.equal(db.telegram.updates.retry.locationEntry, undefined);
  assert.equal(db.telegram.updates.other.locationEntry.uid, '202');
});

test('joining, leaving and member removal invalidate only the affected users pending place', () => {
  const db = accounts();
  const circle = domain(db, '101', '/circles/create', { name: 'Together' }).social.activeCircleId;
  const invite = domain(db, '101', '/circles/invite', { circleId: circle });
  pending(db, '202'); pending(db, '303');
  domain(db, '202', '/circles/join', { code: invite.code, confirm: true });
  assert.equal(db.telegram.locations['202:202'], undefined);
  assert.ok(db.telegram.locations['303:303']);
  pending(db, '202', circle);
  domain(db, '101', '/circles/remove', { circleId: circle, memberId: 'u_202', confirm: true });
  assert.equal(db.telegram.locations['202:202'], undefined);
  pending(db, '101', circle);
  domain(db, '101', '/circles/leave', { circleId: circle, confirm: true });
  assert.equal(db.telegram.locations['101:101'], undefined);
});

test('account merging invalidates both users pending locations and preserves saved expense location', () => {
  const db = accounts();
  const target = ensureUser(db, 'google:example-user');
  domain(db, '101', '/expenses', expense({ location: venue }));
  pending(db, '101'); pending(db, target); pending(db, '303');
  db.links[hash('ABCDEF')] = { userId: target, expiresAt: Date.UTC(2026, 9, 12) };
  const result = domain(db, '101', '/auth/link-verify', { code: 'ABCDEF', confirm: true });
  assert.equal(db.telegram.locations['101:101'], undefined);
  assert.equal(db.telegram.locations[`${target}:${target}`], undefined);
  assert.ok(db.telegram.locations['303:303']);
  assert.deepEqual(result.profile.expenses[0].location, venue);
});
