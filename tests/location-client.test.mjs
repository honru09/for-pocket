import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocationClient, locationPreference } from '../src/location-client.mjs';

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function browser({ permission = 'granted', result = { latitude: 35.6895, longitude: 139.7005, accuracy: 12 }, error, delayed = false } = {}) {
  const calls = { permissions: 0, positions: 0, options: [], callbacks: [] };
  const navigator = {
    permissions: { async query(options) {
      calls.permissions++;
      assert.deepEqual(options, { name: 'geolocation' });
      if (permission instanceof Error) throw permission;
      return { state: permission };
    } },
    geolocation: {
      getCurrentPosition(success, failure, options) {
        calls.positions++;
        calls.options.push(options);
        calls.callbacks.push({ success, failure });
        if (!delayed) error ? failure(error) : success({ coords: result });
      },
      watchPosition() { assert.fail('background position watching is prohibited'); },
      clearWatch() { assert.fail('the client should never create a location watch'); },
    },
  };
  return { navigator, calls };
}

test('silent location capture never opens permission prompts in denied, prompt or unsupported states', async () => {
  for (const permission of ['prompt', 'denied', undefined, new Error('unsupported')]) {
    const nav = browser({ permission });
    if (permission === undefined) delete nav.navigator.permissions;
    const client = createLocationClient({ navigator: nav.navigator });
    assert.equal(await client.capture(), null);
    assert.equal(nav.calls.positions, 0);
  }
});

test('granted browser location is single-shot, low power, and preserves zero coordinates', async () => {
  const nav = browser({ result: { latitude: 0, longitude: 0, accuracy: 18 } });
  const client = createLocationClient({ navigator: nav.navigator, maxAge: 45000, timeout: 1200 });
  assert.deepEqual(await client.capture(), { lat: 0, lng: 0, accuracy: 18 });
  assert.equal(nav.calls.positions, 1);
  assert.deepEqual(nav.calls.options, [{ enableHighAccuracy: false, maximumAge: 45000, timeout: 1200 }]);
});

test('foreground refresh requests a fresh browser position without enabling a watch', async () => {
  const nav = browser();
  const client = createLocationClient({ navigator: nav.navigator, maxAge: 60000 });
  await client.capture();
  await client.capture({ refresh: true });
  assert.equal(nav.calls.positions, 2);
  assert.equal(nav.calls.options[1].maximumAge, 0);
});

test('explicit capture can request browser permission but rejection and unavailable GPS remain silent', async () => {
  for (const code of [1, 2, 3]) {
    const nav = browser({ permission: 'prompt', error: { code } });
    const client = createLocationClient({ navigator: nav.navigator });
    assert.equal(await client.capture({ allowPrompt: true }), null);
    assert.equal(nav.calls.positions, 1);
  }
  const denied = browser({ permission: 'denied' });
  assert.equal(await createLocationClient({ navigator: denied.navigator }).capture({ allowPrompt: true }), null);
  assert.equal(denied.calls.positions, 0);
  assert.equal(await createLocationClient({ navigator: {} }).capture({ allowPrompt: true }), null);
});

test('Telegram 8 LocationManager initializes and takes precedence over browser GPS', async () => {
  const nav = browser();
  const calls = { init: 0, get: 0, versions: [] };
  const manager = {
    isInited: false, isLocationAvailable: true, isAccessGranted: true,
    init(callback) { calls.init++; this.isInited = true; callback(); },
    getLocation(callback) { calls.get++; callback({ latitude: 0, longitude: 139.7, horizontal_accuracy: 7 }); },
  };
  const telegram = { LocationManager: manager, isVersionAtLeast(version) { calls.versions.push(version); return true; } };
  const client = createLocationClient({ telegram, navigator: nav.navigator });
  assert.deepEqual(await client.capture(), { lat: 0, lng: 139.7, accuracy: 7 });
  assert.deepEqual(calls, { init: 1, get: 1, versions: ['8.0'] });
  assert.equal(nav.calls.positions, 0);
  assert.equal(nav.calls.permissions, 0);
});

