import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceTimezone, validTimezone } from '../public/timezone.mjs';

test('device timezone uses the system IANA zone and never requires a picker', () => {
  assert.equal(validTimezone('Asia/Tokyo'), 'Asia/Tokyo');
  assert.equal(validTimezone('not/a-zone'), null);
  assert.equal(deviceTimezone({ intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'Europe/Kyiv' }) }) } }), 'Europe/Kyiv');
});

test('timezone falls back to a country only when the system zone is unavailable', () => {
  const intl = { DateTimeFormat: () => { throw new Error('unavailable'); } };
  assert.equal(deviceTimezone({ intl, countryCode: 'JP' }), 'Asia/Tokyo');
  assert.equal(deviceTimezone({ intl, countryCode: 'CN' }), 'Asia/Shanghai');
});
