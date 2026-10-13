const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Real React receiver + browser animations, with an in-memory inbox matching
// the production 40-item GET/ACK contract. No Telegram or cloud requests.
// node <playwright-skill>/run.js tests/reaction-celebration.browser.cjs
// PW_HEADLESS=true is available for CI; the default browser is visible.
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(ROOT, 'outputs', 'reaction-celebration');
const ENTRY = path.join(ROOT, '__reaction-celebration-entry.jsx').replaceAll('\\','/');
const STAGE = '.incoming-emoji';
const fixtureModule = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from '@telegram-apps/telegram-ui';
import '@telegram-apps/telegram-ui/dist/styles.css';
import '/src/styles.css';
import '/src/account-styles.css';
import '/src/pocket-layout.css';
import '/src/refinements.css';
import CircleReactions from '/src/CircleReactions.jsx';
const receiver = { id:'u_receiver', name:'Cheese', color:'yellow', avatar:'cloud' };
const sender = { id:'u_sender', name:'Kojun', color:'blue', avatar:'cloud' };
const circle = { id:'reaction-fixture-circle', members:[receiver,sender] };
const fixture = window.__reactionFixture;
createRoot(document.getElementById('root')).render(
  React.createElement(AppRoot, { platform:'ios', appearance:'light' },
    React.createElement('main', { className:'for-root', style:{minHeight:'100vh',padding:20} },
      React.createElement('p', null, 'Reaction reception test'),
      React.createElement(CircleReactions, {
        circle, ledgerId:'reaction-fixture-ledger', userId:receiver.id,
        service:fixture.service, t:key=>key, onHaptic:()=>{}, onSelf:()=>{},
      })
    )
  )
);
fixture.ready = true;
`;

function installFixture({ hidden = false } = {}) {
  const entries = new Map(), acknowledged = new Set();
  let visible = !hidden, serial = 0;
  const fixture = window.__reactionFixture = {
    ready:false, reads:0, ackCalls:[], snapshots:[], celebrations:[], errors:[],
    initialCount:null, maxStages:0, maxParticles:0, maxAnimations:0, frameIntervals:[],
    service:{
      async getReactions() {
        fixture.reads++;
        if (fixture.holdNextRead) {
          fixture.holdNextRead = false;
          await new Promise(resolve => { fixture.releaseRead = resolve; });
        }
        const pending = [...entries.values()].filter(item => !acknowledged.has(item.id));
        return { circleId:'reaction-fixture-circle', items:structuredClone(pending.slice(0,40)), hasMore:pending.length > 40 };
      },
      async acknowledgeReactions({ ids }) {
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 40) throw new Error('Invalid ACK batch');
        const stage = document.querySelector('.incoming-emoji');
        const opacity = stage ? Number(getComputedStyle(stage).opacity) : 0;
        const box = stage?.getBoundingClientRect();
        fixture.ackCalls.push({ ids:[...ids], visible, opacity, phase:stage?.dataset.phase,
          burstId:stage?.dataset.burstId, count:Number(stage?.dataset.reactionCount || 0),
          painted:Boolean(stage && box.width && box.height && opacity > .01 && !stage.closest('[hidden]')),
          at:performance.now() });
        for (const id of ids) {
          if (!entries.has(id)) throw new Error('ACK guessed an event not received');
          acknowledged.add(id);
        }
        return { ok:true, circleId:'reaction-fixture-circle' };
      },
      async sendReaction() { throw new Error('This fixture tests receiving only'); },
    },
    append({ burstId = 'burst-fixture-001', number = 1, total, emoji = '❤️', kick = true } = {}) {
      const existing = [...entries.values()].filter(item => item.burstId === burstId);
      const nextIndex = Math.max(0,...existing.map(item => item.burstIndex));
      const count = total ?? nextIndex + number, at = Date.now();
      for (const item of existing) { item.burstCount = count; item.burstLastAt = at; }
      const ids = [];
      for (let n = 0; n < number; n++) {
        const id = 'event-fixture-' + String(++serial).padStart(6,'0');
        entries.set(id,{ id,emoji,createdAt:at,burstId,burstIndex:nextIndex+n+1,burstCount:count,burstLastAt:at,
          sender:{id:'u_sender',name:'Kojun',color:'blue',avatar:'cloud'} });
        ids.push(id);
      }
      if (kick) window.dispatchEvent(new Event('focus'));
      return ids;
    },
    setVisible(value) {
      visible = value;
      document.dispatchEvent(new Event('visibilitychange'));
      if (visible) window.dispatchEvent(new Event('focus'));
    },
    get pending() { return [...entries.keys()].filter(id => !acknowledged.has(id)); },
    get acknowledged() { return [...acknowledged]; },
    get total() { return entries.size; },
  };
  Object.defineProperty(document,'visibilityState',{ configurable:true,get:()=>visible?'visible':'hidden' });
  Object.defineProperty(document,'hidden',{ configurable:true,get:()=>!visible });
  let lastSignature = '';
  const sample = () => {
    const stages = [...document.querySelectorAll('.incoming-emoji')];
    fixture.maxStages = Math.max(fixture.maxStages,stages.length);
    fixture.maxParticles = Math.max(fixture.maxParticles,document.querySelectorAll('.emoji-celebration-particle').length);
    fixture.maxAnimations = Math.max(fixture.maxAnimations,document.getAnimations().length);
    for (const stage of stages) {
      const { phase, burstId, celebrationId } = stage.dataset;
      const count = Number(stage.dataset.reactionCount || 0);
      if (count && fixture.initialCount === null) fixture.initialCount = count;
      if (celebrationId && !fixture.celebrations.includes(celebrationId)) fixture.celebrations.push(celebrationId);
      const signature = [phase,burstId,count,celebrationId].join(':');
      if (signature !== lastSignature) {
        lastSignature = signature;
        fixture.snapshots.push({ phase,burstId,count,celebrationId,at:performance.now() });
      }
      if (fixture.injectOnExit && phase === 'exit') {
        const injection = fixture.injectOnExit;
        fixture.injectOnExit = null;
        fixture.exitInjectedAt = performance.now();
        fixture.exitInjectedIds = fixture.append(injection);
      }
    }
  };
  new MutationObserver(sample).observe(document,{subtree:true,childList:true,attributes:true,
    attributeFilter:['data-reaction-count','data-burst-id','data-phase','data-celebration-id']});
  let lastFrame=null;
  const frame = now => {
    if (visible && document.querySelector('.incoming-emoji')?.dataset.phase==='flood') {
      if (lastFrame!==null && fixture.frameIntervals.length<600) fixture.frameIntervals.push(now-lastFrame);
      lastFrame=now;
    } else lastFrame=null;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.addEventListener('error',event => fixture.errors.push(event.message));
}

async function startFixtureServer() {
  const { createServer } = await import(pathToFileURL(path.join(ROOT,'node_modules/vite/dist/node/index.js')));
  let vite;
  vite = await createServer({ configFile:false,root:ROOT,publicDir:false,logLevel:'error',
    plugins:[{
      name:'reaction-celebration-browser-fixture',
      resolveId(id) { if (id === '/__reaction-celebration-entry.jsx') return ENTRY; },
      load(id) { if (id === ENTRY) return fixtureModule; },
      configureServer(server) {
        server.middlewares.use(async (request,response,next) => {
          if (request.url !== '/') return next();
          try {
            const html = await server.transformIndexHtml('/',
              '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__reaction-celebration-entry.jsx"></script></body></html>');
            response.setHeader('Content-Type','text/html'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }],
    server:{ host:'127.0.0.1',port:0 },
  });
  await vite.listen();
  return { vite,base:`http://127.0.0.1:${vite.httpServer.address().port}` };
}