test('Telegram location prompts only after an explicit request and does not cascade denied access into a browser prompt', async () => {
  const nav = browser({ permission: 'prompt' });
  let gets = 0;
  const manager = {
    isInited: true, isLocationAvailable: true, isAccessGranted: false, isAccessRequested: false,
    init() { assert.fail('already initialized'); },
    getLocation(callback) { gets++; this.isAccessRequested = true; callback(null); },
  };
  const client = createLocationClient({ telegram: { LocationManager: manager }, navigator: nav.navigator });
  assert.equal(await client.capture(), null);
  assert.equal(gets, 0);
  assert.equal(await client.capture({ allowPrompt: true }), null);
  assert.equal(gets, 1);
  assert.equal(await client.capture({ allowPrompt: true }), null);
  assert.equal(gets, 1, 'previously denied Telegram access must not keep prompting');
  assert.equal(nav.calls.positions, 0);
});

test('older or unavailable Telegram location gracefully falls back to browser geolocation', async () => {
  for (const available of [false, true]) {
    const nav = browser();
    const telegram = {
      isVersionAtLeast() { return !available; },
      LocationManager: { isInited: true, isLocationAvailable: available,
        init() { assert.fail('unused Telegram initialization'); }, getLocation() { assert.fail('unsupported Telegram GPS'); } },
    };
    assert.deepEqual(await createLocationClient({ telegram, navigator: nav.navigator }).capture(), { lat: 35.6895, lng: 139.7005, accuracy: 12 });
    assert.equal(nav.calls.positions, 1);
  }
});

test('concurrent captures share one acquisition, reuse a short cache, and refresh only on demand or expiry', async () => {
  const nav = browser({ delayed: true });
  let now = 1000;
  const client = createLocationClient({ navigator: nav.navigator, now: () => now, maxAge: 1000 });
  const first = client.capture(), second = client.capture(), third = client.capture({ refresh: true });
  await nextTurn();
  assert.equal(nav.calls.positions, 1);
  nav.calls.callbacks[0].success({ coords: { latitude: 35, longitude: 139 } });
  assert.deepEqual(await Promise.all([first, second, third]), Array.from({ length: 3 }, () => ({ lat: 35, lng: 139 })));
  now = 1999;
  assert.deepEqual(await client.capture(), { lat: 35, lng: 139 });
  assert.equal(nav.calls.positions, 1);
  now = 2000;
  const expired = client.capture();
  await nextTurn();
  assert.equal(nav.calls.positions, 2);
  nav.calls.callbacks[1].success({ coords: { latitude: 36, longitude: 140 } });
  assert.deepEqual(await expired, { lat: 36, lng: 140 });
  client.clear();
  const cleared = client.capture();
  await nextTurn();
  assert.equal(nav.calls.positions, 3);
  nav.calls.callbacks[2].success({ coords: { latitude: 37, longitude: 141 } });
  assert.deepEqual(await cleared, { lat: 37, lng: 141 });
});

test('a timed-out GPS callback is ignored and does not poison the next one-shot capture', async () => {
  const nav = browser({ delayed: true });
  const client = createLocationClient({ navigator: nav.navigator, timeout: 10 });
  assert.equal(await client.capture(), null);
  nav.calls.callbacks[0].success({ coords: { latitude: 20, longitude: 20 } });
  const next = client.capture();
  await nextTurn();
  assert.equal(nav.calls.positions, 2);
  nav.calls.callbacks[1].success({ coords: { latitude: 0, longitude: 0 } });
  assert.deepEqual(await next, { lat: 0, lng: 0 });
});

test('clearing during acquisition invalidates the old result and cannot overwrite or cancel a newer request', async () => {
  const nav = browser({ delayed: true });
  const client = createLocationClient({ navigator: nav.navigator });
  const stale = client.capture();
  await nextTurn();
  assert.equal(nav.calls.positions, 1);
  client.clear();
  const fresh = client.capture();
  await nextTurn();
  assert.equal(nav.calls.positions, 2);
  nav.calls.callbacks[0].success({ coords: { latitude: 20, longitude: 20 } });
  assert.equal(await stale, null);
  const joined = client.capture();
  await nextTurn();
  assert.equal(nav.calls.positions, 2, 'completion of the old request must not clear the new in-flight request');
  nav.calls.callbacks[1].success({ coords: { latitude: 0, longitude: 0 } });
  assert.deepEqual(await Promise.all([fresh, joined]), [{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }]);
  assert.deepEqual(await client.capture(), { lat: 0, lng: 0 });
  assert.equal(nav.calls.positions, 2);
});

test('clearing while permission checks are pending prevents a later GPS prompt after opt-out', async () => {
  const nav = browser({ permission: 'prompt' });
  let permissionReady;
  nav.navigator.permissions.query = () => new Promise(resolve => { permissionReady = resolve; });
  const client = createLocationClient({ navigator: nav.navigator });
  const pending = client.capture({ allowPrompt: true });
  client.clear();
  permissionReady({ state: 'prompt' });
  assert.equal(await pending, null);
  assert.equal(nav.calls.positions, 0, 'an opt-out must cancel the work before a permission prompt is opened');
});

