const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppRoot} from '@telegram-apps/telegram-ui';
import '@telegram-apps/telegram-ui/dist/styles.css';
import '/src/styles.css';
import '/src/account-styles.css';
import '/src/pocket-layout.css';
import '/src/refinements.css';
import '/src/ui-polish.css';
import '/src/popup-materials.css';
import '/src/secondary-motion.css';
import '/src/journal-materials.css';
import FreeMoney from '/src/FreeMoney.jsx';
import {initialSettings} from '/public/shared.mjs';
import {translate} from '/public/i18n.mjs';
window.__calls=[];window.__analysisCalls=[];window.__saveMode='success';window.__analysisMode='success';
window.__releaseSave=null;window.__releaseAnalysis=null;
function Surface(){
 const [ledger,setLedger]=useState('circle-one'),[language,setLanguage]=useState('en'),[plans,setPlans]=useState({}),[revision,setRevision]=useState(0);
 window.__fixture={setLedger,setLanguage,rerender:()=>setRevision(v=>v+1)};
 const settings={...initialSettings(language),timezone:'Asia/Tokyo',fixedCapital:plans[ledger]};
 const save=async value=>{
   const target=ledger,mode=window.__saveMode;window.__calls.push({ledger:target,value:structuredClone(value)});
   if(mode==='delayed')await new Promise(resolve=>{window.__releaseSave=resolve;});
   if(mode==='fail')throw Error('errorSave');
   if(mode==='empty')return null;
   setPlans(previous=>({...previous,[target]:value}));return {settings:{fixedCapital:value}};
 };
 const analyze=async value=>{
   const mode=window.__analysisMode;window.__analysisCalls.push(value);
   if(mode==='delayed')await new Promise(resolve=>{window.__releaseAnalysis=resolve;});
   if(mode==='fail')throw Error('offline');
   return {text:'Old optional commentary'};
 };
 return <main className="settings-content" data-revision={revision} style={{maxWidth:460,margin:'20px auto',padding:12}}>
   <FreeMoney settings={settings} expenses={[]} ledgerId={ledger} t={(key,params)=>translate(language,key,params)} saveFixedCapital={save} analyzeBudget={analyze}/>
   <div id="home-mode"><FreeMoney mode="home" settings={settings} ledgerId={ledger} t={key=>translate(language,key)}/></div>
 </main>;
}
createRoot(document.getElementById('root')).render(<AppRoot className="for-root" platform="ios" appearance="light"><Surface/></AppRoot>);
`;

(async () => {
  const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')));
  const server = await createServer({configFile:false,root:ROOT,publicDir:false,logLevel:'error',server:{host:'127.0.0.1',port:0},
    plugins:[{name:'free-money-fixture',resolveId:id=>id==='/__free-money-fixture.jsx'?id:undefined,load:id=>id==='/__free-money-fixture.jsx'?fixture:undefined}]});
  await server.listen();
  const base=`http://127.0.0.1:${server.httpServer.address().port}`;
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const page=await context.newPage(),errors=[];
  await page.clock.setFixedTime(new Date('2026-10-22T03:00:00.000Z'));
  const screenshots=await fs.mkdtemp(path.join(os.tmpdir(),'for-pocket-free-money-'));
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base)return route.fulfill({body:''});
    if(url.pathname==='/free-money-test')return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/__free-money-fixture.jsx"></script>'});
    return route.continue();
  });
  const sheet=page.locator('.free-money-sheet'),stage=page.locator('.free-money-stage'),primary=page.locator('.free-money-actions .free-money-primary');
  const open=async()=>{await page.locator('.free-money-entry').click();await expect(sheet).toBeVisible();};
  const close=async()=>{await sheet.locator('header button').click();await expect(sheet).toHaveCount(0);};
  const basics=async()=>{await page.locator('#free-money-income').fill('310000');await page.locator('#free-money-fixed').fill('100000');await primary.click();await expect(stage).toHaveAttribute('data-page','reserve');};
  const reserve=async()=>{await page.locator('#free-money-savings').fill('55000');await page.locator('#free-money-payday').fill('1');};
  try {
    await page.goto(base+'/free-money-test');
    await expect(page.locator('#home-mode')).toBeEmpty();
    await open();
    await primary.click();await expect(page.locator('#free-money-income')).toHaveAttribute('aria-invalid','true');
    await basics();await reserve();
    assert.equal(await page.locator('[data-testid="free-money-daily"]').innerText(),'¥5,000');
    await page.evaluate(()=>window.__fixture.rerender());
    await expect(page.locator('#free-money-savings')).toHaveValue('55000');
    assert.equal(await stage.evaluate(el=>getComputedStyle(el).animationDuration),'0.18s');
    // Local calculation enables saving even when the optional network review fails.
    await page.evaluate(()=>{window.__analysisMode='fail';});
    await page.locator('.free-money-analysis > button').click();
    await expect(page.locator('.free-money-analysis > p')).toContainText('can still save');
    await expect(primary).toBeEnabled();
    await page.evaluate(()=>{window.__saveMode='empty';});
    await primary.click();await expect(page.locator('.free-money-save-error')).toBeVisible();
    await expect(page.locator('#free-money-savings')).toHaveValue('55000');
    // Two taps before a React render cannot create two saves.
    await page.evaluate(()=>{window.__saveMode='delayed';});
    await primary.evaluate(el=>{el.click();el.click();});
    await expect.poll(()=>page.evaluate(()=>window.__calls.length)).toBe(2);
    await expect(primary).toBeDisabled();
    await page.evaluate(()=>window.__releaseSave());
    await expect(stage).toHaveAttribute('data-page','overview');
    await expect(page.locator('.free-money-breakdown > div')).toHaveCount(3);
    assert.equal((await page.evaluate(()=>window.__calls))[1].value.enabled,true);
    // Saved setup can be paused without losing the editable amounts.
    await page.evaluate(()=>{window.__saveMode='success';});
    await page.locator('.free-money-pause').click();
    await expect(stage).toHaveAttribute('data-page','basics');
    await expect(page.locator('#free-money-income')).toHaveValue('310000');
    assert.equal((await page.evaluate(()=>window.__calls)).at(-1).value.enabled,false);
    await primary.click();await reserve();
    // An edit makes an old optional review obsolete.
    await page.evaluate(()=>{window.__analysisMode='delayed';});
    await page.locator('.free-money-analysis > button').click();
    await expect.poll(()=>page.evaluate(()=>typeof window.__releaseAnalysis)).toBe('function');
    await page.locator('#free-money-savings').fill('60000');
    await page.evaluate(()=>window.__releaseAnalysis());
    await expect(page.locator('.free-money-analysis')).not.toContainText('Old optional commentary');
    await close();await open();await primary.click();await reserve();
    // A late save belongs to the originating ledger and must not repaint another one.
    await page.evaluate(()=>{window.__saveMode='delayed';window.__releaseSave=null;});
    await primary.click();
    await expect.poll(()=>page.evaluate(()=>typeof window.__releaseSave)).toBe('function');
    await page.evaluate(()=>window.__fixture.setLedger('private'));
    await expect(sheet).toHaveCount(0);await open();
    await expect(page.locator('#free-money-income')).toHaveValue('');
    await page.evaluate(()=>window.__releaseSave());
    await expect(page.locator('#free-money-income')).toHaveValue('');
    await expect(stage).toHaveAttribute('data-page','basics');
    await basics();await reserve();
    await page.evaluate(()=>{window.__saveMode='fail';});await primary.click();
    await expect(page.locator('.free-money-save-error')).toBeVisible();
    await page.evaluate(()=>{window.__saveMode='success';});await primary.click();
    await expect(stage).toHaveAttribute('data-page','overview');
    // Check mobile typography, image decoding, hit areas and full three-language layout.
    for(const language of ['zh','en','uk']){
      await page.evaluate(value=>window.__fixture.setLanguage(value),language);
      await expect(page.locator('.free-money-notice')).toHaveText({zh:'放好啦',en:'All tucked away',uk:'Усе на місці'}[language]);
      for(const width of [320,390,768]){
        await page.setViewportSize({width,height:844});
        await expect(sheet).toBeVisible();
        const metrics=await sheet.evaluate(el=>{
          const r=el.getBoundingClientRect();
          return {left:r.left,right:r.right,scroll:el.scrollWidth,client:el.clientWidth,
            buttons:[...el.querySelectorAll('.free-money-actions button,.free-money-analysis > button,.free-money-pause')].map(button=>button.getBoundingClientRect().height),
            images:[...el.querySelectorAll('img')].every(img=>img.complete&&img.naturalWidth>0)};
        });
        assert.ok(metrics.left>=0&&metrics.right<=width+.5,JSON.stringify({language,width,metrics}));
        assert.ok(metrics.scroll<=metrics.client+1,JSON.stringify({language,width,metrics}));
        assert.ok(metrics.buttons.every(height=>height>=44),JSON.stringify({language,width,metrics}));
        assert.equal(metrics.images,true,`${language} ${width}: every imported asset loads`);
        if(width===390)await page.screenshot({path:path.join(screenshots,`free-money-${language}.png`)});
      }
    }
    await page.locator('.free-money-actions button').first().evaluate(el=>el.click());
    await expect(sheet).toHaveAttribute('data-exiting','true');
    await expect(sheet).toHaveCount(0);
    await open();await primary.click();
    assert.equal(await page.locator('#free-money-income').evaluate(el=>getComputedStyle(el).fontSize),'16px');
    assert.deepEqual(errors,[]);
    console.log('Free money: deterministic setup, validation, optional analysis failure, double-submit guard, save retry, pause, stale requests, ledger isolation and three-language responsive layout passed.');
    console.log(`Screenshots: ${screenshots}`);
  } finally {await context.close();await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
