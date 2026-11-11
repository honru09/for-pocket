import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_CACHE_KEY, readProfileCache, writeProfileCache, clearProfileCache } from '../src/profile-cache.mjs';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values };
};
const profile = () => ({
  ledgerId: 'u_alice',
  settings: { language: 'zh', currency: 'JPY', categories: [], consumers: [{ id: 'u_alice' }] },
  expenses: [{ id: 'e1', amountMinor: 1200 }],
  user: { id: 'u_alice', name: 'Alice' },
  account: { hasGoogle: true, hasTelegram: true },
  social: { circles: [], activeCircleId: null, activeCircle: null },
});

test('profile cache round-trips a confirmed remote profile for instant reopen', () => {
  const store = storage();
  assert.equal(writeProfileCache(profile(), store), true);
  assert.deepEqual(readProfileCache(store), profile());
});

test('profile cache never persists a session token', () => {
  const store = storage();
  writeProfileCache({ ...profile(), sessionToken: 'SECRET-TOKEN' }, store);
  assert.doesNotMatch([...store.values.values()].join(''), /SECRET-TOKEN/);
  assert.equal(readProfileCache(store).sessionToken, undefined);
});

test('profile cache refuses local previews and malformed profiles', () => {
  const store = storage();
  assert.equal(writeProfileCache({ ...profile(), ledgerId: 'local', user: { id: 'u_local' } }, store), false);
  assert.equal(writeProfileCache({ ...profile(), expenses: null }, store), false);
  assert.equal(writeProfileCache(null, store), false);
  assert.equal(store.values.has(PROFILE_CACHE_KEY), false);
  store.setItem(PROFILE_CACHE_KEY, '{broken json');
  assert.equal(readProfileCache(store), null);
  store.setItem(PROFILE_CACHE_KEY, JSON.stringify({ version: 2, savedAt: 1, profile: profile() }));
  assert.equal(readProfileCache(store), null);
});

test('clearing the profile cache forces the next open back to the network path', () => {
  const store = storage();
  writeProfileCache(profile(), store);
  clearProfileCache(store);
  assert.equal(readProfileCache(store), null);
});

test('a cache tagged with one Telegram account is invisible to another', () => {
  const store = storage();
  writeProfileCache(profile(), store, { telegramId: 111 });
  assert.deepEqual(readProfileCache(store, { telegramId: 111 }), profile());
  assert.equal(readProfileCache(store, { telegramId: 222 }), null);
  // Untagged legacy caches and untagged reads stay usable (one-time migration).
  const legacy = storage();
  writeProfileCache(profile(), legacy);
  assert.deepEqual(readProfileCache(legacy, { telegramId: 222 }), profile());
});

test('an oversized profile is trimmed to its newest entries instead of dropped', () => {
  const store = storage();
  const big = profile();
  big.expenses = Array.from({ length: 500 }, (_, i) => ({
    id: `e${i}`, amountMinor: 100, occurredAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), note: 'x'.repeat(12000),
  }));
  assert.equal(writeProfileCache(big, store), true);
  const cached = readProfileCache(store);
  assert.ok(cached.expenses.length < big.expenses.length, 'cache must be trimmed');
  assert.ok(cached.expenses.length >= 80, 'cache keeps a useful recent window');
  const times = cached.expenses.map(e => e.occurredAt);
  assert.equal(times[0], big.expenses.at(-1).occurredAt, 'newest entries survive trimming');
});
