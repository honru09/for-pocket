const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Isolated local UI fixtures: no account, ledger server, or model requests.
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = fs.mkdtempSync(path.join(os.tmpdir(), 'for-pocket-state-assets-'));
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from '@telegram-apps/telegram-ui';
import '@telegram-apps/telegram-ui/dist/styles.css';
import '/src/styles.css';
import '/src/account-styles.css';
import '/src/pocket-layout.css';
import '/src/refinements.css';
import AiImportPage from '/src/AiImportPage.jsx';
import { initialSettings } from '/public/shared.mjs';
import { translate } from '/public/i18n.mjs';
const search = new URLSearchParams(location.search);
const lang = search.get('lang') || 'en', scenario = search.get('case');
const settings = initialSettings(lang);
settings.consumers = [{id:'fixture-user',name:'Test',color:'yellow',avatar:'cloud'}];
const profile = {user:settings.consumers[0],ledgerId:'fixture',expenses:[]};
window.__saved = 0;
const service = { aiParseExpense:async () => {
  if (scenario === 'failed') throw new Error('errorAiUnavailable');
  if (scenario === 'none') return {items:[]};
  return {items:[{amount:850,currency:'JPY',categoryId:'stomach',consumer:'fixture-user',merchant:'Lunch',occurredAt:'2026-10-14T03:00:00Z',confidence:scenario === 'partial' ? .4 : .95,needsReview:scenario === 'partial'}]};
}, importExpenses:async entries => {window.__saved += entries.length; return {entries};}};
createRoot(document.getElementById('root')).render(<AppRoot className="for-root" appearance="light" platform="ios"><div className="app-shell"><AiImportPage t={(key,params) => translate(lang,key,params)} profile={profile} settings={settings} service={service} isRemote run={fn=>fn()} onImported={()=>{}}/></div></AppRoot>);
`;

(async () => {
  const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')));
  const server = await createServer({configFile:false,root:ROOT,publicDir:false,logLevel:'error',server:{host:'127.0.0.1',port:0},
    plugins:[{name:'state-fixture',resolveId:id=>id === '/__state-fixture.jsx' ? id : undefined,load:id=>id === '/__state-fixture.jsx' ? fixture : undefined}]});
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({headless:true});
  const failures = [];
  try {
    for (const scenario of (process.env.UI_STATE_SCENARIO ? [process.env.UI_STATE_SCENARIO] : ['empty','failed','loading','retry'])) {
      const context = await browser.newContext({viewport:{width:320,height:568},hasTouch:true,locale:'en'});
      let releaseConfig;
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.fulfill({body:''});
        if (url.pathname === '/api/config') {
          if (scenario === 'loading') await new Promise(resolve=>{releaseConfig = resolve;});
          return route.fulfill({status:scenario === 'failed' ? 500 : 200,contentType:'application/json',body:JSON.stringify({mode:'local'})});
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', e=>failures.push(e.message));
      const requested = [];
      page.on('request', request=>{ if (request.resourceType() === 'image') requested.push(request.url()); });
      await page.goto(base);
      if (['empty','retry'].includes(scenario)) await expect(page.locator('#keypad button').first()).toBeEnabled();
      assert.ok(!requested.some(url=>url.includes('/illustrations/')), 'Record page must not fetch state illustrations');
      await page.locator('button[data-view="history"]').click();
      await expect(page.locator('.ledger-empty-state')).toHaveAttribute('data-state',scenario === 'failed' ? 'error' : scenario === 'loading' ? 'loading' : 'empty');
      if (scenario === 'retry') {
        await page.evaluate(() => {
          const read = Storage.prototype.getItem;
          window.__previewReads = {fail:true,success:0,failed:0};
          Storage.prototype.getItem = function (key) {
            if (key === 'for-pocket.preview.v1') {
              if (window.__previewReads.fail) { window.__previewReads.failed++; throw new Error('Isolated test read failure'); }
              window.__previewReads.success++;
            }
            return read.call(this,key);
          };
          window.dispatchEvent(new Event('focus'));
        });
        const state = page.locator('.ledger-empty-state');
        await expect(state).toHaveAttribute('data-state','error');
        const failedReads = await page.evaluate(()=>window.__previewReads.failed);
        await state.locator('button').click();
        await expect.poll(()=>page.evaluate(()=>window.__previewReads.failed)).toBeGreaterThan(failedReads);
        await expect(state).toHaveAttribute('data-state','error');
        await page.evaluate(()=>{window.__previewReads.fail = false;});
        await state.locator('button').click();
        await expect.poll(()=>page.evaluate(()=>window.__previewReads.success)).toBeGreaterThan(0);
        await expect(state).toHaveAttribute('data-state','empty');
        await expect(page.locator('#storage-status')).toHaveText('Saved in this browser only');
        await page.evaluate(()=>{window.__previewReads.fail = true; window.dispatchEvent(new Event('focus'));});
        await expect(state).toHaveAttribute('data-state','error');
      } else if (scenario === 'empty') {
        const image = page.locator('[data-illustration="empty-ledger"]');
        await expect(image).toBeVisible();
        await expect.poll(()=>image.evaluate(node=>node.complete && node.naturalWidth > 0)).toBe(true);
        const actionBox = await page.locator('.ledger-empty-state button').boundingBox();
        const navBox = await page.locator('.bottom-nav').boundingBox();
        assert.ok(actionBox.y + actionBox.height <= navBox.y, 'Empty-state action should stay above mobile navigation');
        await page.screenshot({path:path.join(ARTIFACTS,'empty-ledger-320.png'),fullPage:true});
        await page.setViewportSize({width:320,height:480});
        await expect.poll(async ()=>(await page.locator('.bottom-nav').boundingBox()).y).toBeLessThan(440);
        const ledgerTab = await page.locator('button[data-view="history"]').boundingBox();
        const navHit = await page.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest('.bottom-nav')), {x:ledgerTab.x + ledgerTab.width / 2,y:ledgerTab.y + ledgerTab.height - 2});
        assert.ok(navHit, 'Empty-state action must not cover the bottom navigation on short screens');
        await page.setViewportSize({width:320,height:568});
        await page.locator('#history-category').selectOption('expense:stomach');
        await expect(page.locator('.ledger-empty-state')).toHaveAttribute('data-state','filtered');
        await expect(page.locator('.pocket-illustration')).toHaveCount(0);
        await expect(page.locator('.ledger-empty-state')).toContainText('No matching entries');
      } else {
        await expect(page.locator('.pocket-illustration')).toHaveCount(0);
      }
      if (releaseConfig) releaseConfig();
      await context.close();
    }
    for (const lang of (process.env.UI_STATE_SCENARIO ? [] : ['zh','en','uk'])) for (const scenario of ['clean','partial','failed','none']) {
      const page = await browser.newPage({viewport:{width:320,height:568},hasTouch:true});
      page.on('pageerror', e=>failures.push(e.message));
      await page.route('**/__state-fixture?*', route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/__state-fixture.jsx"></script>'}));
      await page.goto(`${base}/__state-fixture?lang=${lang}&case=${scenario}`);
      await page.locator('#ai-import-text').fill('Lunch 850');
      await expect(page.locator('.pocket-illustration')).toHaveCount(0);
      await page.locator('.ai-import-source button[type="submit"]').click();
      if (['clean','partial'].includes(scenario)) {
        const image = page.locator(`[data-illustration="${scenario === 'partial' ? 'partial-import' : 'import-review'}"]`);
        await expect(image).toBeVisible();
        await expect.poll(()=>image.evaluate(node=>node.complete && node.naturalWidth > 0)).toBe(true);
        assert.equal(await page.evaluate(()=>window.__saved),0, 'Review illustration is not a saved record');
        await page.locator('.ai-import-results').scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),`${lang}/${scenario}: no horizontal overflow`);
        if (lang === 'uk') await page.screenshot({path:path.join(ARTIFACTS,`${scenario}-uk-320.png`),fullPage:true});
      } else {
        await expect(page.locator('.ai-import-status.is-error')).toBeVisible();
        await expect(page.locator('.pocket-illustration')).toHaveCount(0);
      }
      await page.close();
    }
    assert.deepEqual(failures,[]);
    console.log(`PASS: ${process.env.UI_STATE_SCENARIO || 'ledger loading/error/filter/empty/retry states (en); import review and partial states (zh/en/uk); lazy images and 320px overflow'}; ${ARTIFACTS}`);
  } finally { await browser.close(); await server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
