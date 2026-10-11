// Shared by the browser, bot, parser and expense validator. Location is an
// optional enhancement: malformed metadata must never block normal recording.
function locationText(value, limit) {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? Array.from(text).slice(0, limit).join('') : undefined;
}

export function normalizeLocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  if (typeof value.lat === 'number' && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
    && typeof value.lng === 'number' && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180) {
    result.lat = Number(value.lat.toFixed(6));
    result.lng = Number(value.lng.toFixed(6));
  }
  for (const [field, limit] of [['name', 120], ['address', 240], ['area', 80]]) {
    const text = locationText(value[field], limit);
    if (text) result[field] = text;
  }
  if (typeof value.countryCode === 'string' && /^[A-Za-z]{2}$/.test(value.countryCode.trim())) result.countryCode = value.countryCode.trim().toUpperCase();
  return Object.keys(result).length ? result : undefined;
}

const COUNTRY_CURRENCIES = Object.freeze({
  JP: 'JPY', CN: 'CNY', US: 'USD', UA: 'UAH', KR: 'KRW', TW: 'TWD', HK: 'HKD', SG: 'SGD',
  AU: 'AUD', CA: 'CAD', GB: 'GBP', CH: 'CHF', LI: 'CHF',
  AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR', FI: 'EUR', FR: 'EUR',
  GR: 'EUR', HR: 'EUR', IE: 'EUR', IT: 'EUR', LT: 'EUR', LU: 'EUR', LV: 'EUR', MT: 'EUR',
  NL: 'EUR', PT: 'EUR', SI: 'EUR', SK: 'EUR', AD: 'EUR', MC: 'EUR', SM: 'EUR', VA: 'EUR',
});

export function currencyForCountry(code) {
  const country = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return Object.hasOwn(COUNTRY_CURRENCIES, country) ? COUNTRY_CURRENCIES[country] : undefined;
}

export function locationLabel(value) {
  const location = normalizeLocation(value);
  if (!location) return '';
  if (location.area && location.name && location.area !== location.name && !location.name.includes(location.area)) return `${location.area} · ${location.name}`;
  return location.name || location.area || location.address || '';
}

export function locationArea(value) {
  const location = normalizeLocation(value);
  return location?.area || location?.address || location?.name || '';
}

// Callers supply the period/ledger they are displaying. Repayments, transfers,
// income and deleted entries do not count as a second visit for a purchase.
export function summarizeFootprints(entries) {
  const counts = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.deletedAt || entry.type === 'income' || ['transfer', 'reimbursement'].includes(entry.recordKind)) continue;
    const name = locationArea(entry.location);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
