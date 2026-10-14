const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { expect } = require('playwright/test');

// Real production App; no injected grid or keypad DOM. This specifically
// protects the four 44px rows against their parent track becoming shorter.
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(ROOT, 'outputs/keypad-layout');
const VIEWPORTS = [[320,400],[320,430],[320,460],[320,480],[320,568],[390,590],[390,844],
  [412,915],[768,1024],[1280,900],[1440,1000]];
const THEMES = ['matcha','cheese','peach','sea'];

(async () => {
  const { createServer } = await import(pathToFileURL(path.join(ROOT,'node_modules/vite/dist/node/index.js')));
  const server = await createServer({ configFile:false, root:ROOT, publicDir:false,
    logLevel:'error', server:{ host:'127.0.0.1', port:0 } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({ headless:true });
  const results = [];
  fs.mkdirSync(ARTIFACTS,{ recursive:true });
  try {
    const context = await browser.newContext({ viewport:{ width:390,height:844 },
      hasTouch:true, locale:'en-US', timezoneId:'Asia/Tokyo' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.fulfill({body:''});
      if (url.pathname === '/api/config') return route.fulfill({contentType:'application/json',body:'{"mode":"local"}'});
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.goto(base);
    const key = value => page.locator(`#keypad button[data-key="${value}"]`);
    await expect(key('5')).toBeEnabled();
    const settle = () => page.evaluate(async () => {
      await document.fonts.ready;
      const main = document.querySelector('main');
      await Promise.all((main?.getAnimations() || []).map(animation => animation.finished.catch(()=>{})));
      await new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    });
    for (const [width,height] of VIEWPORTS) {
      await page.setViewportSize({width,height});
      await settle();
      for (const theme of THEMES) {
        await page.locator('#open-settings').click();
        await page.locator('#theme-choice').selectOption(theme);
        await page.locator('.brand').click();
        await settle();
        for (const currency of ['JPY','CNY']) {
          await page.locator('#currency').selectOption(currency);
          await settle();
          await page.evaluate(()=>{
            if(document.documentElement.dataset.pocketTiny==='true') {
              const shell=document.querySelector('.app-shell');shell.scrollTop=shell.scrollHeight;
            }
          });
          const label = `${width}x${height} ${theme} ${currency}`;
          const geometry = await page.evaluate(() => {
            const rect = node => {
              const b=node.getBoundingClientRect();
              return {x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom};
            };
            const nodes=[...document.querySelectorAll('#keypad button')];
            const tools=[...document.querySelectorAll('#entry-location,#edit-note,#edit-draft-time,#open-ai-import')];
            const nav=[...document.querySelectorAll('.bottom-nav button[data-view]')];
            const hit = node => {
              const b=node.getBoundingClientRect();
              return [[.5,.5],[.12,.12],[.88,.88]].every(([x,y]) =>
                document.elementFromPoint(b.x+b.width*x,b.y+b.height*y)?.closest('button')===node);
            };
            return {pad:rect(document.querySelector('#keypad')),keys:nodes.map(node=>({id:node.dataset.key,...rect(node),hit:hit(node)})),
              tools:tools.map(node=>({id:node.id,...rect(node),hit:hit(node)})),
              nav:nav.map(node=>({id:node.dataset.view,...rect(node),hit:hit(node)})),
              navTop:document.querySelector('.bottom-nav').getBoundingClientRect().top,
              documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,
              width:innerWidth,height:innerHeight};
          });
          const overlaps = (a,b) => Math.min(a.right,b.right)-Math.max(a.x,b.x)>.1
            && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>.1;
          assert.ok(geometry.documentWidth<=width,label+' horizontal overflow');
          assert.ok(geometry.documentHeight<=height,label+' vertical overflow');
          for (const button of geometry.keys) {
            assert.ok(button.height>=43.99,`${label} ${button.id} touch height`);
            assert.ok(button.bottom<=geometry.pad.bottom+.1,`${label} ${button.id} exceeds parent track`);
            assert.ok(button.hit,`${label} ${button.id} hitbox is obstructed`);
            assert.ok(button.bottom<=geometry.navTop,`${label} ${button.id} under fixed navigation`);
            for (const tool of geometry.tools) assert.ok(!overlaps(button,tool),`${label} ${button.id} overlaps ${tool.id}`);
          }
          for (const button of geometry.tools) {
            assert.ok(button.hit,`${label} ${button.id} hitbox is obstructed`);
            assert.ok(button.bottom<=geometry.navTop+.1,`${label} ${button.id} under fixed navigation`);
          }
          for (let i=0;i<geometry.tools.length;i++) for(let j=i+1;j<geometry.tools.length;j++)
            assert.ok(!overlaps(geometry.tools[i],geometry.tools[j]),`${label} tool controls overlap`);
          for(const button of geometry.nav) assert.ok(button.hit,`${label} ${button.id} navigation obstructed`);
          // The final row must actually accept input, not just look clear.
          if(currency==='JPY') await key('clear').click();
          else {await page.locator('#currency').selectOption('JPY');await key('clear').click();await page.locator('#currency').selectOption(currency);}
          await key('0').click();await expect(page.locator('#amount-display')).toHaveText('0');
          await key('5').click();await key('backspace').click();await expect(page.locator('#amount-display')).toHaveText('0');
          if(currency==='CNY') {await key('.').click();await expect(page.locator('#amount-display')).toHaveText('0.');}
          results.push({viewport:`${width}x${height}`,theme,currency,keypadHeight:geometry.pad.height,minKeyHeight:Math.min(...geometry.keys.map(x=>x.height))});
          if(theme==='matcha' && currency==='JPY') await page.screenshot({path:path.join(ARTIFACTS,`${width}x${height}.png`)});
        }
      }
    }
    // All relocated entry points must still open their actual production UI.
    for(const height of [460,480]) {
      await page.setViewportSize({width:320,height});await settle();
      for(const id of ['entry-location','edit-note','edit-draft-time']) {
        await page.locator(`#${id}`).click();await expect(page.locator('.pocket-sheet')).toBeVisible();
        await page.locator('.pocket-sheet header button').click();await expect(page.locator('.pocket-sheet')).toHaveCount(0);
      }
      await page.locator('#open-ai-import').click();await expect(page.locator('#ai-import-view')).toBeVisible();
      await page.locator('.brand').click();await settle();
      await page.locator('.bottom-nav [data-view="history"]').click();await expect(page.locator('#history-view')).toBeVisible();
      await page.locator('.bottom-nav [data-view="record"]').click();await settle();
    }
    // Keyboard keeps the cap still on down AND up, including while hovered.
    await page.setViewportSize({width:390,height:844});await page.locator('#currency').selectOption('JPY');await settle();
    const capState = () => key('5').locator('.key-cap').evaluate(node=>({
      transform:getComputedStyle(node).transform,transition:getComputedStyle(node).transitionDuration,
      before:getComputedStyle(node,'::before').transitionDuration,after:getComputedStyle(node,'::after').transitionDuration,
      running:node.getAnimations().filter(a=>a.playState==='running').length,
    }));
    const point=await key('5').boundingBox();await page.mouse.move(point.x+point.width/2,point.y+point.height/2);
    await key('5').focus();
    for(const physical of ['5','Enter',' ']) {
      await page.keyboard.down(physical);await expect(key('5')).toHaveAttribute('data-input','keyboard');
      let state=await capState();assert.equal(state.transform,'none');assert.equal(state.transition,'0s');
      assert.equal(state.before,'0s');assert.equal(state.after,'0s');assert.equal(state.running,0);
      await page.keyboard.up(physical);await settle();
      state=await capState();assert.equal(state.transform,'none');assert.equal(state.transition,'0s');assert.equal(state.running,0);
      await expect(key('5')).toHaveAttribute('data-input','keyboard');
    }
    // Pointer can take over the same key immediately; reduce does not gate it.
    await page.emulateMedia({reducedMotion:'reduce'});
    const before=await key('5').boundingBox();await page.mouse.down();await expect(key('5')).toHaveAttribute('data-input','pointer');
    await page.waitForTimeout(150);const held=await key('5').boundingBox();
    for(const value of ['x','y','width','height']) assert.ok(Math.abs(before[value]-held[value])<.01);
    const pressed=await capState();assert.match(pressed.transform,/0\.965/);assert.equal(pressed.transition,'0.1s');
    await page.mouse.up();assert.equal((await capState()).transition,'0.16s');
    assert.deepEqual(errors,[]);
    // A tall layout viewport can contain a much shorter Telegram viewport.
    // Stub its size channel only; exercise the actual production App and hook.
    const miniContext = await browser.newContext({viewport:{width:320,height:844},hasTouch:true,locale:'en-US'});
    await miniContext.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==base)return route.fulfill({body:''});
      if(url.pathname==='/api/config')return route.fulfill({contentType:'application/json',body:'{"mode":"local"}'});
      return route.continue();
    });
    await miniContext.addInitScript(()=>{
      const handlers=new Map();
      window.Telegram={WebApp:{platform:'ios',initData:'',initDataUnsafe:{user:{language_code:'en'}},viewportStableHeight:844,
        ready(){},expand(){},isVersionAtLeast(){return false;},
        onEvent(name,handler){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(handler);},
        offEvent(name,handler){handlers.get(name)?.delete(handler);},
        BackButton:{show(){},hide(){},onClick(){},offClick(){}}}};
      window.__setStableHeight=height=>{
        window.Telegram.WebApp.viewportStableHeight=height;
        handlers.get('viewportChanged')?.forEach(handler=>handler({isStateStable:true}));
      };
    });
    const mini=await miniContext.newPage(),miniErrors=[],stableResults=[];
    mini.on('pageerror',error=>miniErrors.push(error.message));
    await mini.goto(base);await expect(mini.locator('#keypad button[data-key="5"]')).toBeEnabled();
    for(const height of [480,460,430,400,844]) {
      await mini.evaluate(height=>window.__setStableHeight(height),height);
      await expect(mini.locator('html')).toHaveAttribute('data-pocket-short',String(height<=500));
      await expect(mini.locator('html')).toHaveAttribute('data-pocket-tiny',String(height<460));
      const pane=await mini.evaluate(()=>{
        const shell=document.querySelector('.app-shell');
        if(document.documentElement.dataset.pocketTiny==='true')shell.scrollTop=shell.scrollHeight;
        return{scrollHeight:shell.scrollHeight,clientHeight:shell.clientHeight,scrollTop:shell.scrollTop};
      });
      if(height<460) {assert.ok(pane.scrollHeight>pane.clientHeight);assert.ok(pane.scrollTop>0);}
      else assert.equal(pane.scrollTop,0);
      const measured=await mini.evaluate(()=>{
        const nodes=[...document.querySelectorAll('#keypad button,#entry-location,#edit-note,#edit-draft-time,#open-ai-import,.bottom-nav button[data-view]')];
        const rect=node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};
        return{short:document.documentElement.dataset.pocketShort,
          pad:rect(document.querySelector('#keypad')),navTop:document.querySelector('.bottom-nav').getBoundingClientRect().top,
          navBottom:document.querySelector('.bottom-nav').getBoundingClientRect().bottom,
          statsDisplay:getComputedStyle(document.querySelector('.today-strip>div')).display,
          stripPosition:getComputedStyle(document.querySelector('.today-strip')).position,
          buttons:nodes.map(node=>({id:node.id||node.dataset.key||node.dataset.view,...rect(node),
            hit:[[.5,.5],[.12,.12],[.88,.88]].every(([x,y])=>{
              const b=node.getBoundingClientRect();return document.elementFromPoint(b.x+b.width*x,b.y+b.height*y)?.closest('button')===node;
            })}))};
      });
      for(const button of measured.buttons) assert.ok(button.hit,`Telegram stable ${height}: ${button.id} obstructed`);
      for(let i=0;i<measured.buttons.length;i++) for(let j=i+1;j<measured.buttons.length;j++) {
        const a=measured.buttons[i],b=measured.buttons[j];
        const overlap=Math.min(a.right,b.right)-Math.max(a.x,b.x)>.1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>.1;
        assert.ok(!overlap,`Telegram stable ${height}: ${a.id} overlaps ${b.id}`);
      }
      const last=measured.buttons.find(button=>button.id==='backspace');
      assert.ok(last.bottom<=measured.pad.bottom+.1,`Telegram stable ${height}: last row exceeds parent`);
      assert.ok(measured.navBottom<=height+.1,`Telegram stable ${height}: navigation outside usable area`);
      if(height<=500) {
        assert.equal(measured.statsDisplay,'none');assert.ok(Math.abs(measured.pad.height-182)<.01);
        for(const id of ['entry-location','edit-note','edit-draft-time','open-ai-import']) {
          const button=measured.buttons.find(button=>button.id===id);
          assert.ok(button.bottom<=measured.navTop,`Telegram stable ${height}: tool under navigation`);
        }
      } else {assert.notEqual(measured.statsDisplay,'none');assert.equal(measured.stripPosition,'static');}
      await mini.locator('#keypad button[data-key="5"]').click();
      await mini.locator('#keypad button[data-key="backspace"]').click();
      await expect(mini.locator('#amount-display')).toHaveText('0');
      stableResults.push({layoutViewport:'320x844',stableHeight:height,keypadHeight:measured.pad.height,short:measured.short,pane});
      await mini.screenshot({path:path.join(ARTIFACTS,`telegram-stable-${height}.png`)});
    }
    assert.deepEqual(miniErrors,[]);await miniContext.close();
    fs.writeFileSync(path.join(ARTIFACTS,'results.json'),JSON.stringify({results,stableResults,errors,miniErrors},null,2));
    console.log(`PASS ${results.length} production layout combinations; compact entry points; static keyboard; pointer handoff; reduce policy; Telegram size simulation 480/460/430/400/restore844`);
  } finally {await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
