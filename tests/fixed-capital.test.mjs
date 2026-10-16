import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fixedCapitalMajor,
  fixedCapitalMinor,
  fixedCapitalCycleStart,
  fixedCapitalSummary,
  calculateDailyAllowance,
} from '../public/fixed-capital.mjs';

const config = (patch = {}) => ({
  enabled: true,
  currency: 'JPY',
  incomesTotal: 100,
  expensesTotal: 0,
  savingsTarget: 0,
  payday: 1,
  lastCalculatedAt: null,
  ...patch,
});

test('payday 31 clamps to February 28 and leap-day February 29', () => {
  assert.equal(fixedCapitalCycleStart(new Date('2026-02-28T03:00:00.000Z'), 'Asia/Tokyo', 31), '2026-02-28');
  assert.equal(fixedCapitalCycleStart(new Date('2028-02-29T03:00:00.000Z'), 'Asia/Tokyo', 31), '2028-02-29');
});

test('a month-end payday rolls to the next month without overflowing into a second month', () => {
  assert.equal(fixedCapitalCycleStart(new Date('2026-01-31T03:00:00.000Z'), 'Asia/Tokyo', 31), '2026-01-31');
  const summary = fixedCapitalSummary([], config({ payday: 31 }), {
    timezone: 'Asia/Tokyo',
    now: new Date('2026-01-31T03:00:00.000Z'),
  });
  assert.equal(summary.cycleStart, '2026-01-31');
  assert.equal(summary.cycleEnd, '2026-02-27');
  assert.equal(summary.cycleDays, 28);
});

test('daily allowance uses the actual local cycle length across DST', () => {
  // 13:00 on the spring-forward day in New York. Civil dates must stay
  // stable even though this cycle contains a 23-hour day.
  const now = new Date('2026-03-08T17:00:00.000Z');
  const summary = fixedCapitalSummary([], config({ incomesTotal: 310 }), {
    timezone: 'America/New_York',
    now,
  });
  assert.equal(summary.cycleStart, '2026-03-01');
  assert.equal(summary.cycleEnd, '2026-03-31');
  assert.equal(summary.cycleDays, 31);
  assert.equal(summary.dailyAllowance, 10);
  assert.equal(calculateDailyAllowance(310, 0, 0, 1, now, 'America/New_York'), 10);
});

test('half-hour zones use their local date when the UTC date differs', () => {
  const now = new Date('2026-10-14T14:00:00.000Z'); // 00:30 on Oct 15 in Adelaide
  const summary = fixedCapitalSummary([
    { id: 'adelaide-entry', ledgerId: 'l1', type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: 40,
      occurredAt: '2026-10-14T14:00:00.000Z' },
  ], config({ payday: 15, incomesTotal: 310 }), { timezone: 'Australia/Adelaide', now, ledgerId: 'l1' });
  assert.equal(summary.cycleStart, '2026-10-15');
  assert.equal(summary.todaySpent, 40);
  assert.equal(summary.cycleDays, 31);
});

test('minor and major conversions are strict about currency precision and safe integers', () => {
  assert.equal(fixedCapitalMinor('1,250', 'JPY'), 1250);
  assert.equal(fixedCapitalMinor('12.50', 'USD'), 1250);
  assert.equal(fixedCapitalMajor(1250, 'USD'), 12.5);
  assert.equal(fixedCapitalMinor('10.5', 'JPY'), null);
  assert.equal(fixedCapitalMinor('1.234', 'USD'), null);
  assert.equal(fixedCapitalMinor('-1', 'USD'), null);
  assert.equal(fixedCapitalMinor('1e3', 'USD'), null);
  assert.equal(fixedCapitalMinor(String(Number.MAX_SAFE_INTEGER), 'USD'), null);
  assert.equal(fixedCapitalMinor('10', 'NOPE'), null);
});

test('summary counts only current ledger, currency, real expenses, valid dates and unique ids', () => {
  const now = new Date('2026-10-15T03:00:00.000Z'); // noon in Tokyo
  const entries = [
    { id: 'valid', ledgerId: 'l1', type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: 60, occurredAt: '2026-10-14T16:00:00.000Z' },
    // Retried payloads with the same id are counted once.
    { id: 'valid', ledgerId: 'l1', type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: 60, occurredAt: '2026-10-14T16:00:00.000Z' },
    { id: 'created-only', ledgerId: 'l1', type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: 10, createdAt: '2026-10-14T17:00:00.000Z' },
    { id: 'other-ledger', ledgerId: 'l2', type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: 1000, occurredAt: '2026-10-14T17:00:00.000Z' },
    { id: 'other-currency', ledgerId: 'l1', type: 'expense', recordKind: 'purchase', currency: 'USD', amountMinor: 1000, occurredAt: '2026-10-14T17:00:00.000Z' },
    { id: 'income', ledgerId: 'l1', type: 'income', recordKind: 'purchase', currency: 'JPY', amountMinor: 1000, occurredAt: '2026-10-14T17:00:00.000Z' },
    { id: 'transfer', ledgerId: 'l1', type: 'expense', recordKind: 'transfer', currency: 'JPY', amountMinor: 1000, occurredAt: '2026-10-14T17:00:00.000Z' },
    { id: 'reimbursement', ledgerId: 'l1', type: 'expense', recordKind: 'reimbursement', currency: 'JPY', amountMinor: 1000, occurredAt: '2026-10-14T17:00:00.000Z' },
    { id: 'deleted', ledgerId: 'l1', type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: 1000, deletedAt: '2026-10-14T17:00:00.000Z', occurredAt: '2026-10-14T17:00:00.000Z' },
    { id: 'future', ledgerId: 'l1', type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: 1000, occurredAt: '2026-10-16T17:00:00.000Z' },
    { id: 'invalid-date', ledgerId: 'l1', type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: 1000, occurredAt: 'not-a-date' },
    { id: 'invalid-amount', ledgerId: 'l1', type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: Number.MAX_SAFE_INTEGER + 1, occurredAt: '2026-10-14T18:00:00.000Z' },
  ];
  const summary = fixedCapitalSummary(entries, config({ incomesTotal: 100 }), {
    timezone: 'Asia/Tokyo', now, ledgerId: 'l1', currency: 'JPY',
  });
  assert.equal(summary.cycleSpent, 70);
  assert.equal(summary.todaySpent, 70);
  assert.equal(summary.todayRemaining, -67);
  assert.equal(summary.cycleRemaining, 30);
});

test('negative balances are surfaced instead of clamped to zero', () => {
  const summary = fixedCapitalSummary([
    { id: 'overspend', ledgerId: 'l1', type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: 250,
      occurredAt: '2026-10-14T16:00:00.000Z' },
  ], config({ incomesTotal: 100 }), { timezone: 'Asia/Tokyo', now: new Date('2026-10-15T03:00:00.000Z'), ledgerId: 'l1' });
  assert.equal(summary.monthlyPool, 100);
  assert.equal(summary.todayRemaining, -247);
  assert.equal(summary.cycleRemaining, -150);
});
