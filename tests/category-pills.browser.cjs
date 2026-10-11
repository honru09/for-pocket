const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Run with Playwright available locally or through NODE_PATH:
//   node tests/category-pills.browser.cjs
// Set PW_HEADLESS=true on CI. All writes go to isolated preview storage.
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = fs.mkdtempSync(path.join(os.tmpdir(), 'for-pocket-pills-'));

(async () => {
  const { createServer } = await import(pathToFileURL(`${ROOT}/node_modules/vite/dist/node/index.js`));
  const server = await createServer({ configFile:false, root:ROOT, publicDir:false, logLevel:'error', server:{host:'127.0.0.1',port:0} });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({headless:process.env.PW_HEADLESS === 'true'});
  const results = [];
  try {
    for (const [width,height,language] of [[320,568,'zh'],[390,844,'en'],[390,590,'uk']]) {
      const context = await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,locale:language,timezoneId:'Asia/Tokyo'});
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.fulfill({contentType:'application/javascript',body:''});
        if (url.pathname === '/api/config') return route.fulfill({json:{mode:'local'}});
        return route.continue();
      });
      await context.addInitScript(language => {
        window.__haptics = [];
        window.Telegram = {WebApp:{platform:'ios',initData:'',initDataUnsafe:{user:{language_code:language}},ready(){},expand(){},
          isVersionAtLeast(version){return version === '6.1';},setHeaderColor(){},setBackgroundColor(){},onEvent(){},offEvent(){},
          HapticFeedback:{selectionChanged(){window.__haptics.push('selection');},notificationOccurred(kind){window.__haptics.push(kind);}},
          BackButton:{show(){},hide(){},onClick(){},offClick(){}}}};
      },language);
      const page = await context.newPage(), errors = [];
      page.on('pageerror',error => errors.push(error.message));
      await page.goto(base);
      const drawer = page.locator('#categories');
      await expect(drawer.locator('[data-category]')).toHaveCount(30);
      await expect(page.locator('#keypad button').first()).toBeEnabled();
      await page.locator('main').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(()=>{}))));
      const layout = await drawer.evaluate(node => {
        const boxes = [...node.querySelectorAll('[data-category]')].map(button => {
          const box = button.getBoundingClientRect();
          return {id:button.dataset.category,x:box.x,y:box.y,width:box.width,height:box.height};
        });
        const style = getComputedStyle(node);
        return {boxes,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,
          overflowX:style.overflowX,scrollBehavior:style.scrollBehavior,documentWidth:document.documentElement.scrollWidth,
          documentHeight:document.documentElement.scrollHeight};
      });
      assert.ok(layout.scrollWidth > layout.clientWidth, 'Thirty pills should form a horizontal drawer');
      assert.ok(['auto','scroll'].includes(layout.overflowX));
      assert.equal(layout.scrollBehavior,'smooth');
      assert.ok(layout.scrollHeight <= layout.clientHeight+1,'Drawer must not scroll vertically');
      assert.ok(layout.boxes.every(box => Math.abs(box.y-layout.boxes[0].y)<=1),'Pills must stay in a single row');
      assert.ok(layout.boxes.every(box => box.height>=40 && box.height<=48),'Pills should have compact, tappable heights');
      assert.ok(layout.documentWidth<=width,'Drawer must not overflow the page horizontally');
      assert.ok(layout.documentHeight<=height+1,'Record screen must fit the mobile viewport');

      for (const digit of '850') await page.locator(`[data-key="${digit}"]`).tap();
      const priorScrollY = await page.evaluate(()=>scrollY);
      const box = await drawer.boundingBox();
      const cdp = await context.newCDPSession(page);
      const start = {x:box.x+box.width-24,y:box.y+box.height/2};
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
      for (let step=1;step<=8;step++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x-step*(box.width-48)/8,y:start.y}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await cdp.detach();
      await expect.poll(()=>drawer.evaluate(node=>node.scrollLeft)).toBeGreaterThan(20);
      await expect(page.locator('#amount-display')).toHaveText('850');
      assert.equal(await drawer.locator('[aria-pressed="true"]').count(),0,'Swiping must not select a category');
      assert.equal(await page.evaluate(()=>scrollY),priorScrollY,'Horizontal drag must not shift the record screen');
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1'))?.expenses?.length || 0),0,'Swiping must not create an entry');

      const selectedId = await drawer.evaluate(node => {
        const outer = node.getBoundingClientRect();
        return [...node.querySelectorAll('[data-category]')].find(button => {
          const rect=button.getBoundingClientRect();
          return rect.left>=outer.left && rect.right<=outer.right;
        })?.dataset.category;
      });
      assert.ok(selectedId,'A complete pill should remain tappable after a swipe');
      const hapticsBefore = await page.evaluate(()=>window.__haptics.length);
      const selected = page.locator(`[data-category="${selectedId}"]`);
      await selected.tap();
      await expect(selected).toHaveAttribute('aria-pressed','true');
      await expect(page.locator('#amount-display')).toHaveText('850');
      assert.ok(await page.evaluate(()=>window.__haptics.length)>hapticsBefore,'Category selection should keep Telegram haptics');
      await page.screenshot({path:path.join(ARTIFACTS,`record-selected-${width}-${language}.png`)});
      await page.locator('.mascot-confirm').tap();
      await expect(page.locator('#amount-display')).toHaveText('0');
      await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses.length)).toBe(1);
      const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses[0]);
      assert.equal(saved.categoryId,selectedId);
      assert.equal(saved.amountMinor,850);

      // Editing a category changes the pill but never rewrites a past entry's snapshot.
      const snapshot = structuredClone(saved.category);
      await page.locator('#edit-categories').tap();
      await expect(page.locator('.editor-label')).toHaveCount(30);
      const stored = await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).settings.categories);
      const index = stored.findIndex(category => category.id===selectedId);
      await page.locator('.editor-label').nth(index).fill('Favorite place');
      await page.locator('#category-form button[type="submit"]').tap();
      await expect(page.locator(`[data-category="${selectedId}"]`)).toHaveAttribute('aria-label','Favorite place');
      const afterEdit = await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')));
      assert.equal(afterEdit.settings.categories.find(category=>category.id===selectedId).label,'Favorite place');
      assert.deepEqual(afterEdit.expenses[0].category,snapshot);

      const nav = await page.locator('.bottom-nav').boundingBox();
      const finish = await page.locator('.entry-actions').boundingBox();
      assert.ok(finish.y+finish.height<=nav.y+1,'Entry controls must stay clear of navigation');
      assert.deepEqual(errors,[]);
      results.push({width,height,language,selectedId,pillHeight:layout.boxes[0].height,checks:'single row, touch swipe, no accidental select/save, haptic, save, editing, historical snapshot'});
      await context.close();
    }
    fs.writeFileSync(path.join(ARTIFACTS,'category-pills-results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({ok:true,artifacts:ARTIFACTS,results},null,2));
  } finally {await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
