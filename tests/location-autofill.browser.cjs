const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..');

// Exercises the real recording flow with a deliberately delayed geocoder.
// Run with Playwright installed or available through NODE_PATH.
(async () => {
  const { createServer } = await import(pathToFileURL(`${ROOT}/node_modules/vite/dist/node/index.js`));
  const { initialSettings, dateKey } = await import(pathToFileURL(`${ROOT}/public/shared.mjs`));
  const server = await createServer({ configFile:false, root:ROOT, publicDir:false, logLevel:'error', server:{ host:'127.0.0.1', port:0 } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({ headless:true });
  const failures = [];
  try {
    for (const scenario of ['coordinates-only', 'save-during-lookup', 'save-during-gps', 'backdated']) {
      const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, locale:'en-US', timezoneId:'Asia/Tokyo' });
      try {
        const settings = initialSettings('en'), now = new Date().toISOString();
        const user = { id:'u_local', name:'Me', avatar:'cloud', color:'yellow' };
        const entry = { id:'raw-coordinate-entry', categoryId:'stomach', category:settings.categories.find(c=>c.id==='stomach'), consumer:user.id, member:user, currency:'JPY', amountMinor:850, type:'expense', createdAt:now, occurredAt:now, dayKey:dateKey(new Date(now),'Asia/Tokyo'), timezone:'Asia/Tokyo', location:{lat:35.69,lng:139.7} };
        let release, reverseCalls = 0;
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (url.origin !== base) return route.fulfill({ contentType:'application/javascript', body:'' });
          if (url.pathname === '/api/config') return route.fulfill({ json:{mode:'local'} });
          if (url.pathname === '/api/location/reverse') {
            const sequence = ++reverseCalls;
            if (sequence === 1) await new Promise(resolve=>{release=resolve;});
            return route.fulfill({ json:{location:{...route.request().postDataJSON().location, area:sequence===1?'Shinjuku':'Shibuya', countryCode:'JP'}} });
          }
          return route.continue();
        });
        await context.addInitScript(({settings,user,entry,scenario}) => {
          if (!localStorage.getItem('for-pocket.preview.v1')) localStorage.setItem('for-pocket.preview.v1',JSON.stringify({settings,user,expenses:scenario==='coordinates-only'?[entry]:[]}));
          if (scenario !== 'coordinates-only') localStorage.setItem('for-pocket.location.u_local:local','on');
          window.Telegram={WebApp:{platform:'ios',initData:'',initDataUnsafe:{user:{language_code:'en'}},ready(){},expand(){},isVersionAtLeast(){return false;},onEvent(){},offEvent(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}};
          window.__geoCalls=0;
          window.__geoPermission='granted';
          Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:window.__geoPermission})}});
          Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(done){window.__geoCalls++;const complete=()=>done({coords:{latitude:35.69,longitude:139.7,accuracy:12}});if(scenario==='save-during-gps'&&window.__geoCalls===1)window.__releaseGeo=complete;else complete();},watchPosition(){throw Error('Background location tracking is forbidden');}}});
        },{settings,user,entry,scenario});
        const page = await context.newPage();
        await page.goto(base);
        await expect(page.locator('#keypad button').first()).toBeEnabled();
        if (scenario === 'coordinates-only') {
          await page.locator('.view-tabs [data-view="history"]').tap();
          await expect(page.locator('.expense-row')).toHaveCount(1);
          await expect(page.locator('.expense-location')).toHaveCount(0);
          await expect(page.locator('.expense-description')).toHaveCount(0);
        } else {
          if (scenario === 'save-during-gps') await expect.poll(()=>page.evaluate(()=>typeof window.__releaseGeo)).toBe('function');
          else await expect.poll(()=>Boolean(release)).toBe(true);
          if (scenario === 'backdated') {
            await page.locator('#edit-draft-time').tap();
            const day = new Date(Date.now()-86400000).toISOString().slice(0,10);
            await page.locator('#entry-time-input').fill(`${day}T12:00`);
            await page.locator('.time-form button[type="submit"]').tap();
          } else {
            await page.locator('#entry-location').tap();
            await expect(page.locator('.location-preview')).toHaveCount(0);
            await page.locator('dialog header button').tap();
          }
          for (const digit of '850') await page.locator(`[data-key="${digit}"]`).tap();
          await page.locator('[data-category="stomach"]').tap();
          await page.locator('.mascot-confirm').tap();
          await expect(page.locator('#amount-display')).toHaveText('0');
          if (scenario === 'save-during-gps') {
            await page.evaluate(()=>window.__releaseGeo());
            await expect.poll(()=>Boolean(release)).toBe(true);
          }
          release();
          if (scenario === 'backdated') {
            await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses.length)).toBe(1);
            assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses[0].location),undefined,'current GPS must never attach to a backdated entry');
          } else await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses[0]?.location?.area)).toBe('Shinjuku');
          await expect(page.locator('#entry-location')).toHaveAttribute('title','Shibuya');
          if (scenario !== 'save-during-gps') assert.ok(await page.evaluate(()=>window.__geoCalls)>=2,'the next entry automatically refreshes its own location');
          if (scenario === 'save-during-lookup') {
            const calls = reverseCalls;
            await page.reload();
            await expect.poll(()=>reverseCalls).toBeGreaterThan(calls);
            await expect(page.locator('#entry-location')).toHaveAttribute('title','Shibuya');
            await page.evaluate(()=>{window.__geoPermission='denied';window.dispatchEvent(new Event('focus'));});
            await expect(page.locator('#entry-location')).toHaveAttribute('aria-pressed','false');
            await page.locator('[data-key="2"]').tap();
            assert.equal(await page.evaluate(()=>window.__geoCalls),1,'revoked permission must not silently reuse stale cached GPS');
          }
        }
        console.log(`PASS ${scenario}`);
      } catch (error) { failures.push(`${scenario}: ${error.message}`); }
      finally { await context.close(); }
    }
    assert.deepEqual(failures,[]);
  } finally { await browser.close(); await server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
