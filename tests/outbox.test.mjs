import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTBOX_KEY, readOutbox, writeOutbox, isRetryableWriteError, nextRetryDelay } from '../src/outbox.mjs';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values };
};
const write = (id = 'e1') => ({ scope: 'u_alice:u_alice', payload: { id, amountMinor: 500 }, optimistic: { id, amountMinor: 500 } });

test('outbox survives a full close and restores only well-formed writes', () => {
  const store = storage();
  writeOutbox([write(), write('e2')], store);
  assert.deepEqual(readOutbox(store).map(item => item.payload.id), ['e1', 'e2']);
  // A closed app loses nothing: a fresh read in a new session sees them.
  assert.equal(readOutbox(store).length, 2);
  store.setItem(OUTBOX_KEY, JSON.stringify([{ scope: 'x', payload: {}, optimistic: {} }, write('e3'), 'junk']));
  assert.deepEqual(readOutbox(store).map(item => item.payload.id), ['e3']);
  store.setItem(OUTBOX_KEY, '{broken');
  assert.deepEqual(readOutbox(store), []);
});

test('outbox clears itself once every write is confirmed', () => {
  const store = storage();
  writeOutbox([write()], store);
  writeOutbox([], store);
  assert.equal(store.values.has(OUTBOX_KEY), false);
});

test('only transient failures auto-retry; permanent rejections wait for a human', () => {
  assert.equal(isRetryableWriteError(new Error('errorNetwork')), true);
  assert.equal(isRetryableWriteError(new Error('errorSave')), true);
  assert.equal(isRetryableWriteError(Object.assign(new Error('x'), { status: 503 })), true);
  assert.equal(isRetryableWriteError(Object.assign(new Error('x'), { status: 429 })), true);
  assert.equal(isRetryableWriteError(Object.assign(new Error('x'), { status: 408 })), true);
  assert.equal(isRetryableWriteError(new Error('errorDeleted')), false);
  assert.equal(isRetryableWriteError(new Error('errorCapacity')), false);
  assert.equal(isRetryableWriteError(new Error('errorLedgerChanged')), false);
  assert.equal(isRetryableWriteError(Object.assign(new Error('x'), { status: 401 })), false);
  assert.equal(isRetryableWriteError(Object.assign(new Error('x'), { status: 422 })), false);
});

test('retry backoff grows and caps instead of hammering the server', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(nextRetryDelay), [5000, 10000, 20000, 40000, 80000, 80000]);
});
