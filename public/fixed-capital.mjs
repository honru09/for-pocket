import { CURRENCIES, dateKey, isBudgetEntry, validateFixedCapital } from './shared.mjs';

const DAY_MS = 86_400_000;

export function fixedCapitalMajor(minor = 0, currency = 'JPY') {
  const digits = CURRENCIES[currency]?.digits ?? 0;
  return Number(minor || 0) / 10 ** digits;
}

export function fixedCapitalMinor(value, currency = 'JPY') {
  const digits = CURRENCIES[currency]?.digits;
  if (!Number.isInteger(digits)) return null;
  const raw = String(value ?? '').replace(/,/g, '').trim();
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || 0);
  return Number.isSafeInteger(minor) && minor >= 0 && minor <= 10 ** 14 ? minor : null;
}

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error('自由金日期格式有误。');
  return date;
}

function localParts(value, timezone) {
  const date = asDate(value);
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function addMonth(year, month, offset) {
  const value = year * 12 + month - 1 + offset;
  return { year: Math.floor(value / 12), month: value % 12 + 1 };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoCivil(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseCivil(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('自由金日期格式有误。');
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function civilOrdinal({ year, month, day }) {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function addCivilDays(value, offset) {
  const date = parseCivil(value);
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + offset));
  return isoCivil(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function cycleInfo(now, timezone = 'Asia/Tokyo', payday = 1) {
  const target = Math.min(Math.max(Number(payday) || 1, 1), 31);
  const current = localParts(now, timezone);
  // A 31st payday is the last civil day of shorter months. Compare with the
  // effective day in the current month before deciding whether the current
  // cycle has started; otherwise Feb 28 would incorrectly belong to Jan 31.
  const effectiveCurrentDay = Math.min(target, daysInMonth(current.year, current.month));
  const base = addMonth(current.year, current.month, current.day >= effectiveCurrentDay ? 0 : -1);
  const startDay = Math.min(target, daysInMonth(base.year, base.month));
  const start = isoCivil(base.year, base.month, startDay);
  const nextMonth = addMonth(base.year, base.month, 1);
  const next = isoCivil(nextMonth.year, nextMonth.month, Math.min(target, daysInMonth(nextMonth.year, nextMonth.month)));
  return { start, next, end: addCivilDays(next, -1), days: civilOrdinal(parseCivil(next)) - civilOrdinal(parseCivil(start)) };
}

export function fixedCapitalCycleStart(now = new Date(), timezone = 'Asia/Tokyo', payday = 1) {
  return cycleInfo(now, timezone, payday).start;
}

function moneyPool(config) {
  return Math.max(0, config.incomesTotal - config.expensesTotal - config.savingsTarget);
}

function entriesForBudget(expenses, config, { currency, timezone, now, ledgerId } = {}) {
  const selectedCurrency = config.currency || currency || 'JPY';
  const zone = timezone || 'Asia/Tokyo';
  const end = asDate(now).getTime();
  const seen = new Set();
  const result = [];
  for (const entry of Array.isArray(expenses) ? expenses : []) {
    if (!entry || entry.deletedAt || (entry.type || 'expense') !== 'expense' || !isBudgetEntry(entry)) continue;
    if (entry.currency !== selectedCurrency) continue;
    if (ledgerId !== undefined && ledgerId !== null && entry.ledgerId !== ledgerId) continue;
    if (typeof entry.id === 'string' && entry.id && seen.has(entry.id)) continue;
    const value = entry.occurredAt || entry.createdAt;
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime()) || date.getTime() > end) continue;
    if (typeof entry.id === 'string' && entry.id) seen.add(entry.id);
    let day;
    try { day = dateKey(date, zone); } catch { continue; }
    if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor < 1) continue;
    result.push({ entry, date, day });
  }
  return result;
}

export function fixedCapitalSummary(expenses = [], fixedCapital, {
  currency,
  timezone = 'Asia/Tokyo',
  now = new Date(),
  ledgerId,
} = {}) {
  const config = validateFixedCapital(fixedCapital, currency || 'JPY');
  const selectedCurrency = config.currency || currency || 'JPY';
  const at = asDate(now);
  const cycle = cycleInfo(at, timezone, config.payday);
  const today = dateKey(at, timezone);
  const entries = entriesForBudget(expenses, config, { currency: selectedCurrency, timezone, now: at, ledgerId });
  const cycleEntries = entries.filter(item => item.day >= cycle.start && item.day <= today);
  const todayEntries = entries.filter(item => item.day === today);
  const cycleSpent = cycleEntries.reduce((sum, item) => sum + item.entry.amountMinor, 0);
  const todaySpent = todayEntries.reduce((sum, item) => sum + item.entry.amountMinor, 0);
  const monthlyPool = config.enabled ? moneyPool(config) : 0;
  const dailyAllowance = config.enabled ? Math.floor(monthlyPool / Math.max(1, cycle.days)) : 0;
  return {
    enabled: config.enabled,
    currency: selectedCurrency,
    monthlyPool,
    dailyAllowance,
    todaySpent: config.enabled ? todaySpent : 0,
    todayRemaining: config.enabled ? dailyAllowance - todaySpent : 0,
    cycleSpent: config.enabled ? cycleSpent : 0,
    cycleRemaining: config.enabled ? monthlyPool - cycleSpent : 0,
    cycleDays: cycle.days,
    cycleStart: cycle.start,
    cycleEnd: cycle.end,
  };
}

export function calculateDailyAllowance(incomesTotal, expensesTotal, savingsTarget, payday, now = new Date(), timezone = 'Asia/Tokyo') {
  const cycle = cycleInfo(now, timezone, payday);
  const pool = Math.max(0, Number(incomesTotal || 0) - Number(expensesTotal || 0) - Number(savingsTarget || 0));
  return Math.floor(pool / Math.max(1, cycle.days));
}

export function fixedCapitalSpent(expenses = [], fixedCapital, options = {}) {
  return fixedCapitalSummary(expenses, fixedCapital, options).cycleSpent;
}

export function fixedCapitalAvailable(expenses = [], fixedCapital, options = {}) {
  const summary = fixedCapitalSummary(expenses, fixedCapital, options);
  return summary.enabled ? summary.cycleRemaining : null;
}