async function newPage(browser, base, options = {}) {
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'en-US'});
  await context.route('**/*',route => new URL(route.request().url()).origin === base
    ? route.continue() : route.fulfill({status:200,contentType:'application/javascript',body:''}));
  await context.addInitScript(installFixture,options);
  const page = await context.newPage();
  page.on('pageerror',error => console.error('Browser:',error.message));
  await page.goto(base);
  await page.waitForFunction(() => window.__reactionFixture?.ready,{},{timeout:10000});
  await expect(page.locator('.circle-presence')).toBeVisible();
  return { context,page };
}

const append = (page, input) => page.evaluate(input => window.__reactionFixture.append(input),input);
const stats = page => page.evaluate(() => {
  const f=window.__reactionFixture;
  return { reads:f.reads,pending:f.pending,acknowledged:f.acknowledged,ackCalls:f.ackCalls,
    snapshots:f.snapshots,celebrations:f.celebrations,initialCount:f.initialCount,
    maxStages:f.maxStages,maxParticles:f.maxParticles,maxAnimations:f.maxAnimations,frameIntervals:f.frameIntervals,errors:f.errors };
});
const waitAck = (page,count) => expect.poll(async () => (await stats(page)).acknowledged.length,{timeout:12000}).toBe(count);
const waitQuiet = (page,timeout = 8000) => page.waitForFunction(() => {
  const stages=[...document.querySelectorAll('.incoming-emoji')];
  return stages.every(stage => stage.closest('[hidden]') || getComputedStyle(stage).display==='none'
    || Number(getComputedStyle(stage).opacity)<=.01);
},{},{timeout});

