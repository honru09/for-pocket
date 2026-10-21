const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { expect } = require('playwright/test');

// Run sequentially with other Vite browser suites. All records and analysis
// responses are isolated fixtures; this script never contacts a live service.
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'outputs/material-system');
const THEMES = ['matcha', 'cheese', 'peach', 'sea'];
const LANGUAGES = ['zh', 'en', 'uk'];
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const MATERIAL_PATHS = ['/pocket-materials-v2/', '/journal-surfaces-v2/'];
const isMaterialUrl = url => MATERIAL_PATHS.some(part => url.includes(part));
// Use the actual application's stylesheet order, including material layers
// added after this test was written. No second fixture-only visual theme.
const STYLE_IMPORTS = [...fs.readFileSync(path.join(ROOT, 'src/main.jsx'), 'utf8')
  .matchAll(/^import\s+(['"])([^'"]+\.css)\1;?\s*$/gm)]
  .map(([, , specifier]) => `import ${JSON.stringify(specifier.startsWith('./') ? '/src/' + specifier.slice(2) : specifier)};`).join('\n');
const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppRoot} from '@telegram-apps/telegram-ui';
${STYLE_IMPORTS}
import {Sheet} from '/src/AccountViews.jsx';
import NoteEntrySheet from '/src/NoteEntrySheet.jsx';
import AiImportPage from '/src/AiImportPage.jsx';
import {initialSettings} from '/public/shared.mjs';
import {translate} from '/public/i18n.mjs';
const query = new URLSearchParams(location.search);
const language = query.get('language') || 'en';
const theme = query.get('theme') || 'matcha';
document.documentElement.dataset.theme = theme;
document.documentElement.lang = language;
const settings = {...initialSettings(language), theme};
const person = {id:'u_material-fixture', name:'Fixture', color:'yellow', avatar:'cloud'};
settings.consumers = [person];
const profile = {user:person, ledgerId:'material-fixture', expenses:[]};
const t = (key, params) => translate(language, key, params);
window.__materialFixture = {closeCalls:0, actionCalls:0, parsed:0, saved:0, closedAt:null};
const service = {
  aiParseExpense:async () => {
    window.__materialFixture.parsed++;
    return {items:[{amount:850, currency:'JPY', categoryId:'stomach', consumer:person.id,
      merchant:'Fixture ramen', note:'Lunch', occurredAt:'2026-10-22T03:00:00Z', confidence:.95}]};
  },
  importExpenses:async entries => {window.__materialFixture.saved += entries.length; return {entries};},
};
function Harness() {
  const [open, setOpen] = useState(false);
  const close = () => {
    window.__materialFixture.closeCalls++;
    window.__materialFixture.closedAt = performance.now();
    setOpen(false);
  };
  if (query.get('surface') === 'import') return <AiImportPage t={t} settings={settings} profile={profile}
    isRemote service={service} run={fn=>fn()} onImported={()=>{}}/>;
  return <><button id="sheet-trigger" onClick={()=>setOpen(true)}>Open fixture</button>
    {open && (query.get('surface') === 'note'
      ? <NoteEntrySheet t={t} note="Fixture note" disabled={false} canSave={false} saveLabel="Save"
          onChange={()=>{}} onSubmit={()=>false} onClose={close}/>
      : <Sheet title="Fixture sheet" onClose={close}>
          <button id="sheet-action" onClick={()=>window.__materialFixture.actionCalls++}>Inside action</button>
        </Sheet>)}
  </>;
}
createRoot(document.getElementById('root')).render(<AppRoot className="for-root" appearance="light" platform="ios">
  <div className="app-shell"><Harness/></div>
</AppRoot>);
`;

async function assertImages(page, expectedNames = []) {
  for (const name of expectedNames) await expect(page.locator(`img[data-material="${name}"]`).first()).toBeAttached();
  const images = page.locator('img[data-material]');
  for (let index = 0; index < await images.count(); index++) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    assert.ok(await image.evaluate(node => /\.webp(?:\?|$)/.test(node.currentSrc)), 'Materials must load a WebP derivative');
    assert.ok(await image.evaluate(node => node.getAttribute('aria-hidden') === 'true' || node.getAttribute('alt') === ''),
      'Decorative materials must not duplicate control names');
  }
}

async function assertNoOverflow(page, label) {
  const viewportWidth = page.viewportSize().width;
  const geometry = await page.evaluate(() => ({
    width:innerWidth,
    document:document.documentElement.scrollWidth,
    body:document.body.scrollWidth,
    main:document.querySelector('main')?.getBoundingClientRect().toJSON(),
  }));
  assert.ok(geometry.document <= viewportWidth + 1 && geometry.body <= viewportWidth + 1 && geometry.width <= viewportWidth + 1,
    `${label}: horizontal page overflow ${JSON.stringify(geometry)}`);
  if (geometry.main) assert.ok(geometry.main.left >= -1 && geometry.main.right <= geometry.width + 1,
    `${label}: main content leaves the viewport`);
}

async function assertBackground(page, selector, filename) {
  const backgrounds = await page.locator(selector).evaluateAll(nodes => nodes.flatMap(node =>
    [null, '::before', '::after'].map(pseudo => getComputedStyle(node, pseudo).backgroundImage)));
  assert.ok(backgrounds.some(value => value.includes(filename)), `${selector}: expected ${filename} material`);
}

async function assertButtonHit(button, label) {
  await button.scrollIntoViewIfNeeded();
  const sample = () => button.evaluate(node => {
    const box = node.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const target = document.elementFromPoint(x, y);
    const describe = element => element ? {
      tag:element.tagName, id:element.id, className:element.getAttribute('class'),
      pointerEvents:getComputedStyle(element).pointerEvents,
    } : null;
    const ancestors = [];
    for (let current = node; current; current = current.parentElement) ancestors.push(current);
    return {
      hit:target?.closest('button') === node,
      box:box.toJSON(), center:{x,y}, viewport:{width:innerWidth,height:innerHeight,scrollY},
      button:describe(node), target:describe(target), targetButton:describe(target?.closest('button')),
      targetAncestors:[target?.parentElement,target?.parentElement?.parentElement].map(describe),
      animations:ancestors.flatMap(element => element.getAnimations().map(animation => ({
        owner:describe(element), name:animation.animationName || animation.transitionProperty || animation.id,
        state:animation.playState, currentTime:animation.currentTime,
        duration:animation.effect?.getComputedTiming().duration,
        iterations:animation.effect?.getComputedTiming().iterations,
      }))),
    };
  });
  const initial = await sample();
  if (initial.hit) return;
  const screenshotBase = path.join(OUTPUT, 'hit-diagnostic-' + label.replace(/[^a-z0-9_-]+/gi, '-'));
  await button.page().screenshot({path:screenshotBase + '-initial.png',fullPage:true});
  // A route's brief entrance can still be active after a lazy image decodes.
  // Wait only for observed finite animations on this target/its ancestors;
  // perpetual cloud motion is unrelated and must never stall this assertion.
  await button.evaluate(node => {
    const pending = [];
    for (let current = node; current; current = current.parentElement) {
      for (const animation of current.getAnimations()) {
        const timing = animation.effect?.getComputedTiming();
        if (['running','pending'].includes(animation.playState) && timing && Number.isFinite(timing.endTime)) {
          pending.push(animation.finished.catch(() => {}));
        }
      }
    }
    return Promise.all(pending);
  });
  const settled = await sample();
  if (settled.hit) {
    console.log(JSON.stringify({hitRecoveredAfterAnimation:label,initial,settled,screenshot:screenshotBase + '-initial.png'}));
    return;
  }
  await button.page().screenshot({path:screenshotBase + '-settled.png',fullPage:true});
  assert.ok(settled.hit, `${label}: material must not cover the button's hit target\n${JSON.stringify({initial,settled,screenshots:[screenshotBase + '-initial.png',screenshotBase + '-settled.png']},null,2)}`);
}

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.locator('main').evaluateAll(nodes => Promise.all(nodes.flatMap(node => node.getAnimations()
    .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map(animation => animation.finished.catch(() => {})))));
  await assertNoOverflow(page, name);
  await page.screenshot({path:path.join(OUTPUT, name + '.png'), fullPage:true});
}

(async () => {
  const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')));
  const server = await createServer({configFile:false, root:ROOT, publicDir:false, logLevel:'error',
    server:{host:'127.0.0.1', port:0, hmr:false, watch:null},
    plugins:[{name:'material-system-fixture',
      resolveId:id => id === '/__material-fixture.jsx' ? id : undefined,
      load:id => id === '/__material-fixture.jsx' ? fixture : undefined,
    }]});
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({headless:true});
  const errors = [], materialRequests = new Set(), results = [];
  fs.mkdirSync(OUTPUT, {recursive:true});
  const observe = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (isMaterialUrl(request.url())) materialRequests.add(request.url());
    });
    page.on('response', response => {
      if (isMaterialUrl(response.url()) && !response.ok()) errors.push(`${response.status()} ${response.url()}`);
    });
  };
  const isolate = async context => context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.fulfill({body:''});
    if (url.pathname === '/api/config') return route.fulfill({json:{mode:'local'}});
    if (url.pathname.startsWith('/api/')) return route.fulfill({status:503, json:{error:'Fixture blocks remote APIs'}});
    if (url.pathname === '/__material-fixture') return route.fulfill({contentType:'text/html', body:
      '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/__material-fixture.jsx"></script>'});
    return route.continue();
  });
  try {
    for (const language of LANGUAGES) for (const [width, height] of WIDTHS) {
      const context = await browser.newContext({viewport:{width,height}, isMobile:true, hasTouch:true});
      await isolate(context);
      const page = await context.newPage(); observe(page);
      await page.goto(base);
      await expect(page.locator('#keypad [data-key="8"]')).toBeEnabled();
      for (const digit of '850') await page.locator(`#keypad [data-key="${digit}"]`).tap();
      await page.locator('[data-category="stomach"]').tap();
      await page.locator('.mascot-confirm').tap();
      await expect(page.locator('#amount-display')).toHaveText('0');
      await page.locator('#open-settings').tap();
      await page.locator('#language').selectOption(language);
      for (const theme of THEMES) {
        const key = `${language}-${width}-${theme}`;
        await page.locator('.theme-open').tap();
        await page.locator(`[data-theme-option="${theme}"]`).tap();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('.theme-sheet')).toHaveCount(0);
        await assertImages(page, ['receipt-stack','calendar','reserve-envelope','ledger-book']);
        for (const material of ['receipt-stack','calendar','reserve-envelope','ledger-book']) {
          await assertButtonHit(page.locator(`.settings-row:has([data-material="${material}"])`), `${key}/${material}`);
        }
        await assertBackground(page, 'html, body, .for-root', 'journal-paper.webp');
        await capture(page, key + '-settings');

        await page.locator('.theme-open').tap();
        await assertBackground(page, '.theme-card', 'sheet-paper.webp');
        await assertBackground(page, '.theme-preview', 'journal-paper.webp');
        await assertButtonHit(page.locator('.theme-card').first(), key + '/theme');
        await page.locator('.theme-sheet header button').tap();
        await expect(page.locator('.theme-sheet')).toHaveCount(0);

        await page.locator('.bottom-nav [data-view="history"]').tap();
        await expect(page.locator('#history-view .expense-row')).toHaveCount(1);
        await assertBackground(page, '.history-summary', 'sheet-paper.webp');
        await assertImages(page);
        await capture(page, key + '-history');

        await page.locator('#open-settings').tap();
        await page.locator('.settings-profile').tap();
        await expect(page.locator('#profile-name')).toBeVisible();
        await capture(page, key + '-profile');

        await page.locator('#open-settings').tap();
        await page.locator('.settings-row:has([data-material="receipt-stack"])').tap();
        await expect(page.locator('#ai-import-text')).toBeVisible();
        await assertImages(page, ['receipt-stack']);
        await assertButtonHit(page.locator('.ai-import-file-button'), key + '/upload');
        let chooser;
        try {
          [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.ai-import-file-button').tap()]);
        } catch (error) {
          await capture(page, key + '-chooser-failed');
          console.error('Chooser failed:',key,await page.locator('.ai-import-file-button').evaluate(node=>({disabled:node.disabled,html:node.outerHTML,box:node.getBoundingClientRect().toJSON()})));
          throw error;
        }
        await chooser.setFiles({name:'fixture-receipt.txt', mimeType:'text/plain', buffer:Buffer.from('Lunch 850 JPY')});
        await expect(page.locator('.ai-import-preview')).toHaveCount(1);
        await assertImages(page, ['paperclip']);
        await capture(page, key + '-import');
        await page.locator('.ai-import-file-remove').tap();
        await expect(page.locator('.ai-import-preview')).toHaveCount(0);

        // Exercise the real importer component's result branch without a live
        // account/model. The service returns one deterministic receipt item.
        const parsed = await context.newPage(); observe(parsed);
        await parsed.goto(`${base}/__material-fixture?surface=import&language=${language}&theme=${theme}`);
        await parsed.locator('#ai-import-text').fill('Lunch 850 JPY');
        await parsed.locator('.ai-import-source button[type="submit"]').tap();
        await expect(parsed.locator('.ai-import-item')).toHaveCount(1);
        await assertImages(parsed, ['receipt-stack','ledger-book']);
        await expect(parsed.locator('.ai-import-results-header [data-material="ledger-book"]')).toBeVisible();
        assert.equal(await parsed.evaluate(() => window.__materialFixture.saved), 0, 'Parsing must not silently save a record');
        await capture(parsed, key + '-import-results');
        await parsed.close();
        await page.locator('#open-settings').tap();
        results.push({language,width,height,theme,surfaces:['settings','history','profile','import','import-results']});
      }
      await context.close();
    }

    // Pause only after the fixture is loaded/open. Advancing a controlled
    // browser clock makes the 159/160ms boundary independent of CI speed.
    for (const method of ['close','escape','backdrop','note']) {
      const context = await browser.newContext({viewport:{width:390,height:844}, hasTouch:true});
      await isolate(context);
      const page = await context.newPage(); observe(page);
      await page.clock.install({time:new Date('2026-10-22T00:00:00Z')});
      await page.goto(`${base}/__material-fixture?surface=${method === 'note' ? 'note' : 'sheet'}`);
      const trigger = page.locator('#sheet-trigger');
      await trigger.focus(); await trigger.click();
      const dialog = page.locator('dialog');
      await expect(dialog).toBeVisible();
      await dialog.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
      const closeBox = await dialog.locator('header button').boundingBox();
      const actionBox = method === 'note' ? null : await page.locator('#sheet-action').boundingBox();
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
      if (method === 'escape') await page.keyboard.press('Escape');
      else if (method === 'backdrop') await page.mouse.click(2, 2);
      else await page.mouse.click(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
      if (method === 'note') await expect(dialog).toHaveClass(/is-closing/);
      else await expect(dialog).toHaveAttribute('data-exiting', 'true');
      assert.equal(await page.evaluate(() => window.__materialFixture.closeCalls), 0, `${method}: close callback must wait for exit`);
      if (method !== 'note') {
        // A second close and an inner pointer click during exit cannot create
        // a second callback or activate an underlying/destructive action.
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        await page.mouse.click(actionBox.x + actionBox.width / 2, actionBox.y + actionBox.height / 2);
        assert.equal(await page.evaluate(() => window.__materialFixture.actionCalls), 0, 'Exiting sheet must reject pointer interaction');
      }
      await page.clock.runFor(159);
      await expect(dialog).toHaveCount(1);
      assert.equal(await page.evaluate(() => window.__materialFixture.closeCalls), 0, `${method}: still present at 159ms`);
      await page.clock.runFor(1);
      await expect(dialog).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.__materialFixture.closeCalls), 1, `${method}: exactly one close at 160ms`);
      if (method !== 'note') await expect(trigger).toBeFocused();
      await page.clock.runFor(400);
      assert.equal(await page.evaluate(() => window.__materialFixture.closeCalls), 1, 'No delayed duplicate close');
      results.push({sheetClose:method,exitMs:160,singleCallback:true});
      await context.close();
    }

    assert.deepEqual(errors, []);
    assert.ok(![...materialRequests].some(url => /\.png(?:\?|$)/i.test(url)), 'Runtime must not download material source PNGs');
    for (const name of ['journal-paper','sheet-paper','receipt-stack','calendar','reserve-envelope','ledger-book','paperclip','key-cap','pill-tab']) {
      assert.ok([...materialRequests].some(url => url.includes(`/${name}.webp`)), `Expected ${name} WebP request through real UI`);
    }
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({results,requests:[...materialRequests],errors}, null, 2));
    console.log(JSON.stringify({matrixCases:36,sheetExitCases:4,screenshots:180,errors,artifacts:OUTPUT}));
  } finally {await browser.close(); await server.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
