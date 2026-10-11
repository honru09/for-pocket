export function validTimezone(value, intl = globalThis.Intl) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) return null;
  try { return intl.DateTimeFormat('en', { timeZone:value }).resolvedOptions().timeZone || value; } catch { return null; }
}

// Device IANA zones handle travel and daylight saving without guessing from a
// UTC offset. Countries spanning multiple zones deliberately have no fallback.
export function deviceTimezone({ intl = globalThis.Intl, countryCode, fallback = 'Asia/Tokyo' } = {}) {
  try {
    const zone = validTimezone(intl.DateTimeFormat().resolvedOptions().timeZone, intl);
    if (zone) return zone;
  } catch {}
  const countries = { JP:'Asia/Tokyo', CN:'Asia/Shanghai', SG:'Asia/Singapore', KR:'Asia/Seoul', GB:'Europe/London', FR:'Europe/Paris', DE:'Europe/Berlin' };
  return countries[countryCode] || validTimezone(fallback) || 'Asia/Tokyo';
}
