import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncAllLedgerGroups, syncLedgerGroup } from '../ledger-sync.mjs';

function database() {
  return {
    users: { a: {}, b: {}, unrelated: {} },
    circles: { home: { ledgerId: 'home_ledger', members: ['a', 'b'] } },
    ledgers: {
      a: { expenses: [{ id: 'personal-a', amountMinor: 100 }] },
      b: { expenses: [] },
      home_ledger: { expenses: [{ id: 'circle-entry', amountMinor: 200 }] },
      unrelated: { expenses: [{ id: 'private', amountMinor: 900 }] },
    },
  };
}

test('connected personal and circle ledgers receive the same historical union', () => {
  const db = database();
  assert.equal(syncAllLedgerGroups(db), true);
  for (const id of ['a', 'b', 'home_ledger']) assert.deepEqual(db.ledgers[id].expenses.map(entry => entry.id).sort(), ['circle-entry', 'personal-a']);
  assert.deepEqual(db.ledgers.unrelated.expenses.map(entry => entry.id), ['private']);
});

test('a newer deletion and split participants survive mirroring', () => {
  const db = database();
  db.ledgers.a.expenses = [{ id: 'same', amountMinor: 100, splitParticipants: ['u_a'], createdAt: '2026-01-01', updatedAt: '2026-01-02' }];
  db.ledgers.home_ledger.expenses = [{ id: 'same', amountMinor: 100, splitParticipants: ['u_b'], createdAt: '2026-01-01', updatedAt:'2026-01-01', deletedAt: '2026-01-03' }];
  syncLedgerGroup(db, 'a');
  for (const id of ['a', 'b', 'home_ledger']) {
    assert.equal(db.ledgers[id].expenses[0].deletedAt, '2026-01-03');
    assert.deepEqual(db.ledgers[id].expenses[0].splitParticipants.sort(), ['u_a', 'u_b']);
  }
});

test('instant undo and split edits replace all mirrors even in the same millisecond', () => {
  const db = database(), timestamp = '2026-10-13T03:00:00.000Z';
  const deleted = { id:'instant-undo', amountMinor:500, createdAt:timestamp, deletedAt:timestamp, splitParticipants:['u_a','u_b'] };
  syncLedgerGroup(db,'a',deleted);
  const restored = { ...deleted, updatedAt:timestamp, splitParticipants:['u_a'] };
  delete restored.deletedAt;
  syncLedgerGroup(db,'a',restored);
  for (const id of ['a','b','home_ledger']) {
    const actual = db.ledgers[id].expenses.find(entry => entry.id === restored.id);
    assert.equal(actual.deletedAt, undefined);
    assert.deepEqual(actual.splitParticipants,['u_a']);
  }
  syncAllLedgerGroups(db);
  assert.equal(db.ledgers.a.expenses.find(entry => entry.id === restored.id).deletedAt, undefined);
});

