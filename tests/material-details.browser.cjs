const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const {expect} = require('playwright/test');
const ROOT = path.resolve(__dirname, '..'), OUTPUT = path.join(ROOT, 'outputs/material-details');

// Real src/main.jsx and isolated local storage. Run serially with other Vite suites.
(async () => {
  const {createServer} = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')));
  const server = await createServer({configFile:false, root:ROOT, publicDir:false, logLevel:'error', server:{host:'127.0.0.1',port:0}});
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`, browser = await chromium.launch({headless:true});
  const errors = [], results = [];
  fs.mkdirSync(OUTPUT, {recursive:true});
  const material = async (locator, name) => {
    await expect(locator).toBeVisible();
    const info = await locator.evaluate(async (node, filename) => {
      const background = getComputedStyle(node).backgroundImage;
      const urls = [...background.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match => match[1]);
      const url = urls.find(value => value.includes(filename));
      if (!url) return {background, decoded:false};
      const image = new Image(); image.src = url;
      await Promise.race([image.decode(), new Promise((_, reject) => setTimeout(() => reject(Error('Material decode timed out')), 5000))]);
      return {background, decoded:image.naturalWidth > 0};
    }, name);
    assert.ok(info.background.includes(name) && info.decoded, `${name} must be painted and decoded: ${JSON.stringify(info)}`);
  };
  try {
    for (const [width,height] of [[390,844],[320,568]]) {
      const context = await browser.newContext({viewport:{width,height}, hasTouch:true, locale:'en-US', timezoneId:'Asia/Tokyo'});
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.fulfill({contentType:'application/javascript',body:''});
        if (url.pathname === '/api/config') return route.fulfill({json:{mode:'local'}});
        if (url.pathname.startsWith('/api/')) return route.fulfill({status:503,json:{error:'Isolated local test'}});
        return route.continue();
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({time:new Date('2026-10-22T03:00:00Z')});
      await page.goto(base); await expect(page.locator('#keypad [data-key="5"]')).toBeEnabled();
      await material(page.locator('#keypad [data-key="5"] .key-cap'), 'key-cap.webp');
      await material(page.locator('.bottom-nav .view-tabs > div > div[aria-hidden="true"]'), 'pill-tab.webp');
      // Wait only finite entrance effects; the cloud's idle loop must not hold the test open.
      await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => {
        const timing = animation.effect?.getComputedTiming(); return timing && Number.isFinite(timing.endTime) && timing.endTime <= 1000;
      }).map(animation => animation.finished.catch(() => {}))));
      await page.screenshot({path:path.join(OUTPUT, `home-${width}x${height}.png`)});
      results.push({viewport:[width,height],keyCap:true,selectedTab:true});
      if (width === 390) {
        for (const digit of '850') await page.locator(`#keypad [data-key="${digit}"]`).click();
        await page.locator('[data-category="stomach"]').click(); await page.locator('.mascot-confirm').click();
        await expect(page.locator('#amount-display')).toHaveText('0');
        await page.locator('.bottom-nav [data-view="history"]').click();
        const row = page.locator('.swipe-expense').first(), surface = row.locator('.swipe-expense-surface');
        await expect(row).toBeVisible(); const box = await row.boundingBox(), y = box.y + box.height / 2;
        await page.mouse.move(box.x+30,y); await page.mouse.down(); await page.mouse.move(box.x+195,y,{steps:8}); await page.mouse.up();
        await expect(row).toHaveAttribute('data-offset','216');
        await surface.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
        await page.mouse.move(box.x+box.width-24,y); await page.mouse.down();
        await page.mouse.move(box.x+box.width-209,y,{steps:8}); await page.mouse.up();
        await expect(row).toHaveAttribute('data-offset','0');
        const painted = await surface.evaluate(node => {
          const transition = node.getAnimations().find(animation => animation instanceof CSSTransition && animation.transitionProperty === 'transform');
          if (!transition) throw Error('Expected the real closing transform transition');
          transition.pause(); transition.currentTime = 30;
          return new DOMMatrixReadOnly(getComputedStyle(node).transform).m41;
        });
        assert.ok(painted > 12 && painted < 216, `Closing frame must be intermediate, got ${painted}`);
        const grip = Math.min(box.x+box.width-24, box.x+painted+35);
        await page.mouse.move(grip,y); await page.mouse.down(); await page.mouse.move(grip+24,y,{steps:2});
        const expected = Math.min(216,painted+24);
        await expect.poll(async () => Number(await row.getAttribute('data-offset'))).toBeCloseTo(expected, 1);
        assert.ok(Math.abs(await surface.evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41)-expected)<1,
          'Re-grabbing must follow the painted offset + drag delta, not the closing target');
        await page.mouse.up(); results.push({regrabPainted:painted,regrabExpected:expected});

        await page.locator('#open-settings').click(); const trigger = page.locator('.theme-open');
        await trigger.focus(); await trigger.click(); const sheet = page.locator('.theme-sheet'); await expect(sheet).toBeVisible();
        await page.clock.pauseAt(await page.evaluate(() => Date.now()+60_000));
        const before = await sheet.evaluate(node => {
          const entry = node.getAnimations().find(animation => animation instanceof CSSAnimation);
          if (!entry) throw Error('Expected the real sheet entrance animation');
          entry.pause(); entry.currentTime=30;
          new MutationObserver((_,observer) => {
            if (node.dataset.exiting !== 'true') return;
            const exit=node.getAnimations().find(animation => !(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition));
            if (exit) { exit.pause(); exit.currentTime=0; } observer.disconnect();
          }).observe(node,{attributes:true,attributeFilter:['data-exiting']});
          const style=getComputedStyle(node); return {opacity:Number(style.opacity),matrix:Array.from(new DOMMatrixReadOnly(style.transform).toFloat64Array())};
        });
        assert.ok(before.opacity>0 && before.opacity<.99, 'Close must interrupt entrance, not a settled dialog');
        await page.keyboard.press('Escape'); await expect(sheet).toHaveAttribute('data-exiting','true');
        const after=await sheet.evaluate(node => { const style=getComputedStyle(node); return {opacity:Number(style.opacity),matrix:Array.from(new DOMMatrixReadOnly(style.transform).toFloat64Array())}; });
        assert.ok(Math.abs(after.opacity-before.opacity)<.02, `Close opacity jumped: ${before.opacity} -> ${after.opacity}`);
        assert.ok(after.matrix.every((value,index)=>Math.abs(value-before.matrix[index])<.05), 'Close transform jumped from the painted entrance frame');
        await page.clock.runFor(159); await expect(sheet).toHaveCount(1);
        await page.clock.runFor(1); await expect(sheet).toHaveCount(0); await expect(trigger).toBeFocused();
        results.push({earlyCloseOpacity:before.opacity,exitMs:160,focusRestored:true});
      }
      await context.close();
    }
    assert.deepEqual(errors,[]); fs.writeFileSync(path.join(OUTPUT,'results.json'),JSON.stringify({results,errors},null,2));
    console.log(JSON.stringify({results,errors,artifacts:OUTPUT}));
  } finally { await browser.close(); await server.close(); }
})().catch(error => {console.error(error); process.exitCode=1;});
