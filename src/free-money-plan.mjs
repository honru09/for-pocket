import { CURRENCIES, validateFixedCapital } from '../public/shared.mjs';
import { fixedCapitalMajor, fixedCapitalMinor, fixedCapitalSummary } from '../public/fixed-capital.mjs';
import { validTimezone } from '../public/timezone.mjs';

export function freeMoneyInputMinor(value, currency, language = 'zh') {
  const digits = CURRENCIES[currency]?.digits;
  if (!Number.isInteger(digits)) return null;
  let raw = String(value ?? '').normalize('NFKC').trim().replace(/[\u00a0\u202f]/g, ' ');
  if (language === 'uk' && digits > 0 && raw.includes(',')) {
    if (!/^\d[\d ]*,\d{1,2}$/.test(raw)) return null;
    raw = raw.replace(',', '.');
  }
  if (!/^(?:\d+|\d{1,3}(?:[ ,]\d{3})+)(?:\.\d+)?$/.test(raw)) return null;
  return fixedCapitalMinor(raw.replace(/[ ,]/g, ''), currency);
}

export function freeMoneyDraft(capital, currency = 'JPY') {
  const amount = key => capital?.incomesTotal > 0 ? String(fixedCapitalMajor(capital[key] || 0, currency)) : '';
  return { income: amount('incomesTotal'), fixed: amount('expensesTotal'), savings: amount('savingsTarget'), payday: String(capital?.payday || 1) };
}

export function freeMoneyPlan(draft, currency = 'JPY', { language = 'zh', timezone = 'Asia/Tokyo', now = new Date() } = {}) {
  const amount = key => key !== 'income' && !String(draft?.[key] ?? '').trim() ? 0 : freeMoneyInputMinor(draft?.[key], currency, language);
  const income = amount('income'), fixed = amount('fixed'), savings = amount('savings');
  const paydayText = String(draft?.payday ?? '').normalize('NFKC').trim();
  const payday = /^\d{1,2}$/.test(paydayText) ? Number(paydayText) : 0;
  const errors = {};
  if (income === null || income < 1) errors.income = 'income';
  if (fixed === null) errors.fixed = 'money';
  if (savings === null) errors.savings = 'money';
  if (payday < 1 || payday > 31) errors.payday = 'payday';
  if (income !== null && fixed !== null && fixed > income) errors.fixed = 'reserved';
  else if (income !== null && fixed !== null && savings !== null && fixed + savings > income) errors.savings = 'reserved';
  if (Object.keys(errors).length) return { errors, capital: null, summary: null };
  const capital = validateFixedCapital({ enabled: true, currency, incomesTotal: income, expensesTotal: fixed, savingsTarget: savings,
    payday, dailyAllowance: 0, lastCalculatedAt: null }, currency);
  const summary = fixedCapitalSummary([], capital, { currency, timezone: validTimezone(timezone) || 'Asia/Tokyo', now });
  return { errors, capital: { ...capital, dailyAllowance: summary.dailyAllowance }, summary };
}

// Tokens are invalidated on close, edits and scope changes. A late response can
// finish its original request, but cannot close or overwrite a different sheet.
export function createFreeMoneyRequestGate(initialScope = '') {
  let scope = initialScope, revision = 0;
  const pending = new Map();
  const current = token => Boolean(token && token.scope === scope && token.revision === revision && pending.get(token.kind) === token);
  return {
    reset(nextScope = scope) { scope = nextScope; revision++; pending.clear(); },
    cancel(kind) { pending.delete(kind); },
    begin(kind) {
      if (pending.has(kind)) return null;
      const token = { kind, scope, revision }; pending.set(kind, token); return token;
    },
    current,
    finish(token) { if (!current(token)) return false; pending.delete(token.kind); return true; },
  };
}
