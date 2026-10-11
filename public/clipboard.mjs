import { CURRENCIES } from './shared.mjs';

const CURRENCY_MARKERS = [
  ['JPY', /(?:JPY|JP¥|¥|円)/i], ['CNY', /(?:CNY|RMB|元|人民币)/i], ['USD', /(?:USD|US\$|\$)/i],
  ['EUR', /(?:EUR|€)/i], ['GBP', /(?:GBP|£)/i], ['KRW', /(?:KRW|₩|韩元)/i], ['UAH', /(?:UAH|₴)/i],
];
const AMOUNT = /(?:[0-9]{1,3}(?:[ ,.'’][0-9]{3})+|[0-9]+)(?:[.,][0-9]{1,2})?/g;

function toNumber(value) {
  const raw = String(value).replace(/[\s'’]/g, '');
  // When both separators occur, the last one is the decimal separator.
  const normalized = raw.includes(',') && raw.includes('.')
    ? (raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''))
    : raw.replace(/,/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function currencyForText(text, fallback = 'JPY') {
  return CURRENCY_MARKERS.find(([, pattern]) => pattern.test(text))?.[0] || fallback;
}

function pickAmount(text, currency) {
  const candidates = [...String(text).matchAll(AMOUNT)].map(match => ({ raw: match[0], index: match.index ?? 0, value: toNumber(match[0]) }))
    .filter(item => item.value > 0);
  if (!candidates.length) return null;
  const total = /(?:total|合計|总计|总額|всього|итого|amount due|paid|支付|扣款|支払)/i;
  const marked = candidates.find(item => total.test(text.slice(Math.max(0, item.index - 28), item.index + item.raw.length + 28)));
  const chosen = marked || candidates.at(-1);
  const digits = CURRENCIES[currency]?.digits ?? 0;
  const minor = Math.round(chosen.value * 10 ** digits);
  return Number.isSafeInteger(minor) && minor > 0 ? { minor, raw: digits ? String(chosen.value).replace(',', '.') : String(Math.round(chosen.value)) } : null;
}

function pickNote(text, amountRaw) {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const useful = lines.find(line => line.length > 1 && line.length < 80 && !new RegExp(`^[^\\d]*${amountRaw.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}`).test(line));
  return useful || lines[0]?.slice(0, 160) || '';
}

/** Parse common copied payment/bank text without making a network request. */
export function parseClipboardExpense(text, fallbackCurrency = 'JPY') {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) return null;
  const currency = currencyForText(text, fallbackCurrency);
  const amount = pickAmount(text, currency);
  if (!amount) return null;
  return { currency, amountMinor: amount.minor, raw: amount.raw, note: pickNote(text, amount.raw), sourceText: text.slice(0, 4000) };
}

