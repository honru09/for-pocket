const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
// Separate browser regression; npm test runs the dependency-free Node suite.
// Run with Playwright installed locally or set NODE_PATH to an existing
// node_modules directory containing playwright, then:
//   node tests/confirm-touch.browser.cjs
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = fs.mkdtempSync(path.join(os.tmpdir(), 'for-pocket-confirm-'));

(async () => {
  const { createServer } = await import(pathToFileURL(`${ROOT}/node_modules/vite/dist/node/index.js`));
  const server = await createServer({ configFile:false, root:ROOT, publicDir:false, logLevel:'error', server:{host:'127.0.0.1',port:0} });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({headless:true});
  const results = [];
  try {
    for (const [width,height] of [[320,480],[320,568],[390,590],[390,844]]) {
      const context = await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,locale:'en-US',timezoneId:'Asia/Tokyo'});
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base) {
          if (url.pathname === '/api/config') return route.fulfill({contentType:'application/json',body:JSON.stringify({mode:'local'})});
          return route.continue();
        }
        return route.fulfill({contentType:'application/javascript',body:''});
      });
      await context.addInitScript(() => {
        window.Telegram = {WebApp:{platform:'ios',initData:'',initDataUnsafe:{user:{language_code:'en'}},ready(){},expand(){},isVersionAtLeast(){return false;},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}};
        window.__tapEvents=[];
        document.addEventListener('click', event => {
          const control = event.target.closest('.mascot-confirm,.mascot-toy,.type-pill-btn,#currency');
          if (control) window.__tapEvents.push({control:control.className,x:event.clientX,y:event.clientY,pointerType:event.pointerType});
        },true);
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await expect(page.locator('#keypad button').first()).toBeEnabled();
      await page.locator('main').evaluate(node => Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
      let entries = 0;
      const enter = async () => {
        for (const key of '250') await page.locator(`[data-key="${key}"]`).tap();
        await page.locator('[data-category="stomach"]').tap();
        await expect(page.locator('.mascot-confirm')).toBeVisible();
        await page.locator('.mascot-confirm>span').evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
      };
      const hitAt = ({x,y}) => page.evaluate(({x,y}) => {
        const el = document.elementFromPoint(x,y);
        const control = el?.closest('.mascot-confirm,.mascot-toy,.type-pill-btn,#currency');
        return {tag:el?.tagName,className:control?.className || null};
      },{x,y});
      const saveAt = async (name,point,hold = false) => {
        const hit = await hitAt(point);
        assert.ok(hit.className?.includes('mascot-confirm'),`${width}x${height} ${name} hits ${JSON.stringify(hit)}`);
        if (hold) {
          const cdp = await context.newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});
          await page.waitForTimeout(150);
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          await cdp.detach();
        } else await page.touchscreen.tap(point.x,point.y);
        await expect(page.locator('#amount-display')).toHaveText('0');
        entries++;
        await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses.length)).toBe(entries);
        results.push({width,height,name,point,hit,entries});
      };
      await enter();
      const toy = await page.locator('.mascot-toy').boundingBox();
      const cloudCenter = {x:toy.x+toy.width/2,y:toy.y+toy.height/2};
      const cloudHit = await hitAt(cloudCenter);
      assert.ok(cloudHit.className?.includes('mascot-toy'),`Cloud center covered: ${JSON.stringify(cloudHit)}`);
      await page.touchscreen.tap(cloudCenter.x,cloudCenter.y);
      await expect(page.locator('.mascot-toy')).toHaveAttribute('data-mood','1');
      await expect(page.locator('#amount-display')).toHaveText('250');
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1'))?.expenses?.length || 0),0);
      results.push({width,height,name:'cloud-toy-preserved',cloudHit});
      await page.screenshot({path:`${ARTIFACTS}/confirm-badge-${width}x${height}.png`});
      await page.locator('.amount-stage').screenshot({path:`${ARTIFACTS}/confirm-stage-${width}x${height}.png`});

      for (const name of ['center','left','right','top','bottom']) {
        if (entries) await enter();
        const box = await page.locator('.mascot-confirm>span').boundingBox();
        assert.ok(box);
        const offsets = {center:[box.width/2,box.height/2],left:[2,box.height/2],right:[box.width-2,box.height/2],top:[box.width/2,2],bottom:[box.width/2,box.height-2]};
        const [dx,dy] = offsets[name];
        await saveAt(`badge-${name}`,{x:box.x+dx,y:box.y+dy});
      }
      for (const name of ['left','right','top','bottom']) {
        await enter();
        const box = await page.locator('.mascot-confirm').boundingBox();
        assert.ok(box.width >= 44 && box.width <= 56,`Touch width should stay in the 44–56px comfort range: ${box.width}`);
        assert.ok(box.height >= 44 && box.height <= 56,`Touch height should stay in the 44–56px comfort range: ${box.height}`);
        const offsets = {left:[2,box.height/2],right:[box.width-2,box.height/2],top:[box.width/2,2],bottom:[box.width/2,box.height-2]};
        const [dx,dy] = offsets[name];
        const point = {x:box.x+dx,y:box.y+dy};
        await saveAt(`expanded-${name}`,point);
      }
      if (width === 390 && height === 844) {
        for (const name of ['left','right','top','bottom']) {
          await enter();
          const box = await page.locator('.mascot-confirm>span').boundingBox();
          const offsets = {left:[2,box.height/2],right:[box.width-2,box.height/2],top:[box.width/2,2],bottom:[box.width/2,box.height-2]};
          const [dx,dy] = offsets[name];
          await saveAt(`held-150ms-${name}`,{x:box.x+dx,y:box.y+dy},true);
        }
      }
      await enter();
      for (const type of ['income','expense']) {
        const control = page.locator('.type-pill-btn').filter({hasText:new RegExp(`^${type}$`,'i')});
        const box = await control.boundingBox(), point = {x:box.x+box.width/2,y:box.y+box.height/2};
        const hit = await hitAt(point);
        assert.ok(hit.className?.includes('type-pill-btn'));
        await page.touchscreen.tap(point.x,point.y);
        await expect(control).toHaveAttribute('aria-pressed','true');
        results.push({width,height,name:`type-${type}`,hit});
      }
      await page.locator('[data-category="stomach"]').tap();
      const currency = page.locator('#currency');
      const currencyBox = await currency.boundingBox();
      const currencyPoint = {x:currencyBox.x+currencyBox.width/2,y:currencyBox.y+currencyBox.height/2};
      const currencyHit = await hitAt(currencyPoint);
      assert.ok(currencyHit.className?.includes('currency-control') || currencyHit.tag === 'SELECT');
      const beforeTapEvents = await page.evaluate(()=>window.__tapEvents.length);
      await page.touchscreen.tap(currencyPoint.x,currencyPoint.y);
      await expect.poll(()=>page.evaluate(()=>window.__tapEvents.length)).toBeGreaterThan(beforeTapEvents);
      await page.keyboard.press('Escape');
      await currency.selectOption('USD');
      await expect(currency).toHaveValue('USD');
      await currency.selectOption('JPY');
      await expect(currency).toHaveValue('JPY');
      results.push({width,height,name:'currency-accessible',currencyHit});
      const layout = await page.evaluate(()=>({viewportWidth:innerWidth,viewportHeight:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,scrollY}));
      assert.ok(layout.scrollWidth <= width,`Horizontal overflow ${JSON.stringify(layout)}`);
      assert.ok(layout.scrollHeight <= height,`Vertical overflow ${JSON.stringify(layout)}`);
      assert.deepEqual(errors,[]);
      const tapEvents = await page.evaluate(()=>window.__tapEvents);
      const confirmTaps = tapEvents.filter(event=>event.control.includes('mascot-confirm'));
      assert.equal(confirmTaps.length,entries);
      assert.ok(confirmTaps.every(event=>event.pointerType === 'touch'));
      console.log(JSON.stringify({width,height,entries,layout,errors}));
      await context.close();
    }
    fs.writeFileSync(`${ARTIFACTS}/confirm-touch-regression-results.json`,JSON.stringify(results,null,2));
    console.log(`PASS: ${results.length} touch and control checks; artifacts: ${ARTIFACTS}`);
  } finally {await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

