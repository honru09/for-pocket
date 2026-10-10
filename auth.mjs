import { createHmac, timingSafeEqual } from 'node:crypto';

export function validateInitData(raw, token, { now = Date.now(), maxAgeSeconds = 86400, enforceFresh = true } = {}) {
  if (typeof raw !== 'string' || !raw || raw.length > 16384 || !token) throw new Error('Missing Telegram authentication');
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate authentication fields');
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Invalid authentication hash');
  params.delete('hash');
  const data = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const calculated = createHmac('sha256', secret).update(data).digest();
  if (!timingSafeEqual(calculated, Buffer.from(hash, 'hex'))) throw new Error('Authentication failed');
  const authDate = Number(params.get('auth_date'));
  const current = Math.floor(now / 1000);
  if (!Number.isSafeInteger(authDate) || authDate < 1 || authDate > current + 30 || (enforceFresh && current - authDate > maxAgeSeconds)) throw new Error('Authentication expired');
  const user = JSON.parse(params.get('user') || 'null');
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot) throw new Error('Invalid Telegram user');
  return user;
}
