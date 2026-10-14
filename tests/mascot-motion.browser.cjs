const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { randomInt } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Optional browser regression, alongside confirm-touch.browser.cjs.
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(ROOT, 'outputs/mascot-motion');
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from '@telegram-apps/telegram-ui';
import '@telegram-apps/telegram-ui/dist/styles.css';
import '/src/styles.css';
import '/src/mascot.css';
import PocketMascot from '/src/PocketMascot.jsx';
function Fixture() {
  const [celebrate, setCelebrate] = useState(null), [environment, setEnvironment] = useState(null), [shown, setShown] = useState(true);
  return <AppRoot className="for-root" platform="ios" appearance="light">
    <div className="amount-stage" style={{height:360, width:360, margin:12}}>
      {shown && <PocketMascot t={key => key} environment={environment} canConfirm celebrate={celebrate} onConfirm={() => setCelebrate({id:Date.now(),type:'expense'})}/>}
    </div>
    <button id="income" onClick={() => setCelebrate({id:Date.now(),type:'income'})}>income</button>
    <button id="weather" onClick={() => setEnvironment(environment === 'night' ? 'storm' : 'night')}>weather</button>
    <button id="mount" onClick={() => setShown(!shown)}>mount</button>
  </AppRoot>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;

(async () => {
  fs.mkdirSync(ARTIFACTS, {recursive:true});
  const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')));
  const server = await createServer({configFile:false,root:ROOT,publicDir:false,logLevel:'error',
    server:{host:'127.0.0.1',port:randomInt(20000,60000)},
    plugins:[{name:'mascot-fixture',resolveId:id => id === '/__mascot-fixture.jsx' ? id : undefined,
      load:id => id === '/__mascot-fixture.jsx' ? fixture : undefined}]});
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:640},hasTouch:true,isMobile:true});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__mascot-fixture', route => route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module" src="/__mascot-fixture.jsx"></script>'}));
  try {
    await page.goto(`${base}/__mascot-fixture`);
    const toy = page.locator('.mascot-toy');
    await expect(toy).toBeVisible();
    // Enlarge only the isolated fixture so saved evidence shows actual pixels.
    await page.addStyleTag({content:'.for-root .mascot-stack{--cloud-size:220px;right:70px;bottom:45px}'});
    await page.evaluate(async () => {
      const sources = [...new Set([...document.querySelectorAll('svg image')].map(node => node.getAttribute('href')))];
      await Promise.all(sources.map(src => { const img = new Image(); img.src=src; return img.decode(); }));
    });
    const clickToy = () => toy.evaluate(node => node.click());
    for (let mood=1; mood<=6; mood++) {
      await clickToy();
      await expect(toy).toHaveAttribute('data-mood', String(mood));
      const active = page.locator('.cloud-pose[data-active="true"]');
      await expect(active).toHaveCount(1);
      await expect.poll(() => active.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
      await expect(page.locator('.cloud-vector-art')).toHaveCount(0);
      assert.equal(await active.getAttribute('data-expression'), String(Math.min(mood,5)));
      await page.locator('.amount-stage').screenshot({path:path.join(ARTIFACTS,`tap-${mood}.png`)});
    }
    await clickToy();
    await expect(toy).toHaveAttribute('data-phase','burst');
    const frames = page.locator('.cloud-pop-atlas .cloud-atlas-frame');
    await expect(frames).toHaveCount(8);
    // Sample every frame boundary, including the final clear frame. No opacity
    // dip and no stale vector face may compete with this primary art layer.
    const counts = await frames.evaluateAll(nodes => {
      const animations = nodes.map(node => node.getAnimations()[0]);
      animations.forEach(animation => animation.pause());
      return Array.from({length:8},(_,frame) => {
        animations.forEach(animation => { animation.currentTime = frame*35+17; });
        return nodes.filter(node => Number(getComputedStyle(node).opacity) > .99).length;
      });
    });
    assert.deepEqual(counts,Array(8).fill(1));
    await expect(toy).toHaveAttribute('data-phase','sign');
    await clickToy(); await clickToy();
    await expect(toy).toHaveAttribute('data-phase','cloud');
    await expect(page.locator('.cloud-tap-atlas .cloud-atlas-frame')).toHaveCount(8);
    await expect(page.locator('#mascot')).toHaveAttribute('data-returning','false');
    await expect(page.locator('.cloud-pose[data-active="true"]')).toHaveCount(1);

    // Cash playback can interrupt returning, then resolves to a real pose.
    await page.locator('.mascot-confirm').evaluate(node => node.click());
    await expect(page.locator('.cloud-expense-tear')).toHaveCount(3);
    const tearMotion = await page.locator('.cloud-expense-tear').first().evaluate(node => {
      const a=node.getAnimations()[0]; a.pause(); a.currentTime=260;
      const start=getComputedStyle(node).transform; a.currentTime=480;
      return start !== getComputedStyle(node).transform;
    });
    assert.equal(tearMotion,true);
    await expect(page.locator('.money-bundle-art image')).toHaveCount(1);
    await page.locator('.amount-stage').screenshot({path:path.join(ARTIFACTS,'expense.png')});
    await expect(page.locator('.money-celebration')).toHaveCount(0);
    await page.locator('#income').click();
    await expect(page.locator('.money-celebration.is-income')).toHaveCount(1);
    await expect(page.locator('.money-cotton-tuck')).toHaveCount(1);
    await expect(page.locator('.money-celebration')).toHaveCount(0);

    await page.locator('#weather').click();
    await expect(page.locator('.cloud-pose[data-active="true"]')).toHaveAttribute('data-expression','7');
    await expect(page.locator('.cloud-night .weather-art-shell')).toHaveCount(0); // no doubled hat
    await page.locator('#weather').click();
    await expect(page.locator('.cloud-pose[data-active="true"]')).toHaveAttribute('data-expression','6');

    await toy.evaluate(node => { for(let i=0;i<15;i++) node.click(); });
    await expect(toy).toHaveAttribute('data-phase','burst');
    await expect(page.locator('.cloud-sign-flight')).toHaveCount(1);
    await page.locator('#mount').click();
    await expect(page.locator('.cloud-sign-flight')).toHaveCount(0);
    await page.locator('#mount').click();
    await expect(toy).toHaveAttribute('data-mood','0');
    await toy.evaluate(node => { for(let i=0;i<7;i++) node.click(); });
    await expect(toy).toHaveAttribute('data-phase','sign');
    await expect(toy).toHaveAttribute('data-phase','cloud',{timeout:7500});
    await expect(toy).toHaveAttribute('data-mood','0');
    assert.deepEqual(errors,[]);
    console.log(`PASS: visible poses, gap-free frames, cash/tears, weather, rapid taps, restore and cleanup; ${ARTIFACTS}`);
  } catch (error) { console.error('Page errors:',errors); throw error; }
  finally { await browser.close(); await server.close(); }
})().catch(error => {console.error(error); process.exitCode=1;});
