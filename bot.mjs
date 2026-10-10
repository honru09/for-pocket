// Standalone Telegram bot runner. Cloud Run can reuse createTelegramHandler
// from telegram-ai.mjs for webhook updates; this file keeps a simple long
// polling process for local development and small deployments.
import { deriveTelegramWebhookSecret } from './telegram-config.mjs';

const token = process.env.BOT_TOKEN || '';
const publicUrl = process.env.PUBLIC_URL || '';
let webhookSecret;
if (!token || !publicUrl) {
  console.error('请先在 .env 设置 BOT_TOKEN 和 PUBLIC_URL。');
  process.exit(1);
}
try {
  if (new URL(publicUrl).protocol !== 'https:') throw new Error('PUBLIC_URL 必须是可公开访问的 HTTPS 地址。');
  webhookSecret = deriveTelegramWebhookSecret(token, process.env.TELEGRAM_WEBHOOK_SECRET);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const stop = new AbortController();
process.on('SIGINT', () => stop.abort());
process.on('SIGTERM', () => stop.abort());

async function call(method, parameters = {}) {
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(60000)]);
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parameters),
    signal,
  });
  const result = await response.json();
  if (!result.ok) throw Object.assign(new Error('Telegram request failed.'), { telegramCode: result.error_code || response.status });
  return result.result;
}

async function run() {
  const me = await call('getMe');
  const webhook = await call('getWebhookInfo');
  if (webhook.url) throw new Error('此 bot 已配置 webhook。请选用一个新 bot，或明确移除原 webhook 后再运行。');
  await call('setChatMenuButton', { menu_button: { type: 'web_app', text: '＋ 记一笔', web_app: { url: publicUrl } } });
  console.log(`@${me.username} is ready. Send /start in a private chat.`);
  let offset = 0;
  while (!stop.signal.aborted) {
    try {
      const updates = await call('getUpdates', { offset, timeout: 40, allowed_updates: ['message', 'callback_query'] });
      for (const update of updates) {
        // The server owns the shared transactional store; a second polling
        // process must not load an independent copy of the same JSON database.
        const response = await fetch(new URL('/api/telegram/webhook', publicUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': webhookSecret },
          body: JSON.stringify(update),
          signal: AbortSignal.any([stop.signal, AbortSignal.timeout(90000)]),
        });
        if (!response.ok) throw new Error('Telegram handler request failed.');
        offset = update.update_id + 1;
      }
    } catch (err) {
      if (stop.signal.aborted) return;
      console.error('Telegram connection failed; retrying in 5 seconds.');
      if (err?.telegramCode === 409) throw new Error('同一个 bot 已有另一个轮询进程，请只运行一个 bot 进程。');
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); stop.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 5000);
        stop.signal.addEventListener('abort', done, { once: true });
      });
    }
  }
}

run().catch(err => {
  if (!stop.signal.aborted) {
    console.error(String(err?.message || '').includes('fetch') ? 'Telegram connection failed.' : err.message);
    process.exitCode = 1;
  }
});
