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
  const api = createApp({token,dataDir,callTelegram:async()=>({message_id:1}),resolveLocation:async location=>({...location,name:'テストカフェ',area:'新宿',countryCode:'JP'})});
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
      await request(202,'/location/presence-clear',{});
      if (language !== 'zh') await request(202,'/location/reverse',{location:{lat:35.69,lng:139.7}});
      const pages = [];
      for (const id of [101,202]) {
        const current = await request(id,'/profile');
        await request(id,'/settings',{...current.settings,language,languageManual:true,ledgerId:current.ledgerId},'PUT');
        const context = await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,locale:language==='uk'?'uk-UA':language==='zh'?'zh-CN':'en-US',timezoneId:'Asia/Tokyo'});
        await context.route('**/*',route => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({contentType:'application/javascript',body:''}));
        await context.addInitScript(({raw,id,language}) => {
          window.Telegram={WebApp:{platform:'ios',initData:raw,initDataUnsafe:{user:{id,language_code:language}},ready(){},expand(){},isVersionAtLeast(){return false;},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}};
          window.__clipboardReads=0;
          Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>{window.__clipboardReads++;return 'Coffee 850 JPY';},writeText:async()=>{}}});
          Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>{throw new TypeError('This iOS permission is unsupported');}}});
          window.__reactionVisible=true;
          Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__reactionVisible?'visible':'hidden'});
          window.__setReactionVisible=value=>{window.__reactionVisible=value;document.dispatchEvent(new Event('visibilitychange'));};
          window.__reactionCounts=[];
          new MutationObserver(()=>{for(const node of document.querySelectorAll('[data-reaction-count]'))window.__reactionCounts.push(Number(node.dataset.reactionCount));}).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['data-reaction-count']});
        },{raw:signed(id,language),id,language});
        const page = await context.newPage(), errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(base); await expect(page.locator('#keypad button').first()).toBeEnabled();
        pages.push({page,context,errors});
      }
      const sender=pages[0].page, recipient=pages[1].page;
      await recipient.locator('[data-view="history"]').tap();
      await expect(recipient.locator('#history-category')).toBeVisible();
      await expect(recipient.locator('.app-header-reactions')).toHaveCount(0);
      await expect(recipient.locator('.footprints')).toHaveCount(0);
      await expect(recipient.locator('.expense-location')).toHaveCount(0);
      await expect(recipient.locator('.profile-trigger .person-avatar')).toHaveCount(1);
      await recipient.evaluate(()=>window.__setReactionVisible(false));
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
      assert.ok(rect.height<180,'emoji drawer remains compact');
      assert.ok(await sender.locator('.emoji-drawer [data-emoji]').count()>=80,'many emoji choices');
      const palette = await sender.locator('.emoji-drawer').evaluate(node=>({horizontal:node.scrollWidth>node.clientWidth,row:new Set([...node.children].map(el=>Math.round(el.getBoundingClientRect().top))).size,buttonSize:node.firstElementChild.getBoundingClientRect().width}));
      assert.ok(palette.horizontal && palette.row===1 && palette.buttonSize>=44,JSON.stringify(palette));
      assert.equal(await sender.locator('.emoji-person-location').count(),0,'emoji dialog keeps the recipient row compact');
      await sender.locator('.emoji-drawer').evaluate(node=>node.scrollTo({left:node.scrollWidth,behavior:'instant'}));
      await expect(sender.locator('[data-emoji="🧸"]')).toBeInViewport();
      await sender.locator('.emoji-drawer').evaluate(node=>node.scrollTo({left:0,behavior:'instant'}));
      for (let n=0;n<10;n++) await sender.locator('[data-emoji="❤️"]').tap();
      await expect.poll(()=>sender.locator('.flying-emoji').count()).toBeGreaterThan(0);
      assert.equal(await sender.locator('#amount-display').textContent(),amountBefore,'sending emoji never changes the amount');
      await expect.poll(async () => (await request(202,'/circles/reactions')).items.length).toBe(10);
      await sender.screenshot({path:path.join(artifactDir,`emoji-${width}-${language}.png`)});
      await sender.locator('.emoji-sheet>header button').tap();
      await sender.locator('.mascot-confirm').tap();
      await expect(sender.locator('#amount-display')).toHaveText('0');
      await expect.poll(async () => (await request(101,'/profile')).expenses.length).toBe(beforeCount+1);
      const saved = (await request(101,'/profile')).expenses.find(entry=>entry.amountMinor===850);
      assert.equal(saved.consumer,'u_101','the authenticated member remains the payer after opening a companion avatar');
      await recipient.evaluate(()=>window.__setReactionVisible(true));
      await expect(recipient.locator('.incoming-emoji').first()).toBeVisible();
      await expect(recipient.locator('#history-category')).toBeVisible();
      await expect.poll(()=>recipient.evaluate(()=>window.__reactionCounts.includes(10))).toBe(true);
      await expect(recipient.locator('.emoji-burst-count').last()).toHaveText('✖️🔟');
      await recipient.screenshot({path:path.join(artifactDir,`receive-${width}-${language}.png`)});
      await expect.poll(async ()=>(await request(202,'/circles/reactions')).items.length,{timeout:12000}).toBe(0);
      await recipient.reload(); await expect(recipient.locator('#keypad button').first()).toBeEnabled();
      assert.equal(await recipient.locator('.incoming-emoji').count(),0,'acknowledged emoji do not replay');
      if(width===320 && height===480) {
        await recipient.locator('[data-member-id="u_101"]').tap();
        await request(101,'/circles/reactions',{id:'browser-dialog-reaction',recipientId:'u_202',emoji:'🌷'});
        await expect(recipient.locator('.emoji-sheet .incoming-emoji')).toBeVisible();
        assert.equal(await recipient.locator('.incoming-emoji .emoji-burst-count').count(),0,'one emoji has no count');
        await recipient.locator('.incoming-emoji').evaluate(node=>{window.__receivedNode=node;});
        await recipient.locator('.emoji-sheet>header button').tap();
        await expect(recipient.locator('.incoming-emoji')).toBeVisible();
        assert.ok(await recipient.locator('.incoming-emoji').evaluate(node=>!node.closest('dialog')),'received emoji stays above the current page after closing its dialog');
        assert.ok(await recipient.locator('.incoming-emoji').evaluate(node=>node===window.__receivedNode),'the same animated node moves out of the dialog without replaying');
        await expect.poll(async ()=>(await request(202,'/circles/reactions')).items.length).toBe(0);
        await expect(recipient.locator('.incoming-emoji')).toHaveCount(0);
        checks+=5;
      }
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
      const hit = await sender.locator('#history-quick-entry').evaluate(button=>{
        const box=button.getBoundingClientRect(),icon=button.querySelector('svg').getBoundingClientRect();
        const points=[[box.x+box.width/2,box.y+box.height/2],[box.x+5,box.y+5],[box.right-5,box.y+5],[box.x+5,box.bottom-5],[box.right-5,box.bottom-5]];
        return {hits:points.every(([x,y])=>document.elementFromPoint(x,y)?.closest('#history-quick-entry')===button),inside:icon.x>=box.x&&icon.y>=box.y&&icon.right<=box.right&&icon.bottom<=box.bottom,box,icon};
      });
      assert.ok(hit.hits&&hit.inside,JSON.stringify(hit));
      await sender.locator('[data-view="record"]').tap();
      await expect(sender.locator('#keypad')).toBeVisible();
      assert.equal(await sender.evaluate(()=>window.__clipboardReads),0,'first tap navigates without triggering iOS Paste permission');
      await sender.locator('[data-view="history"]').tap();
      await sender.locator('#history-quick-entry').tap();
      await expect(sender.locator('#ai-import-view')).toBeVisible();
      for (const item of pages) { assert.deepEqual(item.errors,[]); await item.context.close(); }
      checks+=24;
      console.log(`PASS ${width}x${height} ${language}: horizontal emoji drawer, compact ledger, burst count, receipt/ack, self payer, clipboard-free navigation and quick entry hit targets`);
    }
    console.log(`PASS: ${checks} circle and compact ledger checks; screenshots: ${artifactDir}`);
  } finally {
    await browser.close(); await vite.close(); await new Promise(resolve=>api.close(resolve));
    assert.equal(path.dirname(dataDir),path.resolve(os.tmpdir())); assert.ok(path.basename(dataDir).startsWith('for-reaction-browser-'));
    await fs.rm(dataDir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