async function hundredAtOnce(page) {
  await append(page,{number:100});
  await expect(page.locator(STAGE)).toHaveAttribute('data-reaction-count','100');
  await expect(page.locator(STAGE)).toHaveAttribute('data-phase','flood');
  await expect(page.locator('.emoji-reception-focus .emoji-burst-count')).toHaveText('✖️1️⃣0️⃣0️⃣');
  assert.equal((await stats(page)).initialCount,100,'first presentation uses the server burst total');
  await expect.poll(() => page.locator('.emoji-celebration-particle').evaluateAll(nodes =>
    nodes.filter(node=>Number(getComputedStyle(node).opacity)>.75).length)).toBeGreaterThan(20);
  await page.screenshot({path:path.join(ARTIFACTS,'hundred-at-once.png')});
  await waitAck(page,100);
  const displayed = await stats(page);
  assert.equal(displayed.celebrations.length,1,'40-item pagination never restarts the fullscreen celebration');
  assert.equal(displayed.maxStages,1,'only one receiver stage');
  assert.ok(displayed.maxParticles > 5 && displayed.maxParticles <= 32,'fullscreen particle count is fixed and bounded');
  assert.ok(displayed.ackCalls.every(call => call.visible && call.ids.length <= 40));
  // A continuing tap extends the compact counter, never the big animation.
  await append(page,{number:1});
  await waitAck(page,101);
  await expect(page.locator(STAGE)).toHaveAttribute('data-phase','dock');
  await expect.poll(() => page.locator('.emoji-reception-dock').evaluate(node=>Number(getComputedStyle(node).opacity))).toBeGreaterThan(.8);
  await page.screenshot({path:path.join(ARTIFACTS,'hundred-to-dock.png')});
  await waitQuiet(page);
  const finished = await stats(page);
  assert.equal(finished.celebrations.length,1,'historical events finish as one celebration');
}

async function sixthEscalates(page) {
  await append(page,{number:5});
  await expect(page.locator(STAGE)).toHaveAttribute('data-reaction-count','5');
  await expect(page.locator(STAGE)).toHaveAttribute('data-phase','pop');
  await waitAck(page,5);
  await append(page,{number:1});
  await expect(page.locator(STAGE)).toHaveAttribute('data-reaction-count','6');
  await expect(page.locator(STAGE)).toHaveAttribute('data-phase','flood');
  await waitAck(page,6);
  assert.equal((await stats(page)).celebrations.length,1,'the sixth tap upgrades the same stage once');
}

async function exitRetargets(page) {
  // Inject precisely on the exit phase, not after an arbitrary timeout.
  await append(page,{number:1});
  await expect(page.locator(STAGE)).toHaveAttribute('data-reaction-count','1');
  await waitAck(page,1);
  await page.evaluate(() => { window.__reactionFixture.injectOnExit={number:1}; });
  await page.waitForFunction(() => window.__reactionFixture.exitInjectedIds?.length,{},{timeout:8000});
  await expect(page.locator(STAGE)).toHaveAttribute('data-reaction-count','2');
  await expect.poll(() => page.locator(STAGE).evaluate(node => Math.max(
    ...[...node.querySelectorAll('.emoji-reception-focus,.emoji-reception-dock')].map(child=>Number(getComputedStyle(child).opacity))
  ))).toBeGreaterThan(.1);
  await waitAck(page,2);
  const result = await stats(page);
  const lastId = result.acknowledged.at(-1);
  const delivery = result.ackCalls.find(call=>call.ids.includes(lastId));
  assert.ok(delivery.visible && delivery.painted,'new event is acknowledged with a visible stage after exit is interrupted');
  assert.equal(delivery.count,2,'the old exit cannot clear or acknowledge the new frame');
}

