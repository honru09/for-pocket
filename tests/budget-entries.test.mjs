import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBudgetEntry, initialSettings, validateExpense } from '../public/shared.mjs';
import { expenseStats } from '../ai-summary.mjs';

test('transfers and repayments stay stored but do not inflate spending, income or payer totals', () => {
  const settings = { ...initialSettings(), consumers: [{ id: 'u_one', name: 'One', avatar: 'cloud', color: 'blue' }] };
  const expense = (id, recordKind, type, amountMinor) => ({ id, recordKind, type, amountMinor, currency: 'JPY', categoryId: type === 'income' ? 'wage' : 'stomach',
    consumer: 'u_one', note: '', timezone: 'Asia/Tokyo', occurredAt: '2026-10-10T03:00:00.000Z' });
  const entries = [expense('budget-purchase', 'purchase', 'expense', 1200), expense('budget-transfer', 'transfer', 'expense', 3000),
    expense('budget-repayment', 'reimbursement', 'income', 3000), expense('budget-refund', 'refund', 'income', 200), expense('budget-gift', 'gift', 'income', 400)];
  const validated = entries.map(entry => validateExpense(entry, settings));
  assert.equal(validated.length, 5);
  assert.deepEqual(validated.map(entry => entry.recordKind), entries.map(entry => entry.recordKind));
  assert.deepEqual(validated.filter(isBudgetEntry).map(entry => entry.id), ['budget-purchase', 'budget-refund', 'budget-gift']);
  assert.equal(isBudgetEntry({}), true, 'legacy entries without a record kind still count');
  const stats = expenseStats({ period: 'month', timezone: 'Asia/Tokyo' }, { settings, expenses: validated }, Date.parse('2026-10-11T00:00:00Z'));
  assert.deepEqual([stats.count, stats.expenseMinor, stats.incomeMinor], [3, 1200, 600]);
  assert.equal(stats.byConsumer[0].amountMinor, 1200);
  assert.equal(stats.byCategory[0].amountMinor, 1200);
});
