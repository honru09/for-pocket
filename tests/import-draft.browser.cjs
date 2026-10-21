const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppRoot} from '@telegram-apps/telegram-ui';
import '@telegram-apps/telegram-ui/dist/styles.css';
import '/src/styles.css';
import AiImportPage from '/src/AiImportPage.jsx';
import {initialSettings} from '/public/shared.mjs';
import {translate} from '/public/i18n.mjs';
window.__saved = [];
window.__saveMode = 'success';
window.__releaseSave = null;
const t = (key,params) => translate('en',key,params);
const service = {
  aiParseExpense:async () => ({items:[{amount:850,currency:'JPY',categoryId:'stomach',consumer:'u_alice',merchant:'Ramen',note:'Lunch',occurredAt:'2026-10-22T03:00:00Z',timezone:'Asia/Tokyo',confidence:.95}]}),
  importExpenses:async entries => {
    window.__lastSubmitted = structuredClone(entries);
    if (window.__saveMode === 'delayed') await new Promise(resolve=>{window.__releaseSave=resolve;});
    if (window.__saveMode === 'fail') throw Error('errorSave');
    window.__saved.push(...entries);
    return {entries};
  },
};
function Surface() {
  const [open,setOpen]=useState(true),[user,setUser]=useState('u_alice'),[ledger,setLedger]=useState('circle-one');
  const settings=initialSettings('en');settings.consumers=[{id:user,name:user,color:'yellow',avatar:'cloud'}];
  const profile={user:{id:user},ledgerId:ledger,expenses:[]};
  return <><div className="fixture-controls"><button id="toggle" onClick={()=>setOpen(v=>!v)}>Toggle</button><button id="user" onClick={()=>setUser(v=>v==='u_alice'?'u_bob':'u_alice')}>User</button><button id="ledger" onClick={()=>setLedger(v=>v==='circle-one'?'private':'circle-one')}>Ledger</button></div>{open&&<AiImportPage t={t} profile={profile} settings={settings} isRemote service={service} run={fn=>fn()}/>}</>;
}
createRoot(document.getElementById('root')).render(<AppRoot className="for-root" platform="ios" appearance="light"><Surface/></AppRoot>);
`;

(async () => {
  const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')));
  const server = await createServer({configFile:false,root:ROOT,publicDir:false,logLevel:'error',server:{host:'127.0.0.1',port:0},
    plugins:[{name:'import-draft-fixture',resolveId:id=>id==='/__draft-fixture.jsx'?id:undefined,load:id=>id==='/__draft-fixture.jsx'?fixture:undefined}]});
  await server.listen();
  const base=`http://127.0.0.1:${server.httpServer.address().port}`;
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  const failures=[];
  const page=await context.newPage();
  page.on('pageerror',error=>failures.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base)return route.fulfill({body:''});
    if(url.pathname==='/draft-test')return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module" src="/__draft-fixture.jsx"></script>'});
    return route.continue();
  });
  const reopen=async()=>{await page.locator('#toggle').click();await expect(page.locator('.ai-import')).toHaveCount(0);await page.locator('#toggle').click();await expect(page.locator('.ai-import')).toBeVisible();};
  try {
    await page.goto(base+'/draft-test');
    await page.locator('#ai-import-text').fill('Lunch 850');
    await reopen();
    await expect(page.locator('#ai-import-text')).toHaveValue('Lunch 850');
    await page.locator('#user').click();await expect(page.locator('#ai-import-text')).toHaveValue('');
    await page.locator('#ai-import-text').fill('Private Bob note');
    await page.locator('#user').click();await expect(page.locator('#ai-import-text')).toHaveValue('Lunch 850');
    await page.locator('#ledger').click();await expect(page.locator('#ai-import-text')).toHaveValue('');
    await page.locator('#ledger').click();await expect(page.locator('#ai-import-text')).toHaveValue('Lunch 850');

    await page.locator('.ai-import-source button[type="submit"]').click();
    await expect(page.locator('.ai-import-item')).toHaveCount(1);
    await page.getByRole('textbox',{name:'Note',exact:true}).fill('Edited note');
    const getId=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(key=>key.startsWith('for-pocket.import-draft.v1:')&&key.includes('u_alice')&&key.includes('circle-one')))).items[0].id);
    const firstId=await getId();
    await reopen();
    await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Edited note');
    assert.equal(await getId(),firstId);
    await page.reload();
    await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('Edited note');
    assert.equal(await getId(),firstId);
    await page.locator('.ai-import-save').click();
    await expect(page.locator('.ai-import-item')).toHaveCount(0);
    assert.equal((await page.evaluate(()=>window.__saved))[0].id,firstId);
    await reopen();await expect(page.locator('.ai-import-item')).toHaveCount(0);await expect(page.locator('#ai-import-text')).toHaveValue('');

    await page.locator('.ai-import-file-input').setInputFiles({name:'receipt.txt',mimeType:'text/plain',buffer:Buffer.from('Lunch 850')});
    await page.locator('.ai-import-source button[type="submit"]').click();
    await expect(page.locator('.ai-import-item')).toHaveCount(1);
    await reopen();
    await expect(page.locator('.ai-import-restored-files')).toContainText('receipt.txt');
    await expect(page.locator('.ai-import-source button[type="submit"]')).toBeDisabled();
    await expect(page.locator('.ai-import-save')).toBeEnabled();
    await page.evaluate(()=>{window.__saveMode='fail';});
    await page.locator('.ai-import-save').click();
    await expect(page.locator('.ai-import-status.is-error')).toBeVisible();
    await reopen();await expect(page.locator('.ai-import-item')).toHaveCount(1);
    await page.evaluate(()=>{window.__saveMode='delayed';});
    await page.locator('.ai-import-save').click();
    await expect.poll(()=>page.evaluate(()=>typeof window.__releaseSave)).toBe('function');
    await reopen();await expect(page.locator('.ai-import-item')).toHaveCount(1);
    await page.evaluate(()=>window.__releaseSave());
    await expect(page.locator('.ai-import-item')).toHaveCount(0);
    await expect(page.locator('.ai-import-restored-files')).toHaveCount(0);
    await reopen();await expect(page.locator('.ai-import-item')).toHaveCount(0);
    await page.locator('#user').click();await expect(page.locator('#ai-import-text')).toHaveValue('Private Bob note');
    assert.deepEqual(failures,[]);
    console.log('Import drafts: navigation, refresh, user/ledger isolation, edited IDs, file reselect, failure/retry and late save completion passed.');
  } finally {await context.close();await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
