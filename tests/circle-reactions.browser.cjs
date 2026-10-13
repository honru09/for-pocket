const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname,'..'), token = '123456789:browser-reaction-fixture';
function signed(id, language) {
  const fields = { auth_date:String(Math.floor(Date.now()/1000)), user:JSON.stringify({id,first_name:id===101?'Kojun':'Cheese',language_code:language}) };
  const text = Object.keys(fields).sort().map(key=>`${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256','WebAppData').update(token).digest();
  return new URLSearchParams({...fields,hash:createHmac('sha256',secret).update(text).digest('hex')}).toString();
}
(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(),'for-reaction-browser-'));
  const { createApp } = await import(pathToFileURL(path.join(ROOT,'server.mjs')));
  const api = createApp({token,dataDir});
  api.listen(0,'127.0.0.1'); await once(api,'listening');
  const apiBase = `http://127.0.0.1:${api.address().port}`;
  const request = async (user,route,body,method=body?'POST':'GET') => {
    const res = await fetch(apiBase+'/api'+route,{method,headers:{'X-Telegram-Init-Data':signed(user,'en'),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    assert.equal(res.status,200,route); return res.json();
  };
  const p = await request(101,'/circles/create',{name:'Our little circle'});
  const invite = await request(101,'/circles/invite',{circleId:p.social.activeCircleId});
  await request(202,'/circles/join',{code:invite.code,confirm:true});
  const { createServer } = await import(pathToFileURL(path.join(ROOT,'node_modules/vite/dist/node/index.js')));
  const vite = await createServer({configFile:false,root:ROOT,publicDir:false,logLevel:'error',server:{host:'127.0.0.1',port:0,proxy:{'/api':{target:apiBase}}}});
  await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`, browser = await chromium.launch({headless:true});
  const artifactDir = path.join(ROOT,'outputs','circle-reactions'); await fs.mkdir(artifactDir,{recursive:true});
  let checks = 0;
  try {
    for (const [width,height,language] of [[320,480,'zh'],[320,568,'en'],[320,568,'uk'],[390,590,'en'],[430,932,'uk']]) {
      const pages = [];
      for (const id of [101,202]) {
        const current = await request(id,'/profile');
        await request(id,'/settings',{...current.settings,language,languageManual:true,ledgerId:current.ledgerId},'PUT');
        const context = await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,locale:language==='uk'?'uk-UA':language==='zh'?'zh-CN':'en-US',timezoneId:'Asia/Tokyo'});
        await context.route('**/*',route => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({contentType:'application/javascript',body:''}));
        await context.addInitScript(({raw,id,language}) => {
          window.Telegram={WebApp:{platform:'ios',initData:raw,initDataUnsafe:{user:{id,language_code:language}},ready(){},expand(){},isVersionAtLeast(){return false;},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}};
        },{raw:signed(id,language),id,language});
        const page = await context.newPage(), errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(base); await expect(page.locator('#keypad button').first()).toBeEnabled();
        pages.push({page,context,errors});
      }
      const sender=pages[0].page, recipient=pages[1].page;
      const beforeCount = (await request(101,'/profile')).expenses.length;
      await sender.locator('[data-key="8"]').tap();
      await sender.locator('[data-key="5"]').tap();
      await sender.locator('[data-key="0"]').tap();
      await sender.locator('[data-category="stomach"]').tap();
      const amountBefore = await sender.locator('#amount-display').textContent();
      await sender.locator('[data-member-id="u_202"]').tap();
      await expect(sender.locator('.emoji-sheet')).toBeVisible();
      assert.equal(await sender.locator('[data-member-id="u_202"]').getAttribute('aria-pressed'),null);
      const rect = await sender.locator('.emoji-sheet').boundingBox();
      assert.ok(rect.x>=0 && rect.y>=0 && rect.x+rect.width<=width && rect.y+rect.height<=height,JSON.stringify(rect));
      for (let n=0;n<8;n++) await sender.locator(`[data-emoji="${n%2?'😀':'❤️'}"]`).tap();
      await expect.poll(()=>sender.locator('.flying-emoji').count()).toBeGreaterThan(0);
      assert.equal(await sender.locator('#amount-display').textContent(),amountBefore,'sending emoji never changes the amount');
      await expect.poll(async () => (await request(202,'/circles/reactions')).items.length).toBe(8);
      await sender.screenshot({path:path.join(artifactDir,`emoji-${width}-${language}.png`)});
      await sender.locator('.emoji-sheet>header button').tap();
      await sender.locator('.mascot-confirm').tap();
      await expect(sender.locator('#amount-display')).toHaveText('0');
      await expect.poll(async () => (await request(101,'/profile')).expenses.length).toBe(beforeCount+1);
      const saved = (await request(101,'/profile')).expenses.find(entry=>entry.amountMinor===850);
      assert.equal(saved.consumer,'u_101','the authenticated member remains the payer after opening a companion avatar');
      await recipient.reload();
      await expect(recipient.locator('.flying-emoji.is-incoming').first()).toBeVisible();
      await expect.poll(async ()=>(await request(202,'/circles/reactions')).items.length,{timeout:12000}).toBe(0);
      await recipient.reload(); await expect(recipient.locator('#keypad button').first()).toBeEnabled();
      assert.equal(await recipient.locator('.flying-emoji.is-incoming').count(),0,'acknowledged emoji do not replay');
      await sender.locator('[data-view="history"]').tap();
      await expect(sender.locator('#history-category')).toBeVisible();
      const layout = await sender.locator('.history-title-bar').evaluate(node=>({width:innerWidth,right:node.getBoundingClientRect().right,scroll:document.documentElement.scrollWidth,rows:[...node.querySelectorAll('h1,select,button')].map(el=>({y:el.getBoundingClientRect().y,height:el.getBoundingClientRect().height}))}));
      assert.ok(layout.scroll<=width && layout.right<=width,JSON.stringify(layout));
      assert.ok(Math.max(...layout.rows.map(row=>row.y))-Math.min(...layout.rows.map(row=>row.y))<16,JSON.stringify(layout));
      assert.ok((await sender.locator('#history-category').boundingBox()).width>=58,'category filter remains readable');
      assert.ok((await sender.locator('#history-currency').boundingBox()).width>=50,'currency remains readable');
      assert.ok(await sender.locator('#history-currency').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)<=12),'native dropdown text fits the compact row');
      await sender.locator('#history-category').selectOption('expense:stomach');
      await expect(sender.locator('.expense-row').first()).toBeVisible();
      await sender.screenshot({path:path.join(artifactDir,`ledger-${width}-${language}.png`)});
      await sender.locator('#history-quick-entry').tap();
      await expect(sender.locator('#ai-import-view')).toBeVisible();
      for (const item of pages) { assert.deepEqual(item.errors,[]); await item.context.close(); }
      checks+=13;
      console.log(`PASS ${width}x${height} ${language}: continuous emoji, receipt/ack, self payer, ledger filters and quick entry`);
    }
    console.log(`PASS: ${checks} circle and compact ledger checks; screenshots: ${artifactDir}`);
  } finally {
    await browser.close(); await vite.close(); await new Promise(resolve=>api.close(resolve));
    assert.equal(path.dirname(dataDir),path.resolve(os.tmpdir())); assert.ok(path.basename(dataDir).startsWith('for-reaction-browser-'));
    await fs.rm(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
