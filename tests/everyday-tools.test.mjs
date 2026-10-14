import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSettings, parseAmountExpression, validateSettings } from '../public/shared.mjs';
import { parseClipboardExpense } from '../public/clipboard.mjs';
import { calculateDailyAllowance, fixedCapitalAvailable, fixedCapitalCycleStart, fixedCapitalMinor } from '../src/fixed-capital.mjs';

test('amount expressions add whole and fractional terms without evaluating arbitrary input', () => {
  assert.deepEqual(parseAmountExpression('350+480', 'JPY'), {
    valid: true, minor: 830, expression: '350+480', terms: ['350', '480'],
  });
  assert.equal(parseAmountExpression('12.50+7.25', 'USD').minor, 1975);
  assert.equal(parseAmountExpression('12*50', 'USD').valid, false);
  assert.equal(parseAmountExpression('10.999', 'USD').valid, false);
  assert.equal(parseAmountExpression('10.5', 'JPY').valid, false);
});

test('clipboard payment text keeps the total and a useful merchant note', () => {
  const parsed = parseClipboardExpense('罗森 新宿店\n合計 ¥830\nカード決済');
  assert.equal(parsed.currency, 'JPY');
  assert.equal(parsed.amountMinor, 830);
  assert.match(parsed.note, /罗森/);
  assert.equal(parseClipboardExpense('这是一段没有金额的文字'), null);
});

test('recurring settings validate bounded dates, currencies and members', () => {
  const base = initialSettings();
  const settings = validateSettings({
    ...base,
    consumers: [{ id: 'me', name: 'Me', color: 'blue', avatar: 'cloud' }],
    recurringExpenses: [{ id: 'rent_2026', day: 25, amountMinor: 85000, currency: 'JPY', categoryId: 'rent', consumer: 'me', note: '房租' }],
  });
  assert.deepEqual(settings.recurringExpenses[0], {
    id: 'rent_2026', day: 25, amountMinor: 85000, currency: 'JPY', categoryId: 'rent', consumer: 'me', note: '房租',
  });
  assert.throws(() => validateSettings({ ...base, consumers: [{ id: 'me', name: 'Me', color: 'blue', avatar: 'cloud' }], recurringExpenses: [{ day: 32, amountMinor: 1, currency: 'JPY', categoryId: 'rent', consumer: 'me' }] }), /日期/);
});

test('free money keeps payday cycles local and subtracts only current-cycle spending', () => {
  const config = { enabled: true, incomesTotal: 300000, expensesTotal: 50000, savingsTarget: 30000, dailyAllowance: 0, payday: 25, lastCalculatedAt: new Date().toISOString() };
  const now = new Date('2026-10-24T12:00:00.000Z');
  assert.equal(fixedCapitalCycleStart(now, 'Asia/Tokyo', 25), '2026-09-25');
  assert.equal(fixedCapitalCycleStart(new Date('2026-10-25T00:00:00.000Z'), 'Asia/Tokyo', 25), '2026-10-25');
  const expenses = [
    { type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: 12000, occurredAt: '2026-10-01T03:00:00.000Z' },
    { type: 'expense', recordKind: 'transfer', currency: 'JPY', amountMinor: 90000, occurredAt: '2026-10-02T03:00:00.000Z' },
    { type: 'expense', recordKind: 'purchase', currency: 'JPY', amountMinor: 8000, occurredAt: '2026-09-20T03:00:00.000Z' },
  ];
  assert.equal(fixedCapitalAvailable(expenses, config, { currency: 'JPY', timezone: 'Asia/Tokyo', now }), 208000);
  assert.equal(calculateDailyAllowance(300000, 50000, 30000, 25, now, 'Asia/Tokyo') > 0, true);
  assert.equal(fixedCapitalMinor('1,250', 'JPY'), 1250);
});
