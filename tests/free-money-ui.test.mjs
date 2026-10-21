import test from 'node:test';
import assert from 'node:assert/strict';
import { freeMoneyDraft, freeMoneyPlan, freeMoneyInputMinor, createFreeMoneyRequestGate } from '../src/free-money-plan.mjs';

const draft = (patch = {}) => ({ income: '310000', fixed: '100000', savings: '55000', payday: '1', ...patch });

test('free money can be enabled from exact local arithmetic without analysis or network results', () => {
  const plan = freeMoneyPlan(draft(), 'JPY', { timezone: 'Asia/Tokyo', now: new Date('2026-10-22T03:00:00Z') });
  assert.deepEqual(plan.errors, {});
  assert.equal(plan.capital.enabled, true);
  assert.equal(plan.capital.dailyAllowance, 5000);
  assert.equal(plan.summary.monthlyPool, 155000);
  assert.equal(plan.summary.cycleDays, 31);
  assert.equal(plan.summary.cycleStart, '2026-10-01');
});

test('money fields reject malformed grouping, overprecision and unsafe values but accept localized decimal input', () => {
  for (const value of ['-1', '1e3', '1,2', '1,,200', '12.5', 'Infinity', '100000000000001']) assert.equal(freeMoneyInputMinor(value, 'JPY', 'zh'), null, value);
  assert.equal(freeMoneyInputMinor('１２００', 'JPY', 'zh'), 1200);
  assert.equal(freeMoneyInputMinor('1,250', 'JPY', 'en'), 1250);
  assert.equal(freeMoneyInputMinor('1 250,50', 'USD', 'uk'), 125050);
  assert.equal(freeMoneyInputMinor('12,50', 'USD', 'uk'), 1250);
  assert.equal(freeMoneyInputMinor('12,501', 'USD', 'uk'), null);
  assert.equal(freeMoneyInputMinor('12.50', 'USD', 'en'), 1250);
  assert.equal(freeMoneyInputMinor('12.501', 'USD', 'en'), null);
  assert.equal(freeMoneyInputMinor('12', 'INVALID', 'en'), null);
});

test('income, reserved money and payday have field-specific validation; zero remainder remains valid', () => {
  assert.equal(freeMoneyPlan(draft({ income: '' }), 'JPY').errors.income, 'income');
  assert.equal(freeMoneyPlan(draft({ income: '0' }), 'JPY').errors.income, 'income');
  assert.equal(freeMoneyPlan(draft({ fixed: '310001' }), 'JPY').errors.fixed, 'reserved');
  assert.equal(freeMoneyPlan(draft({ savings: '210001' }), 'JPY').errors.savings, 'reserved');
  for (const payday of ['0', '32', '1.5', '2e1', '']) assert.equal(freeMoneyPlan(draft({ payday }), 'JPY').errors.payday, 'payday');
  assert.equal(freeMoneyPlan(draft({ savings: '210000' }), 'JPY').summary.dailyAllowance, 0);
  assert.equal(freeMoneyPlan(draft({ fixed: '', savings: '' }), 'JPY').capital.expensesTotal, 0);
});

test('preview follows existing payday civil cycles across timezones, DST, short months and leap years', () => {
  const cases = [
    ['Asia/Tokyo', '2026-02-28T03:00:00Z', '31', '2026-02-28', 31],
    ['Asia/Tokyo', '2028-02-29T03:00:00Z', '31', '2028-02-29', 31],
    ['America/New_York', '2026-03-08T17:00:00Z', '1', '2026-03-01', 31],
    ['Australia/Adelaide', '2026-10-14T14:00:00Z', '15', '2026-10-15', 31],
    ['America/Los_Angeles', '2026-10-15T02:00:00Z', '15', '2026-09-15', 30],
  ];
  for (const [timezone, now, payday, start, days] of cases) {
    const plan = freeMoneyPlan(draft({ payday }), 'JPY', { timezone, now: new Date(now) });
    assert.equal(plan.summary.cycleStart, start);
    assert.equal(plan.summary.cycleDays, days);
    assert.equal(plan.capital.dailyAllowance, Math.floor(155000 / days));
  }
});

test('existing capital reopens with preserved values and currency precision', () => {
  assert.deepEqual(freeMoneyDraft({ enabled: false, incomesTotal: 123450, expensesTotal: 20000, savingsTarget: 10000, payday: 25 }, 'USD'),
    { income: '1234.5', fixed: '200', savings: '100', payday: '25' });
  assert.deepEqual(freeMoneyDraft(null, 'JPY'), { income: '', fixed: '', savings: '', payday: '1' });
});

test('request gates reject double taps, allow saving without analysis and discard late requests after scope changes', () => {
  const gate = createFreeMoneyRequestGate('circle-one');
  const analysis = gate.begin('analysis');
  assert.equal(gate.begin('analysis'), null);
  const save = gate.begin('save');
  assert.ok(save);
  assert.equal(gate.begin('save'), null);
  assert.equal(gate.current(save), true);
  gate.reset('circle-two');
  assert.equal(gate.current(analysis), false);
  assert.equal(gate.finish(save), false);
  const nextSave = gate.begin('save');
  assert.equal(gate.finish(nextSave), true);
  assert.equal(gate.finish(nextSave), false);
});
