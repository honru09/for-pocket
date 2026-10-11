import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSettings, parseAmountExpression, validateSettings } from '../public/shared.mjs';
import { parseClipboardExpense } from '../public/clipboard.mjs';

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
