import { createHmac } from 'node:crypto';

const SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export function deriveTelegramWebhookSecret(token, configured = '') {
  if (configured !== '' && configured !== undefined && configured !== null) {
    if (typeof configured !== 'string' || !SECRET_PATTERN.test(configured)) {
      throw new Error('TELEGRAM_WEBHOOK_SECRET must contain only A-Z, a-z, 0-9, _ or - (1–256 characters).');
    }
    return configured;
  }
  if (typeof token !== 'string' || !token.trim()) throw new Error('BOT_TOKEN is required to derive the Telegram webhook secret.');
  return createHmac('sha256', token).update('for-pocket:webhook:v1').digest('hex');
}

/** Register this exact endpoint only when it is free or already ours. */
export async function ensureTelegramWebhook({ token, publicUrl, webhookSecret, callTelegram, webhookPath = '/api/telegram/webhook', legacyPaths = [] } = {}) {
  if (typeof token !== 'string' || !token.trim() || !publicUrl) throw new Error('BOT_TOKEN and PUBLIC_URL are required for Telegram webhook setup.');
  let target;
  try {
    const origin = new URL(publicUrl);
    if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error();
    if (typeof webhookPath !== 'string' || !webhookPath.startsWith('/') || webhookPath.includes('..')) throw new Error();
    target = new URL(webhookPath, origin).href;
  } catch { throw new Error('PUBLIC_URL must use HTTPS for Telegram webhook setup.'); }
  const secret = deriveTelegramWebhookSecret(token, webhookSecret);
  const call = callTelegram || (async (method, parameters = {}) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parameters), signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(`Telegram ${method} failed.`);
    return payload.result;
  });
  const hook = await call('getWebhookInfo');
  if (!hook || typeof hook.url !== 'string') throw new Error('Telegram webhook status is unavailable.');
  const legacyTargets = Array.isArray(legacyPaths) ? legacyPaths.map(value => new URL(value, publicUrl).href) : [];
  if (hook.url && hook.url !== target && !legacyTargets.includes(hook.url)) return { status: 'blocked', reason: 'existing-webhook' };
  const configured = await call('setWebhook', {
    url: target,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    max_connections: 1,
  });
  if (configured !== true) throw new Error('Telegram webhook setup failed.');
  return { status: 'configured' };
}
