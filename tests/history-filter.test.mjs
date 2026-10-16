import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseMemberId, filterLedgerEntries, selectedLedgerMembers } from '../src/history-filter.mjs';

const circle = { members: [{ id: 'u_me' }, { id: 'u_partner' }] };

test('circle ledger defaults to the signed-in member', () => {
  const entries = [
    { id: 'a', consumer: 'u_me', amountMinor: 100 },
    { id: 'b', consumer: 'u_partner', amountMinor: 200 },
  ];
  assert.deepEqual(filterLedgerEntries(entries, { circle, userId: 'u_me' }).map(e => e.id), ['a']);
  assert.deepEqual([...selectedLedgerMembers({ circle, userId: 'u_me' })], ['u_me']);
});

test('selecting another avatar adds and toggles only that member', () => {
  const entries = [
    { id: 'a', consumer: 'u_me' },
    { id: 'b', consumer: 'u_partner' },
    { id: 'c', consumer: 'u_stranger' },
  ];
  const selected = selectedLedgerMembers({ circle, userId: 'u_me', selected: ['u_partner', 'u_stranger'] });
  assert.deepEqual([...selected], ['u_me', 'u_partner']);
  assert.deepEqual(filterLedgerEntries(entries, { circle, userId: 'u_me', selected }).map(e => e.id), ['a', 'b']);
});

test('personal ledger never includes a second consumer', () => {
  const entries = [{ id: 'a', consumer: 'u_me' }, { id: 'b', consumer: 'u_other' }];
  assert.deepEqual(filterLedgerEntries(entries, { userId: 'u_me' }).map(e => e.id), ['a']);
});

test('legacy records fall back to creator and ledger owner', () => {
  assert.equal(expenseMemberId({ createdBy: 'abc' }), 'u_abc');
  assert.equal(expenseMemberId({ ledgerId: 'u_def' }), 'u_def');
});

test('legacy consumer ids without the ui prefix still match the signed-in member', () => {
  const entries = [{ id: 'old', consumer: 'me' }, { id: 'other', consumer: 'partner' }];
  assert.deepEqual(filterLedgerEntries(entries, { userId: 'u_me' }).map(e => e.id), ['old']);
});
