const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'outputs/popup-materials');

(async () => {
  const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')));
  const server = await createServer({configFile:false,root:ROOT,publicDir:false,logLevel:'error',server:{host:'127.0.0.1',port:0}});
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({headless:true});
  fs.mkdirSync(OUTPUT,{recursive:true});
  const errors = [], requests = new Set();
  let checks = 0;
  try {
    for (const [width,height,language] of [[320,568,'zh'],[390,844,'uk']]) {
      const context = await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.fulfill({body:''});
        if (url.pathname === '/api/config') return route.fulfill({json:{mode:'local'}});
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror',e=>errors.push(e.message));
      page.on('response',r=>{if(r.url().includes('popup-kit-v1') || r.url().includes('note-cash-bundle')) {requests.add(r.url());if(!r.ok())errors.push(`${r.status()} ${r.url()}`);}});
      await page.goto(base);
      await expect(page.locator('#keypad button').first()).toBeEnabled();
      await page.locator('#open-settings').tap();
      await page.locator('#language').selectOption(language);
      for (const theme of ['matcha','cheese','peach','sea']) {
        await page.locator('.theme-open').tap();
        await page.locator(`[data-theme-option="${theme}"]`).tap();
        await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
        await page.locator('.theme-open').tap();
        await page.locator('.theme-sheet').evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{}))));
        const box = await page.locator('.theme-sheet').boundingBox();
        assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=width && box.y+box.height<=height);
        assert.ok(await page.locator('.theme-card').evaluateAll(nodes=>nodes.every(n=>{
          const r=n.getBoundingClientRect();
          return r.width>=44&&r.height>=44&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===n;
        })), 'Theme decorations must not block any choice');
        await page.screenshot({path:path.join(OUTPUT,`${width}-${theme}-theme.png`)});
        await page.locator('.theme-sheet header button').tap();
        await page.locator('.bottom-nav [data-view="record"]').tap();
        await page.locator('[data-key="5"]').tap();
        await page.locator('[data-category="stomach"]').tap();
        await page.locator('#edit-note').tap();
        await page.locator('#note').fill(language==='zh'?'新宿午餐':'Обід у Сіндзюку');
        await page.locator('.note-sheet').evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{}))));
        await expect.poll(()=>page.locator('.note-submit img').evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
        await page.screenshot({path:path.join(OUTPUT,`${width}-${theme}-note.png`)});
        assert.ok(await page.locator('.note-submit').evaluate(n=>{
          const r=n.getBoundingClientRect();
          return r.width>=44&&r.height>=44&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===n;
        }), 'Cash must stay tappable through its paper surface');
        await page.locator('.note-sheet header button').tap();
        await expect(page.locator('.note-sheet')).toHaveCount(0);
        await page.locator('[data-key="clear"]').tap();
        await page.locator('#open-settings').tap();
        checks++;
      }
      await context.close();
    }
    assert.deepEqual(errors,[]);
    assert.ok([...requests].some(url=>url.includes('cloud-stamp-v1.webp')));
    assert.ok([...requests].some(url=>url.includes('soft-button-surface-v1.webp')));
    assert.ok([...requests].some(url=>url.includes('popup-paper-surface-v1.webp')));
    assert.ok(![...requests].some(url=>url.endsWith('.png')), 'Popup runtime uses lightweight derivatives');
    console.log(JSON.stringify({checks,surfaces:['note','theme'],errors,artifacts:OUTPUT}));
  } finally {await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
