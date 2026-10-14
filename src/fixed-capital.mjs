import { CURRENCIES, dateKey, isBudgetEntry, validateFixedCapital } from '../public/shared.mjs';

export function fixedCapitalMajor(minor = 0, currency = 'JPY') {
  const digits = CURRENCIES[currency]?.digits ?? 0;
  return Number(minor || 0) / 10 ** digits;
}

export function fixedCapitalMinor(value, currency = 'JPY') {
  const digits = CURRENCIES[currency]?.digits ?? 0;
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const minor = Math.round(parsed * 10 ** digits);
  return Number.isSafeInteger(minor) ? minor : null;
}

function addMonth(year, month, offset) {
  const value = year * 12 + month - 1 + offset;
  return { year: Math.floor(value / 12), month: value % 12 + 1 };
}

function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

export function fixedCapitalCycleStart(now = new Date(), timezone = 'Asia/Tokyo', payday = 1) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: timezone, year:'numeric', month:'numeric', day:'numeric' }).formatToParts(now).map(part => [part.type, part.value]));
  const day = Number(parts.day), year = Number(parts.year), month = Number(parts.month), target = Math.min(Number(payday) || 1, 31);
  const offset = day >= target ? 0 : -1, base = addMonth(year, month, offset);
  const cycleDay = Math.min(target, daysInMonth(base.year, base.month));
  return `${base.year}-${String(base.month).padStart(2, '0')}-${String(cycleDay).padStart(2, '0')}`;
}

export function fixedCapitalSpent(expenses = [], fixedCapital, { currency = 'JPY', timezone = 'Asia/Tokyo', now = new Date() } = {}) {
  const config = validateFixedCapital(fixedCapital);
  if (!config.enabled) return 0;
  const start = fixedCapitalCycleStart(now, timezone, config.payday);
  const end = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return expenses.filter(entry => entry?.type !== 'income' && isBudgetEntry(entry) && entry.currency === currency && entry.occurredAt)
    .filter(entry => dateKey(new Date(entry.occurredAt), timezone) >= start && new Date(entry.occurredAt).getTime() <= end)
    .reduce((sum, entry) => sum + (Number.isSafeInteger(entry.amountMinor) ? entry.amountMinor : 0), 0);
}

export function fixedCapitalAvailable(expenses, fixedCapital, options) {
  const config = validateFixedCapital(fixedCapital);
  if (!config.enabled) return null;
  const spent = fixedCapitalSpent(expenses, config, options);
  return Math.max(0, config.incomesTotal - config.expensesTotal - config.savingsTarget - spent);
}

export function calculateDailyAllowance(incomesTotal, expensesTotal, savingsTarget, payday, now = new Date(), timezone = 'Asia/Tokyo') {
  const start = fixedCapitalCycleStart(now, timezone, payday);
  const startDate = new Date(`${start}T00:00:00Z`);
  const next = new Date(startDate);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const days = Math.max(1, Math.round((next - startDate) / 86400000));
  return Math.max(0, Math.floor((incomesTotal - expensesTotal - savingsTarget) / days));
}
