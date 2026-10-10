const token=process.env.BOT_TOKEN, publicUrl=process.env.PUBLIC_URL;
async function run() {
  if (!token || !publicUrl) throw new Error('Set BOT_TOKEN and PUBLIC_URL in private .env first.');
  if (new URL(publicUrl).protocol !== 'https:') throw new Error('PUBLIC_URL must use HTTPS.');
  async function call(method,body={}) {
    const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const result=await response.json(); if(!result.ok) throw new Error(`${method} failed (HTTP ${response.status}).`); return result.result;
  }
  const me=await call('getMe');
  if (process.env.EXPECTED_BOT_USERNAME && me.username !== process.env.EXPECTED_BOT_USERNAME) throw new Error('BOT_TOKEN belongs to a different bot.');
  if (process.argv.includes('--apply')) await call('setChatMenuButton',{menu_button:{type:'web_app',text:'＋ 记一笔',web_app:{url:publicUrl}}});
  const menu=await call('getChatMenuButton'), hook=await call('getWebhookInfo');
  const correct=menu.type === 'web_app' && menu.web_app?.url === publicUrl;
  console.log(JSON.stringify({bot:me.username,menuConfigured:correct,webhookConfigured:Boolean(hook.url),pendingUpdates:hook.pending_update_count}));
  if(!correct) throw new Error('Menu does not match PUBLIC_URL. Run npm run bot:configure -- --apply to update it.');
}
run().catch(error=>{console.error(error.message.startsWith('fetch') || error.name === 'TimeoutError' ? `Telegram connection failed (${error.cause?.code || error.name}).` : error.message);process.exitCode=1});
