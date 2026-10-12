const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = fs.mkdtempSync(path.join(os.tmpdir(), 'for-pocket-location-'));

(async () => {
  const { createServer } = await import(pathToFileURL(`${ROOT}/node_modules/vite/dist/node/index.js`));
  const server = await createServer({ configFile:false, root:ROOT, publicDir:false, logLevel:'error', server:{host:'127.0.0.1',port:0} });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({ headless:true });
  const results = [];
  try {
    for (const [width,height] of [[320,568],[390,844],[1280,900]]) {
      const context = await browser.newContext({ viewport:{width,height}, isMobile:width<600, hasTouch:true, locale:'en-US', timezoneId:'Asia/Tokyo' });
      let resolveNext, release, reverseCalls = 0;
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.fulfill({contentType:'application/javascript',body:''});
        if (url.pathname === '/api/config') return route.fulfill({json:{mode:'local'}});
        if (url.pathname === '/api/location/reverse') {
          reverseCalls++;
          const location = { ...route.request().postDataJSON().location, name:'Ramen', area:'Shinjuku', address:'Shinjuku · Tokyo', countryCode:'JP' };
          if (resolveNext) { const next=resolveNext; resolveNext=null; await new Promise(resolve=>{release=resolve;}); Object.assign(location,next); }
          return route.fulfill({json:{location}});
        }
        return route.continue();
      });
      await context.addInitScript(() => {
        window.Telegram={WebApp:{platform:'ios',initData:'',initDataUnsafe:{user:{language_code:'en'}},ready(){},expand(){},isVersionAtLeast(){return false;},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}};
        window.__geoCalls=0;
        Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}});
        Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(done){window.__geoCalls++;done({coords:{latitude:35.69,longitude:139.70,accuracy:12}});},watchPosition(){throw Error('Background tracking is forbidden');}}});
      });
      const page=await context.newPage(), errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base);
      await expect(page.locator('#keypad button').first()).toBeEnabled();
      assert.equal(await page.evaluate(()=>window.__geoCalls),0,'Opening app must not request unapproved location');
      await page.locator('#entry-location').click();
      await page.getByRole('button',{name:'Use current location',exact:true}).click();
      await expect(page.locator('.location-preview')).toContainText('Shinjuku');
      await page.locator('dialog header button').click();
      for(const digit of '850') await page.locator(`[data-key="${digit}"]`).click();
      await page.locator('[data-category="stomach"]').click();
      await page.locator('.mascot-confirm').click();
      await expect(page.locator('#amount-display')).toHaveText('0');
      await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses.length)).toBe(1);
      const entry=await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses[0]);
      assert.equal(entry.location.area,'Shinjuku');
      assert.equal(entry.amountMinor,850);
      assert.equal(entry.currency,'JPY');

      for(const digit of '180') await page.locator(`[data-key="${digit}"]`).click();
      await page.locator('[data-category="learning"]').click();
      await page.locator('.mascot-confirm').click();
      await expect(page.locator('#amount-display')).toHaveText('0');
      await page.locator('.view-tabs [data-view="history"]').click();
      await expect(page.locator('.expense-row')).toHaveCount(2);
      await page.locator('#history-category').selectOption('expense:stomach');
      await expect(page.locator('.expense-row')).toHaveCount(1);
      await expect(page.locator('.expense-location')).toContainText('Shinjuku');
      await page.locator('.footprints summary').click();
      await expect(page.locator('.footprints li')).toContainText('1 entry');
      await page.screenshot({path:path.join(ARTIFACTS,`ledger-${width}.png`),fullPage:true});
      await page.locator('#history-category').selectOption('all');
      await expect(page.locator('.expense-row')).toHaveCount(2);
      await page.locator('.view-tabs [data-view="record"]').click();
      if(width<600) assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight <= innerHeight+1),'record screen fits mobile');
      const nav=await page.locator('.bottom-nav').boundingBox();
      const finish=await page.locator('.entry-actions').boundingBox();
      assert.ok(finish.y+finish.height<=nav.y+1,'location controls do not overlap bottom nav');
      await page.screenshot({path:path.join(ARTIFACTS,`record-${width}.png`),fullPage:true});

      // A delayed foreign-country result must preserve a manual currency choice.
      resolveNext={name:'Coffee',area:'Seattle',countryCode:'US'};
      await page.locator('#entry-location').click();
      await page.getByRole('button',{name:/^(Refresh place|Use current location)$/}).click();
      await expect.poll(()=>Boolean(release)).toBe(true);
      await page.locator('dialog header button').click();
      await page.locator('#currency').selectOption('CNY');
      release();release=null;
      await expect(page.locator('#entry-location')).toHaveAttribute('title','Seattle · Coffee');
      await expect(page.locator('#currency')).toHaveValue('CNY');

      // Saving before reverse lookup finishes must not transfer the place to the next entry.
      resolveNext={name:'Late place',area:'Late area',countryCode:'US'};
      await page.locator('#entry-location').click();
      await page.getByRole('button',{name:'Refresh place',exact:true}).click();
      await expect.poll(()=>Boolean(release)).toBe(true);
      await page.locator('dialog header button').click();
      for(const digit of '30') await page.locator(`[data-key="${digit}"]`).click();
      await page.locator('[data-category="stomach"]').click();
      await page.locator('.mascot-confirm').click();
      await expect(page.locator('#amount-display')).toHaveText('0');
      release();release=null;
      // Location opt-in persists and the next draft keeps the latest place
      // while a fresh foreground lookup is in flight.
      await expect(page.locator('#entry-location')).toHaveAttribute('aria-pressed','true');
      // The foreground refresh may already have completed with the current
      // place. The delayed result from the previous draft must never leak
      // into this new entry.
      await expect(page.locator('#entry-location')).not.toHaveAttribute('title','Late area · Late place');
      await page.locator('#entry-location').click();
      await page.getByRole('button',{name:'Turn off',exact:true}).click();
      await page.locator('dialog header button').click();
      const calls=await page.evaluate(()=>window.__geoCalls);
      await page.locator('[data-key="2"]').click();
      await expect(page.locator('#entry-location')).toHaveAttribute('aria-pressed','false');
      assert.equal(await page.evaluate(()=>window.__geoCalls),calls);
      assert.deepEqual(errors,[]);
      results.push({width,height,reverseCalls,checks:'opt-in, roundtrip, category filter, footprint, compact layout, manual currency, stale result, disable'});
      await context.close();
    }
    console.log(JSON.stringify({ok:true,artifacts:ARTIFACTS,results},null,2));
  } finally {await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
