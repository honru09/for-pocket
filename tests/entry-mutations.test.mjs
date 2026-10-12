import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntryMutations } from '../src/entry-mutations.mjs';
const turn = () => new Promise(resolve => setImmediate(resolve));
const entry = { id: 'expense-1', amountMinor: 850 };
test('undo restores immediately while a slow delete is still in flight; requests remain ordered', async () => {
  let release, visible = entry;
  const calls = [], errors = [];
  const queue = createEntryMutations({ publish: (_, value) => { visible = value; }, failed: (_, error) => errors.push(error) });
  const deletion = queue.enqueue({ key:'ledger:expense-1', optimistic:null, fallback:entry, request:async () => { calls.push('delete'); await new Promise(resolve => { release = resolve; }); return { ...entry, deletedAt:'now' }; } });
  await turn(); assert.equal(visible, null);
  const restore = queue.enqueue({ key:'ledger:expense-1', optimistic:entry, fallback:null, request:async () => { calls.push('restore'); return entry; } });
  assert.equal(visible, entry); assert.deepEqual(calls, ['delete']);
  release(); await Promise.all([deletion, restore]);
  assert.deepEqual(calls, ['delete','restore']); assert.equal(visible, entry); assert.equal(queue.pending.size, 0); assert.deepEqual(errors, []);
});
test('failed restore rolls back to confirmed deletion, without reverting a later action', async () => {
  let visible = entry;
  const errors = [], queue = createEntryMutations({ publish: (_, value) => { visible = value; }, failed: (_, error) => errors.push(error.message) });
  await queue.enqueue({ key:'a', optimistic:null, fallback:entry, request:async () => ({ ...entry, deletedAt:'now' }) });
  await queue.enqueue({ key:'a', optimistic:entry, fallback:null, request:async () => { throw Error('offline'); } });
  assert.equal(visible, null); assert.deepEqual(errors, ['offline']);
  let release;
  const first = queue.enqueue({ key:'b', optimistic:null, fallback:entry, request:async () => { await new Promise(resolve => { release=resolve; }); throw Error('timeout'); } });
  await turn();
  const last = queue.enqueue({ key:'b', optimistic:entry, fallback:null, request:async () => entry });
  release(); await Promise.all([first,last]); assert.equal(visible, entry); assert.deepEqual(errors, ['offline']);
});