test('clearing while Telegram initializes prevents a later Telegram location prompt', async () => {
  let initialized, gets = 0;
  const manager = { isInited: false, isLocationAvailable: true, isAccessGranted: false, isAccessRequested: false,
    init(callback) { initialized = callback; }, getLocation(callback) { gets++; callback(null); } };
  const client = createLocationClient({ telegram: { LocationManager: manager }, navigator: {} });
  const pending = client.capture({ allowPrompt: true });
  client.clear();
  manager.isInited = true;
  initialized();
  assert.equal(await pending, null);
  assert.equal(gets, 0);
});

test('stalled Telegram initialization falls back without blocking normal recording', async () => {
  const nav = browser();
  const telegram = { LocationManager: { isInited: false, init() {}, getLocation() { assert.fail('not initialized'); } } };
  assert.deepEqual(await createLocationClient({ telegram, navigator: nav.navigator, timeout: 10 }).capture(), { lat: 35.6895, lng: 139.7005, accuracy: 12 });
});

test('a stalled Permissions API is also bounded and silently leaves capture unavailable', async () => {
  const nav = browser();
  nav.navigator.permissions.query = () => new Promise(() => {});
  const client = createLocationClient({ navigator: nav.navigator, timeout: 10 });
  let timer;
  const outcome = await Promise.race([
    client.capture().then(value => ({ value })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ hung: true }), 100); }),
  ]);
  clearTimeout(timer);
  assert.deepEqual(outcome, { value: null });
  assert.equal(nav.calls.positions, 0);
});

test('successful location opt-in follows an account across its ledgers and tolerates blocked storage', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'localStorage', descriptor) : delete globalThis.localStorage);
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); }, removeItem(key) { values.delete(key); },
  } });
  assert.equal(locationPreference('user-1:ledger-1'), false);
  assert.equal(locationPreference('user-1:ledger-1', true), true);
  assert.equal(locationPreference('user-1:ledger-2'), true);
  assert.equal(locationPreference('user-2:ledger-1'), false);
  assert.equal(locationPreference('user-1:ledger-1', false), false);
  assert.equal(locationPreference('user-1:ledger-2'), false);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage blocked'); } });
  assert.equal(locationPreference('blocked', true), false);
});

test('a failed foreground refresh drops the prior GPS cache so it cannot reattach after revocation', async () => {
  const nav = browser();
  const client = createLocationClient({navigator:nav.navigator});
  assert.ok(await client.capture());
  nav.navigator.permissions.query = async()=>({state:'denied'});
  assert.equal(await client.capture({refresh:true,previouslyGranted:true}),null);
  assert.equal(await client.capture({previouslyGranted:true}),null);
  assert.equal(nav.calls.positions,1);
});

test('legacy ledger opt-in migrates across the same account and explicit off cannot be undone by old keys', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  t.after(()=>descriptor?Object.defineProperty(globalThis,'localStorage',descriptor):delete globalThis.localStorage);
  const values = new Map([['for-pocket.location.user-1:old-circle','on'],['for-pocket.location.user-2:other-circle','on']]);
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    get length(){return values.size;},key(index){return [...values.keys()][index];},
    getItem(key){return values.get(key)??null;},setItem(key,value){values.set(key,value);},removeItem(key){values.delete(key);},
  }});
  assert.equal(locationPreference('user-1:personal'),true);
  assert.equal(locationPreference('user-3:personal'),false);
  assert.equal(locationPreference('user-1:personal',false),false);
  assert.equal(locationPreference('user-1:old-circle'),false);
  assert.equal(locationPreference('user-2:personal'),true);
});

test('a previous successful grant supports browsers without Permissions API but never overrides known denial or prompt', async () => {
  const unsupported = browser();
  delete unsupported.navigator.permissions;
  assert.ok(await createLocationClient({navigator:unsupported.navigator}).capture({previouslyGranted:true,refresh:true}));
  assert.equal(unsupported.calls.positions,1);
  for (const permission of ['prompt','denied']) {
    const nav = browser({permission});
    assert.equal(await createLocationClient({navigator:nav.navigator}).capture({previouslyGranted:true,refresh:true}),null);
    assert.equal(nav.calls.positions,0);
  }
});
