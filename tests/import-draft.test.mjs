import test from 'node:test';
import assert from 'node:assert/strict';
import { importDraftScope, readImportDraft, writeImportDraft, clearImportDraft, settleImportDraft, subscribeImportDraft } from '../src/import-draft.mjs';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values };
};
const scope = importDraftScope({ user: { id: 'u_alice' }, ledgerId: 'circle-one' });
const row = (id = 'entry-a') => ({ id, amount: '850', currency: 'JPY', type: 'expense', occurredAt: '2026-10-22T12:00', timezone: 'Asia/Tokyo',
  categoryId: 'stomach', consumer: 'u_alice', merchant: 'Ramen', note: 'With a friend', splitMode: 'equal', splitParticipants: ['u_alice', 'u_bob'],
  recordKind: 'purchase', needsReview: true, reviewReason: 'Check split', confidence: .8, rawText: 'ramen 850', sourceName: 'receipt.png' });
const draft = () => ({ text: 'Lunch 850', items: [row()], warnings: [{ name: 'another.pdf', code: 'errorTooLarge' }], fileNames: ['receipt.png'] });

test('import drafts survive reopening with stable IDs and edited values, without persisting file bytes', () => {
  const store = storage();
  writeImportDraft(scope, { ...draft(), files: [{ name: 'receipt.png', data: 'PRIVATE-IMAGE', blob: 'PRIVATE-BLOB' }] }, store);
  const restored = readImportDraft(scope, [], store);
  assert.deepEqual(restored, draft());
  assert.doesNotMatch([...store.values.values()].join(''), /PRIVATE-IMAGE|PRIVATE-BLOB/);
  restored.items[0].amount = '900';
  writeImportDraft(scope, restored, store);
  assert.equal(readImportDraft(scope, [], store).items[0].id, 'entry-a');
  assert.equal(readImportDraft(scope, [], store).items[0].amount, '900');
});

test('import drafts are isolated by both real user and ledger, including separator characters', () => {
  const store = storage();
  const anotherUser = importDraftScope({ user: { id: 'u_bob' }, ledgerId: 'circle-one' });
  const anotherLedger = importDraftScope({ user: { id: 'u_alice' }, ledgerId: 'private' });
  writeImportDraft(scope, draft(), store);
  assert.equal(readImportDraft(anotherUser, [], store), null);
  assert.equal(readImportDraft(anotherLedger, [], store), null);
  assert.notEqual(importDraftScope({ user: { id: 'a:b' }, ledgerId: 'c' }), importDraftScope({ user: { id: 'a' }, ledgerId: 'b:c' }));
  assert.equal(importDraftScope({ user: {}, ledgerId: 'private' }), null);
  writeImportDraft(null, draft(), store);
  assert.equal(readImportDraft(null, [], store), null);
});

test('reopening reconciles server records and never offers already imported IDs again', () => {
  const store = storage();
  writeImportDraft(scope, { ...draft(), items: [row('entry-a'), row('entry-b')] }, store);
  assert.deepEqual(readImportDraft(scope, [{ id: 'entry-a' }], store).items.map(item => item.id), ['entry-b']);
  assert.equal(readImportDraft(scope, [{ id: 'entry-b', deletedAt: '2026-10-22' }], store), null);
  assert.equal(store.values.size, 0);
});

test('late save completion clears only acknowledged rows and preserves a newer draft', () => {
  const store = storage();
  const submitted = { ...draft(), items: [row('entry-a'), row('entry-b')] };
  writeImportDraft(scope, submitted, store);
  settleImportDraft(scope, submitted, ['entry-a'], store);
  assert.deepEqual(readImportDraft(scope, [], store).items.map(item => item.id), ['entry-b']);
  settleImportDraft(scope, submitted, ['entry-b'], store);
  assert.equal(readImportDraft(scope, [], store), null);
  writeImportDraft(scope, { ...draft(), text: 'Dinner 1200', items: [row('new-entry')] }, store);
  settleImportDraft(scope, submitted, ['entry-a', 'entry-b'], store);
  assert.equal(readImportDraft(scope, [], store).text, 'Dinner 1200');
  assert.equal(readImportDraft(scope, [], store).items[0].id, 'new-entry');
});

test('save completion after leaving the page informs a remounted form and clear affects only its scope', () => {
  const store = storage(), events = [];
  const other = importDraftScope({ user: { id: 'u_bob' }, ledgerId: 'circle-one' });
  writeImportDraft(scope, draft(), store); writeImportDraft(other, draft(), store);
  const unsubscribe = subscribeImportDraft(scope, () => events.push(readImportDraft(scope, [], store)));
  settleImportDraft(scope, draft(), ['entry-a'], store);
  assert.deepEqual(events, [null]);
  writeImportDraft(scope, draft(), store); clearImportDraft(scope, store);
  assert.deepEqual(events, [null, null]);
  assert.ok(readImportDraft(other, [], store));
  unsubscribe();
});

test('a draft stays available across days in the same browser session', () => {
  const store = storage();
  writeImportDraft(scope, draft(), store);
  const key = [...store.values.keys()][0], previousDay = JSON.parse(store.getItem(key));
  previousDay.updatedAt = Date.now() - 2 * 24 * 60 * 60 * 1000;
  store.setItem(key, JSON.stringify(previousDay));
  assert.equal(readImportDraft(scope, [], store).items[0].id, 'entry-a');
});

test('corrupt, oversized or blocked session storage never breaks the import screen', () => {
  const store = storage();
  writeImportDraft(scope, draft(), store);
  const key = [...store.values.keys()][0];
  store.setItem(key, '{bad json');
  assert.equal(readImportDraft(scope, [], store), null);
  writeImportDraft(scope, { ...draft(), text: 'a'.repeat(15000), items: Array.from({length: 60}, (_, i) => row(`entry-${i}`)) }, store);
  const bounded = readImportDraft(scope, [], store);
  assert.equal(bounded.text.length, 12000);
  assert.equal(bounded.items.length, 50);
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  assert.equal(readImportDraft(scope, [], blocked), null);
  assert.doesNotThrow(() => writeImportDraft(scope, draft(), blocked));
  assert.doesNotThrow(() => clearImportDraft(scope, blocked));
});
