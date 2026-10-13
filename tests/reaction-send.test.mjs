import test from 'node:test';
import assert from 'node:assert/strict';
import { createReactionSendQueue, isReactionSendRetryable } from '../src/reaction-send.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('reaction sender retries a transient request with the same id and clears it after success', async () => {
  const calls = [], failures = [];
  let attempt = 0;
  const queue = createReactionSendQueue({
    send: async payload => {
      calls.push(payload.id);
      if (++attempt === 1) { const error = new Error('offline'); error.status = 503; throw error; }
      return { ok: true };
    },
    retryDelay: () => 1,
    onFailure: payload => failures.push(payload.id),
  });
  const result = await queue.enqueue({ id: 'reaction-0001', emoji: '❤️' });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['reaction-0001', 'reaction-0001']);
  assert.deepEqual(failures, []);
  assert.equal(queue.size, 0);
  queue.close();
});

test('permanent reaction errors do not create a retry loop', async () => {
  let calls = 0;
  const failed = [];
  const queue = createReactionSendQueue({
    send: async () => { calls += 1; const error = new Error('membership'); error.status = 403; throw error; },
    retryDelay: () => 1,
    onFailure: payload => failed.push(payload.id),
  });
  const result = await queue.enqueue({ id: 'reaction-0002', emoji: '😀' });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.deepEqual(failed, ['reaction-0002']);
  assert.deepEqual(queue.failed.map(payload => payload.id), ['reaction-0002']);
  assert.equal(queue.retry('reaction-0002'), true);
  queue.close();
});

test('duplicate taps with the same id are coalesced and status codes are classified', async () => {
  let calls = 0;
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const queue = createReactionSendQueue({ send: async () => { calls += 1; await hold; } });
  const first = queue.enqueue({ id: 'reaction-0003', emoji: '🥰' });
  const second = queue.enqueue({ id: 'reaction-0003', emoji: '🥰' });
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(isReactionSendRetryable(new Error('network')), true);
  assert.equal(isReactionSendRetryable(Object.assign(new Error('rate'), { status: 429 })), true);
  assert.equal(isReactionSendRetryable(Object.assign(new Error('bad'), { status: 409 })), false);
  queue.close();
});

test('close settles queued work without producing a retry badge', async () => {
  const failures = [];
  const queue = createReactionSendQueue({ send: async () => { await wait(10); }, onFailure: payload => failures.push(payload.id) });
  const pending = queue.enqueue({ id: 'reaction-0004', emoji: '💕' });
  queue.close();
  const result = await pending;
  assert.equal(result.closed, true);
  assert.deepEqual(failures, []);
});
