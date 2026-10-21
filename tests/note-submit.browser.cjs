const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { expect } = require('playwright/test');

// Use the production app, keeping the layout viewport tall while the soft
// keyboard shrinks/pans the visible area (as on iOS / Telegram WebViews).
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(ROOT, 'outputs/note-submit');

(async () => {
  const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')));
  const server = await createServer({configFile:false, root:ROOT, publicDir:false,
    logLevel:'error', server:{host:'127.0.0.1', port:0}});
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({headless:true});
  const results = [];
  fs.mkdirSync(ARTIFACTS, {recursive:true});
  try {
    for (const [width, height, language] of [[320,568,'zh'],[390,844,'en'],[390,844,'uk']]) {
      const context = await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.fulfill({body:''});
        if (url.pathname === '/api/config') return route.fulfill({json:{mode:'local'}});
        return route.continue();
      });
      await context.addInitScript(({height,language}) => {
        const viewport = new EventTarget();
        Object.assign(viewport,{height,width:innerWidth,offsetTop:0,offsetLeft:0,scale:1});
        Object.defineProperty(window, 'visualViewport', {configurable:true,value:viewport});
        window.__setVisibleArea = (height, offsetTop = 0) => {
          viewport.height = height; viewport.offsetTop = offsetTop;
          viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll'));
        };
        window.Telegram = {WebApp:{platform:'ios',initData:'',initDataUnsafe:{user:{language_code:language}},
          ready(){},expand(){},isVersionAtLeast(){return false;},onEvent(){},offEvent(){},
          BackButton:{show(){},hide(){},onClick(){},offClick(){}}}};
      }, {height,language});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      const key = value => page.locator(`#keypad [data-key="${value}"]`);
      await expect(key('5')).toBeEnabled();
      await page.locator('#edit-note').click();
      await expect(page.locator('.note-submit')).toBeDisabled();
      await page.locator('#note').fill('Draft note');
      await page.locator('.pocket-sheet header button').click();
      for (const value of '850') await key(value).click();
      await page.locator('[data-category="stomach"]').click();
      await page.locator('#edit-note').click();
      await expect(page.locator('#note')).toHaveValue('Draft note');
      await page.locator('#note').fill(`Lunch · ${language}`);
      await page.locator('#note').dispatchEvent('compositionstart');
      await page.keyboard.press('Enter');
      await expect(page.locator('#note')).toBeVisible();
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses.length),0);
      await page.locator('#note').dispatchEvent('compositionend');
      await expect.poll(() => page.locator('.note-submit img').evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
      for (const [visibleHeight, offset] of [[300,0],[300,55],[height,0]]) {
        await page.evaluate(([h,offset]) => window.__setVisibleArea(h,offset), [visibleHeight,offset]);
        await page.locator('.pocket-sheet').evaluate(node => Promise.all(node.getAnimations().map(a=>a.finished.catch(()=>{}))));
        const geometry = await page.locator('.note-submit').evaluate(node => {
          const box = node.getBoundingClientRect(), viewport = window.visualViewport;
          return {top:box.top,bottom:box.bottom,width:box.width,height:box.height,
            visibleTop:viewport.offsetTop,visibleBottom:viewport.offsetTop+viewport.height,
            hit:document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('button')===node};
        });
        await page.screenshot({path:path.join(ARTIFACTS,`${language}-${visibleHeight}-${offset}.png`)});
        assert.ok(geometry.top >= geometry.visibleTop && geometry.bottom <= geometry.visibleBottom,
          `${language}: note submit obscured by soft keyboard: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.height>=44 && geometry.hit, `${language}: note submit must remain tappable`);
        results.push({language,visibleHeight,offset,...geometry});
      }
      // Submit while the software keyboard is open; its dismiss/restore must
      // not be a prerequisite to saving or change the note we write.
      await page.evaluate(() => window.__setVisibleArea(300));
      await expect(page.locator('.note-submit')).toBeEnabled();
      // Two immediate activations cannot write twice, including the fade-out.
      await page.locator('.note-submit').evaluate(node => {node.click();node.click();});
      await expect(page.locator('.note-sheet')).toHaveClass(/is-closing/);
      assert.equal(await page.locator('.note-sheet').evaluate(node=>getComputedStyle(node).animationName),'note-fade-out');
      await expect(page.locator('.pocket-sheet')).toHaveCount(0);
      await expect(page.locator('#amount-display')).toHaveText('0');
      await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses.length)).toBe(1);
      const expense = await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses[0]);
      assert.equal(expense.note,`Lunch · ${language}`);
      assert.equal(expense.amountMinor,850);
      await expect(page.locator('.mascot-stack')).toHaveAttribute('data-cash','expense');
      await expect(page.locator('.money-celebration')).toHaveAttribute('data-received','true');
      await expect(page.locator('.note-cash-flight')).toHaveCount(0);
      await expect(page.locator('.cloud-expense-tears')).toHaveCount(1);
      await page.evaluate(() => window.__setVisibleArea(innerHeight));
      await page.locator('.type-pill-btn').nth(1).click();
      await key('5').click();
      await page.locator('[data-category]').first().click();
      await page.locator('#edit-note').click();
      await page.locator('#note').fill('Income');
      await page.locator('.note-submit').tap();
      await expect(page.locator('.mascot-stack')).toHaveAttribute('data-cash','income');
      await expect(page.locator('.money-celebration')).toHaveAttribute('data-received','true');
      assert.equal(await page.locator('.money-bundle-flight').evaluate(node=>getComputedStyle(node).animationName),'money-received');
      await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses.length)).toBe(2);
      if (language === 'en') {
        await expect(page.locator('.mascot-stack')).not.toHaveAttribute('data-cash', /.+/);
        for (let i=0;i<6;i++) await page.locator('.mascot-toy').tap();
        await expect(page.locator('.mascot-toy')).toHaveAttribute('data-phase','sign');
        await key('8').click(); await page.locator('[data-category]').first().click();
        await page.locator('#edit-note').click(); await page.locator('.note-submit').tap();
        await expect(page.locator('.mascot-stack')).toHaveAttribute('data-cash','income');
        await expect(page.locator('.mascot-toy')).toHaveAttribute('data-phase','cloud');
        await key('9').click();
        await expect(page.locator('#amount-display')).toHaveText('9');
        await page.locator('[data-category]').first().click();
        await expect(page.locator('#amount-display')).toHaveText('9');
        await page.locator('#edit-note').click(); await page.locator('.note-submit').tap();
        await expect(page.locator('.pocket-sheet')).toHaveCount(0);
        await page.locator('.bottom-nav [data-view="history"]').tap();
        await page.locator('.bottom-nav [data-view="record"]').tap();
        await expect(page.locator('.note-cash-flight')).toHaveCount(0);
        await page.waitForTimeout(800);
        await expect(page.locator('.money-celebration')).toHaveCount(0);
      }
      assert.deepEqual(errors,[]);
      await context.close();
    }
    fs.writeFileSync(path.join(ARTIFACTS,'results.json'),JSON.stringify(results,null,2));
    console.log(`PASS note submission: 3 languages, ${results.length} visible viewport cases, draft preservation and one-tap saves`);
  } finally { await browser.close(); await server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