async function sustainedReception(page) {
  await append(page,{number:6});
  await expect(page.locator(STAGE)).toHaveAttribute('data-phase','flood');
  await page.evaluate(() => {
    const fixture=window.__reactionFixture;
    fixture.sustainedStartedAt=performance.now();
    let ticks=0;
    const timer=setInterval(() => {
      fixture.append({number:2});
      if (++ticks===30) { clearInterval(timer);fixture.sustainedFinished=true; }
    },200);
  });
  await page.waitForFunction(() => window.__reactionFixture.sustainedFinished,{},{timeout:9000});
  await expect(page.locator(STAGE)).toHaveAttribute('data-reaction-count','66');
  await waitAck(page,66);
  const result=await stats(page);
  assert.equal(result.celebrations.length,1,'continuous taps do not restart a large animation');
  assert.equal(result.maxStages,1);
  assert.ok(result.maxParticles<=32,'one particle budget covers the whole stream');
  assert.ok(result.maxAnimations<80,'animation objects remain bounded during continuous delivery');
  const firstFlood=result.snapshots.find(item=>item.phase==='flood');
  const firstDock=result.snapshots.find(item=>item.phase==='dock');
  assert.ok(firstFlood && firstDock,'a stream eventually becomes a compact counter');
  assert.ok(firstDock.at-firstFlood.at<3500,'continued arrivals do not extend the fullscreen lifetime');
  await waitQuiet(page,6500);
}

async function hiddenDoesNotAcknowledge(page) {
  await append(page,{number:12});
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve,1800)));
  const hidden=await stats(page);
  assert.equal(hidden.acknowledged.length,0,'background inbox is not marked seen');
  assert.equal(hidden.ackCalls.length,0,'no ACK request while hidden');
  assert.equal(hidden.pending.length,12);
  await page.evaluate(() => window.__reactionFixture.setVisible(true));
  await expect(page.locator(STAGE)).toHaveAttribute('data-reaction-count','12');
  await waitAck(page,12);
  assert.ok((await stats(page)).ackCalls.every(call=>call.visible));
}

async function hiddenInFlightResume(page) {
  await page.evaluate(() => {
    const f = window.__reactionFixture;
    f.holdNextRead = true;
    f.append({number:12});
  });
  await page.waitForFunction(() => typeof window.__reactionFixture.releaseRead === 'function');
  await page.evaluate(() => {
    const f = window.__reactionFixture;
    f.setVisible(false);
    f.releaseRead();
  });
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve,100)));
  assert.equal((await stats(page)).acknowledged.length,0,'an in-flight result while hidden is not acknowledged');
  await page.evaluate(() => {
    const realNow = Date.now;
    Date.now = () => realNow()+10000;
    window.__reactionFixture.setVisible(true);
  });
  await expect(page.locator(STAGE)).toHaveAttribute('data-phase','flood');
  await waitAck(page,12);
  await expect(page.locator(STAGE)).toHaveCount(0,{timeout:3800});
  assert.equal((await stats(page)).celebrations.length,1,'a new scene never inherits the old background elapsed time');
}

(async () => {
  const { vite,base }=await startFixtureServer();
  await fs.mkdir(ARTIFACTS,{recursive:true});
  let browser;
  try {
    browser=await chromium.launch({headless:process.env.PW_HEADLESS==='true'});
    const cases=[
      ['hundred-at-once',hundredAtOnce,{}],
      ['sixth-escalates',sixthEscalates,{}],
      ['exit-retargets',exitRetargets,{}],
      ['sustained-reception',sustainedReception,{}],
      ['hidden-no-ack',hiddenDoesNotAcknowledge,{hidden:true}],
      ['hidden-in-flight-resume',hiddenInFlightResume,{}],
    ].filter(([name]) => !process.env.REACTION_CASE || process.env.REACTION_CASE===name);
    assert.ok(cases.length,'REACTION_CASE must name an existing scenario');
    for (const [name,check,options] of cases) {
      const {context,page}=await newPage(browser,base,options);
      try {
        await check(page);
        assert.deepEqual((await stats(page)).errors,[]);
        const result=await stats(page);
        await fs.writeFile(path.join(ARTIFACTS,name+'-stats.json'),JSON.stringify(result,null,2));
        const frames=result.frameIntervals.slice().sort((a,b)=>a-b);
        const p95=frames.length ? frames[Math.floor((frames.length-1)*.95)].toFixed(1) : null;
        console.log('PASS '+name+(p95 ? ' (rAF p95 '+p95+'ms, '+frames.length+' frames; diagnostic only)' : ''));
      } catch(error) {
        await page.screenshot({path:path.join(ARTIFACTS,name+'-failed.png'),fullPage:true}).catch(()=>{});
        await fs.writeFile(path.join(ARTIFACTS,name+'-stats.json'),JSON.stringify(await stats(page),null,2));
        throw error;
      } finally { await context.close(); }
    }
    console.log('PASS: '+cases.length+' reaction reception scenarios; artifacts: '+ARTIFACTS);
  } finally { await browser?.close(); await vite.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
