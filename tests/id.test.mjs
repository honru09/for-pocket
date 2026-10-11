import test from 'node:test';
import assert from 'node:assert/strict';
import { createId } from '../src/id.mjs';

const VALID_ID = /^[a-zA-Z0-9_-]{8,64}$/;
function withCrypto(source, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: source });
  try { return callback(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
}

test('record IDs prefer the native UUID implementation', () => {
  const expected = 'fae26058-36c9-484a-8f7e-4f944e3852ce';
  let calls = 0;
  const source = {
    randomUUID() { assert.equal(this, source); calls++; return expected; },
    getRandomValues() { assert.fail('native UUID should be used first'); },
  };
  withCrypto(source, () => assert.equal(createId(), expected));
  assert.equal(calls, 1);
});

test('WebViews with getRandomValues but no randomUUID receive a UUIDv4', () => {
  const source = {
    getRandomValues(bytes) {
      assert.equal(this, source);
      assert.ok(bytes instanceof Uint8Array);
      assert.equal(bytes.length, 16);
      for (let index = 0; index < bytes.length; index++) bytes[index] = index;
      return bytes;
    },
  };
  withCrypto(source, () => {
    const id = createId();
    assert.equal(id, '00010203-0405-4607-8809-0a0b0c0d0e0f');
    assert.match(id, VALID_ID);
  });
});

test('a failing native UUID implementation can still use random bytes', () => {
  withCrypto({
    randomUUID() { throw new Error('unsupported'); },
    getRandomValues(bytes) { bytes.fill(255); return bytes; },
  }, () => assert.equal(createId(), 'ffffffff-ffff-4fff-bfff-ffffffffffff'));
});

test('record IDs remain valid without a crypto API', () => {
  withCrypto(undefined, () => assert.match(createId(), VALID_ID));
  withCrypto({}, () => assert.match(createId(), VALID_ID));
  withCrypto({ getRandomValues() { throw new Error('unavailable'); } }, () => assert.match(createId(), VALID_ID));
});

test('the non-security fallback distinguishes repeated calls in one millisecond even when random values repeat', () => {
  const originalNow = Date.now, originalRandom = Math.random;
  Date.now = () => 1791655200000;
  Math.random = () => 0;
  try {
    withCrypto(undefined, () => {
      const ids = Array.from({ length: 1000 }, () => createId());
      assert.equal(new Set(ids).size, ids.length);
      for (const id of ids) assert.match(id, VALID_ID);
    });
  } finally { Date.now = originalNow; Math.random = originalRandom; }
});
