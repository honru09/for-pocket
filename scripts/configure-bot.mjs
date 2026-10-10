import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveTelegramWebhookSecret, ensureTelegramWebhook } from '../telegram-config.mjs';

export async function configureTelegramBot({
  token = process.env.BOT_TOKEN,
  publicUrl = process.env.PUBLIC_URL,
  webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET,
  expectedUsername = process.env.EXPECTED_BOT_USERNAME,
  apply = false,
  callTelegram,
} = {}) {
  if (!token || !publicUrl) throw new Error('Set BOT_TOKEN and PUBLIC_URL in private .env first.');
  if (new URL(publicUrl).protocol !== 'https:') throw new Error('PUBLIC_URL must use HTTPS.');
  const secret = deriveTelegramWebhookSecret(token, webhookSecret);
  const call = callTelegram || (async (method, body = {}) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!result.ok) throw new Error(`${method} failed (HTTP ${response.status}).`);
    return result.result;
  });
  const me = await call('getMe');
  if (expectedUsername && me.username !== expectedUsername) throw new Error('BOT_TOKEN belongs to a different bot.');
  const expectedWebhook = new URL('/api/telegram/webhook', publicUrl).href;
  // Verification is read-only. Explicit --apply can register this endpoint;
  // a different existing webhook is never overwritten, even on the same host.
  if (apply) {
    const setup = await ensureTelegramWebhook({ token, publicUrl, webhookSecret: secret, callTelegram: call });
    if (setup.status === 'blocked') throw new Error('This bot already uses a different webhook. It was not changed.');
    await call('setChatMenuButton', { menu_button: { type: 'web_app', text: '＋ 记一笔', web_app: { url: publicUrl } } });
  }
  const menu = await call('getChatMenuButton'), hook = await call('getWebhookInfo');
  const menuConfigured = menu.type === 'web_app' && menu.web_app?.url === publicUrl;
  const webhookConfigured = hook.url === expectedWebhook;
  const status = { bot: me.username, menuConfigured, webhookConfigured, pendingUpdates: hook.pending_update_count };
  if (!menuConfigured) throw new Error('Menu does not match PUBLIC_URL. Run npm run bot:configure -- --apply to update it.');
  if (!webhookConfigured) throw new Error('Webhook does not match PUBLIC_URL. Run npm run bot:configure -- --apply to update it.');
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  configureTelegramBot({ apply: process.argv.includes('--apply') })
    .then(status => console.log(JSON.stringify(status)))
    .catch(error => {
      console.error(error.message.startsWith('fetch') || error.name === 'TimeoutError' ? `Telegram connection failed (${error.cause?.code || error.name}).` : error.message);
      process.exitCode = 1;
    });
}
