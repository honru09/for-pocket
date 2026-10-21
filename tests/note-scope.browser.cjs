const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const token = '123456789:note-scope-browser-fixture';
function signed() {
  const fields = { auth_date:String(Math.floor(Date.now() / 1000)), user:JSON.stringify({ id:301, first_name:'Note scope', language_code:'en' }) };
  const text = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash:createHmac('sha256', secret).update(text).digest('hex') }).toString();
}

(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'for-note-scope-'));
  const { createApp } = await import(pathToFileURL(path.join(ROOT, 'server.mjs')));
  const api = createApp({ token, dataDir, callTelegram:async () => ({ message_id:1 }) });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  const apiBase = `http://127.0.0.1:${api.address().port}`;
  const request = async (route, body) => {
    const response = await fetch(apiBase + '/api' + route, {
      method:body ? 'POST' : 'GET',
      headers:{ 'X-Telegram-Init-Data':signed(), 'Content-Type':'application/json' },
      body:body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, 200, route);
    return response.json();
  };
  const circleProfile = await request('/circles/create', { name:'Saved circle draft' });
  const circleId = circleProfile.social.activeCircleId;
  const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')));
  const vite = await createServer({ configFile:false, root:ROOT, publicDir:false, logLevel:'error', server:{ host:'127.0.0.1', port:0, proxy:{ '/api':{ target:apiBase } } } });
  await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const browser = await chromium.launch({ headless:true });
  try {
    const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, locale:'en-US', timezoneId:'Asia/Tokyo' });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ contentType:'application/javascript', body:'' }));
    await context.addInitScript(raw => {
      window.Telegram = { WebApp:{ platform:'ios', initData:raw, initDataUnsafe:{ user:{ id:301, language_code:'en' } }, ready(){}, expand(){}, isVersionAtLeast(){ return false; }, onEvent(){}, offEvent(){}, BackButton:{ show(){}, hide(){}, onClick(){}, offClick(){} } } };
    }, signed());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await expect(page.locator('#keypad button').first()).toBeEnabled();
    const enter = async (amount, note) => {
      for (const digit of amount) await page.locator(`[data-key="${digit}"]`).tap();
      await page.locator('[data-category="stomach"]').tap();
      await page.locator('#edit-note').tap();
      await page.locator('#note').fill(note);
    };

    // Seed the circle's cached draft without submitting it.
    await enter('450', 'Circle coffee');
    await page.locator('dialog header button').tap();
    // This API action represents the same account switching ledger on a
    // second device. The mounted App must learn it through its real poll.
    await request('/circles/switch', { circleId:null });
    await expect(page.locator('#amount-display')).toHaveText('0', { timeout:10000 });
    await enter('850', 'Personal lunch');
    await expect(page.locator('.note-submit')).toBeEnabled();

    await request('/circles/switch', { circleId });
    await expect(page.locator('#amount-display')).toHaveText('450', { timeout:10000 });
    await expect(page.locator('#note'), 'Changing ledger must close the old draft commit surface').toHaveCount(0);
    assert.equal((await request('/profile')).expenses.length, 0, 'Polling a new ledger must never submit either draft');
    await page.locator('#edit-note').tap();
    await expect(page.locator('#note')).toHaveValue('Circle coffee');

    // Both unsaved drafts survive; moving back cannot leave the circle
    // commit button operating on the personal draft either.
    await request('/circles/switch', { circleId:null });
    await expect(page.locator('#amount-display')).toHaveText('850', { timeout:10000 });
    await expect(page.locator('#note')).toHaveCount(0);
    await page.locator('#edit-note').tap();
    await expect(page.locator('#note')).toHaveValue('Personal lunch');
    await page.locator('.note-submit').tap();
    await expect(page.locator('#amount-display')).toHaveText('0');
    await expect.poll(async () => (await request('/profile')).expenses.length).toBe(1);
    const [entry] = (await request('/profile')).expenses;
    assert.equal(entry.note, 'Personal lunch');
    assert.equal(entry.amountMinor, 850);
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS: remote profile polling closes the note sheet on ledger changes, preserves both drafts, and submits only the reopened personal draft');
  } finally {
    await browser.close(); await vite.close(); await new Promise(resolve => api.close(resolve));
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-note-scope-'));
    await fs.rm(dataDir, { recursive:true, force:true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
