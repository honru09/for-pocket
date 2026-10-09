// Optional bot entry point. Run after configuring .env with your own bot.
const token = process.env.BOT_TOKEN;
const publicUrl = process.env.PUBLIC_URL;
if (!token || !publicUrl) { console.error('请先在 .env 设置 BOT_TOKEN 和 PUBLIC_URL。'); process.exit(1); }
try { if (new URL(publicUrl).protocol !== 'https:') throw new Error(); }
catch { console.error('PUBLIC_URL 必须是可公开访问的 HTTPS 地址。'); process.exit(1); }
const stop = new AbortController();
process.on('SIGINT', () => stop.abort()); process.on('SIGTERM', () => stop.abort());
async function call(method, parameters = {}) {
  // Never include the token or full request URL in an error log.
  const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(60000)]);
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parameters), signal });
  const result = await response.json();
  if (!result.ok) throw new Error(`${method}: ${result.description || response.status}`);
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
      const updates = await call('getUpdates', { offset, timeout: 40, allowed_updates: ['message'] });
      for (const update of updates) {
        const message = update.message;
        if (message?.chat?.type === 'private' && /^\/(start|help)(@\w+)?(?:\s|$)/.test(message.text || '')) {
          await call('sendMessage', { chat_id: message.chat.id, text: 'for. 花给生活\n\n一碗拉面、一杯咖啡、一本新书。\n随手记下，每一笔都有去处。\n\n打开 → 输入金额 → 选用途 → 记下。', reply_markup: { inline_keyboard: [[{ text: '＋ 打开小账本', web_app: { url: publicUrl } }]] } });
        }
        offset = update.update_id + 1;
      }
    } catch (err) {
      if (stop.signal.aborted) return;
      console.error(err.message.startsWith('getUpdates:') || err.message.startsWith('sendMessage:') ? err.message : 'Telegram connection failed; retrying in 5 seconds.');
      if (/409/.test(err.message) || /Conflict/.test(err.message)) throw new Error('同一个 bot 已有另一个轮询进程，请只运行一个 bot 进程。');
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); stop.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 5000); stop.signal.addEventListener('abort', done, { once: true });
      });
    }
  }
}
run().catch(err => { if (!stop.signal.aborted) { console.error(err.message.includes('fetch') ? 'Telegram connection failed.' : err.message); process.exitCode = 1; } });
