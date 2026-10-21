const assert = require('node:assert/strict');
const { randomInt } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { chromium } = require('playwright');
const { expect } = require('playwright/test');

// Exercise the production keypad and amount state rather than a gesture mock.
// Run separately from the dependency-free unit suite:
//   node tests/keypad-interaction.browser.cjs
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const { createServer } = await import(pathToFileURL(`${ROOT}/node_modules/vite/dist/node/index.js`));
  const server = await createServer({ configFile:false, root:ROOT, publicDir:false, logLevel:'error', server:{ host:'127.0.0.1', port:randomInt(20000,60000) } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({ headless:true });
  const checks = [];
  try {
    const context = await browser.newContext({ viewport:{ width:390, height:844 }, hasTouch:true, locale:'en-US', timezoneId:'Asia/Tokyo' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === base) {
        if (url.pathname === '/api/config') return route.fulfill({ contentType:'application/json', body:JSON.stringify({ mode:'local' }) });
        return route.continue();
      }
      return route.fulfill({ contentType:'application/javascript', body:'' });
    });
    await context.addInitScript(() => {
      window.__haptics = 0;
      window.Telegram = { WebApp:{ platform:'ios', initData:'', initDataUnsafe:{ user:{ language_code:'en' } }, ready(){}, expand(){}, setHeaderColor(){}, setBackgroundColor(){}, isVersionAtLeast:v=>v==='6.1', onEvent(){}, offEvent(){}, HapticFeedback:{ selectionChanged(){ window.__haptics++; }, notificationOccurred(){} }, BackButton:{ show(){}, hide(){}, onClick(){}, offClick(){} } } };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const key = value => page.locator(`#keypad button[data-key="${value}"]`);
    const amount = value => expect(page.locator('#amount-display')).toHaveText(value);
    const released = () => expect(page.locator('#keypad [data-pressed="true"]')).toHaveCount(0);
    const center = async value => {
      const box = await key(value).boundingBox();
      return { x:box.x+box.width/2, y:box.y+box.height/2, box };
    };
    const reset = async () => {
      await page.locator('#currency').selectOption('JPY');
      await key('clear').evaluate(node => node.click());
      await amount('0');
      await page.evaluate(() => { window.__haptics = 0; });
    };
    const press = async value => {
      const point = await center(value);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await expect(key(value)).toHaveAttribute('data-pressed','true');
      return point;
    };
    const run = async (name, fn) => { await reset(); await fn(); await released(); checks.push(name); console.log(`PASS ${name}`); };
    await expect(key('5')).toBeEnabled();

    await run('drag outside cancels the pointer activation', async () => {
      const p = await press('5');
      await page.mouse.move(p.box.x-12, p.y);
      await page.mouse.up();
      await amount('0');
      assert.equal(await page.evaluate(()=>window.__haptics),0);
    });
    await run('drag back inside does not revive a cancelled press', async () => {
      const p = await press('5');
      await page.mouse.move(p.box.x-12,p.y);
      await released();
      await page.mouse.move(p.x,p.y);
      await released();
      await page.mouse.up();
      await amount('0');
    });
    await run('right and middle mouse buttons never press or enter digits', async () => {
      const p = await center('5'); await page.mouse.move(p.x,p.y);
      for (const button of ['right','middle']) {
        await page.mouse.down({ button }); await released();
        await page.mouse.up({ button }); await amount('0');
      }
    });
    await run('capture failure still supports release and drag cancellation', async () => {
      await key('5').evaluate(node => { node.setPointerCapture=()=>{ throw new DOMException('capture unavailable','NotFoundError'); }; });
      try {
        const p = await press('5'); await page.mouse.move(p.box.x-12,p.y); await page.mouse.up(); await amount('0');
        await key('5').click(); await amount('5');
      } finally { await key('5').evaluate(node => { delete node.setPointerCapture; }); }
    });
    await run('lost capture cancels instead of committing its later click', async () => {
      await press('5');
      await key('5').evaluate(node => node.dispatchEvent(new PointerEvent('lostpointercapture',{ bubbles:true, pointerId:1, pointerType:'mouse' })));
      await released(); await page.mouse.up(); await amount('0');
      await key('5').evaluate(node=>node.click()); await amount('5');
    });
    await run('pointercancel cancels without blocking a following AT click', async () => {
      await press('5');
      await key('5').evaluate(node=>node.dispatchEvent(new PointerEvent('pointercancel',{ bubbles:true, pointerId:1, pointerType:'mouse' })));
      await released(); await page.mouse.up(); await amount('0');
      await key('5').evaluate(node=>node.click()); await amount('5');
    });
    await run('window blur cancels the pending pointer gesture', async () => {
      await press('5'); await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
      await released(); await page.mouse.up(); await amount('0');
      await key('5').click(); await amount('5');
    });
    await run('hidden document cancels the pending pointer gesture', async () => {
      await press('5');
      await page.evaluate(()=>{ Object.defineProperty(document,'hidden',{ configurable:true, value:true }); document.dispatchEvent(new Event('visibilitychange')); });
      await released(); await page.mouse.up(); await amount('0');
      await page.evaluate(()=>{ delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      await key('5').click(); await amount('5');
    });
    await run('currency change cancels a held key and leaves the decimal usable', async () => {
      await press('5'); await page.locator('#currency').selectOption('USD');
      await released(); await page.mouse.up(); await amount('0');
      for (const value of ['1','.','2']) await key(value).click();
      await amount('1.2');
      assert.equal(await key('.').getAttribute('aria-label'),'Decimal point');
    });
    await run('view unmount cancels held input without a stale next activation', async () => {
      await press('5');
      await page.locator('.bottom-nav [data-view="history"]').evaluate(node=>node.click());
      await expect(page.locator('#keypad')).toHaveCount(0); await page.mouse.up();
      await page.locator('.bottom-nav [data-view="record"]').click();
      await amount('0'); await key('5').click(); await amount('5');
    });
    await run('secondary touch cannot enter a digit or cancel the primary', async () => {
      const cdp = await context.newCDPSession(page), p = await center('5'), extra = await center('7');
      const a = { x:p.x, y:p.y, id:11 }, b = { x:extra.x, y:extra.y, id:12 };
      try {
        await cdp.send('Input.dispatchTouchEvent',{ type:'touchStart', touchPoints:[a] });
        await expect(key('5')).toHaveAttribute('data-pressed','true');
        await cdp.send('Input.dispatchTouchEvent',{ type:'touchStart', touchPoints:[a,b] });
        await expect(key('7')).not.toHaveAttribute('data-pressed');
        await cdp.send('Input.dispatchTouchEvent',{ type:'touchEnd', touchPoints:[b] });
        await expect(key('5')).toHaveAttribute('data-pressed','true');
        await cdp.send('Input.dispatchTouchEvent',{ type:'touchEnd', touchPoints:[] });
        await amount('5'); assert.equal(await page.evaluate(()=>window.__haptics),1);
      } finally { await cdp.detach(); }
    });
    await run('a secondary touch released after the primary stays ignored', async () => {
      const cdp=await context.newCDPSession(page), p=await center('5'), extra=await center('7');
      const a={x:p.x,y:p.y,id:21}, b={x:extra.x,y:extra.y,id:22};
      try {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a,b]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[a]});
        await amount('5'); await released();
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[b]});
        await amount('5'); await key('1').tap(); await amount('51');
        assert.equal(await page.evaluate(()=>window.__haptics),2);
      } finally {await cdp.detach();}
    });
    await run('only the cap moves while the outer button keeps its hitbox', async () => {
      const p=await center('5'); await press('5');
      await page.waitForTimeout(130);
      const held=await key('5').boundingBox();
      for (const dimension of ['x','y','width','height']) assert.ok(Math.abs(held[dimension]-p.box[dimension])<0.01,`${dimension} changed during press`);
      assert.equal(await key('5').locator(':scope > .key-cap > .key-label').innerText(),'5');
      await page.mouse.up(); await amount('5');
    });
    await run('eight immediate clicks each enter once with eight haptics', async () => {
      for (const value of '12345678') {
        const p = await center(value); await page.mouse.click(p.x,p.y);
      }
      await amount('12,345,678');
      assert.equal(await page.evaluate(()=>window.__haptics),8);
    });
    await run('Enter and Space use one native activation per physical press', async () => {
      await page.locator('[data-category="stomach"]').click(); await key('5').focus();
      await page.keyboard.down('Enter'); await amount('5'); await expect(key('5')).toHaveAttribute('data-pressed','true');
      await page.keyboard.down('Enter'); await amount('5');
      await page.keyboard.up('Enter'); await amount('5'); await released();
      await page.keyboard.down(' '); await expect(key('5')).toHaveAttribute('data-pressed','true');
      await page.keyboard.down(' '); await amount('5');
      await page.keyboard.up(' '); await amount('55'); await released();
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1'))?.expenses?.length||0),0);
      assert.equal(await key('5').getAttribute('aria-pressed'),null);
    });
    await run('Space cancelled by blur never inserts on its later keyup', async () => {
      await key('5').focus(); await page.keyboard.down(' '); await key('5').evaluate(node=>node.blur());
      await released(); await page.keyboard.up(' '); await amount('0');
    });
    await run('Space cancelled while hidden cannot activate on return', async () => {
      await key('5').focus(); await page.keyboard.down(' ');
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
      await released();
      await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
      await page.keyboard.up(' '); await amount('0');
      await key('5').evaluate(node=>node.click()); await amount('5');
    });
    await run('AT clicks work immediately after valid and cancelled pointer gestures', async () => {
      await key('5').click(); await key('5').evaluate(node=>node.click()); await amount('55');
      const p=await press('5'); await page.mouse.move(p.box.x-12,p.y); await page.mouse.up();
      await key('5').evaluate(node=>node.click()); await amount('555');
    });
    for (const source of ['AT','digit','Enter','Space']) for (const value of ['7','3']) {
      await run(`${source} activation on ${value === '7' ? 'the held' : 'another'} key cancels pending pointer input`, async () => {
        await press('7');
        if (source === 'AT') await key(value).evaluate(node=>node.click());
        else if (source === 'digit') await page.keyboard.press(value);
        else {
          await key(value).focus();
          await page.keyboard.press(source === 'Space' ? ' ' : 'Enter');
        }
        await amount(value); await released();
        await expect(key(value)).toHaveAttribute('data-input','keyboard');
        await page.mouse.up(); await amount(value); await released();
        assert.equal(await page.evaluate(()=>window.__haptics),1);
        await key('1').click(); await amount(value+'1');
        await expect(key('1')).toHaveAttribute('data-input','pointer');
        await key('2').evaluate(node=>node.click()); await amount(value+'12');
        await expect(key('2')).toHaveAttribute('data-input','keyboard');
        assert.equal(await page.evaluate(()=>window.__haptics),3);
      });
    }
    await run('physical shortcuts preserve decimals, backspace and clear without intercepting editing', async () => {
      await page.evaluate(()=>document.activeElement?.blur());
      await page.keyboard.press('1'); await page.keyboard.press('2'); await amount('12');
      await page.keyboard.press('Backspace'); await amount('1'); await page.keyboard.press('Delete'); await amount('0');
      await page.locator('#currency').selectOption('USD'); await page.evaluate(()=>document.activeElement?.blur());
      await page.keyboard.type('1.25'); await amount('1.25');
      await page.locator('[data-category="stomach"]').click();
      await page.locator('#edit-note').click(); await page.locator('#note').fill('12'); await page.keyboard.press('Backspace');
      await expect(page.locator('#note')).toHaveValue('1'); await amount('1.25');
      await expect(page.locator('.note-submit')).toBeEnabled();
      await page.locator('.note-submit').click();
      await expect(page.locator('#note')).toHaveCount(0);
      await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1'))?.expenses?.length || 0)).toBe(1);
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).expenses[0].note),'1');
      await amount('0');
      await page.evaluate(()=>{ const input=document.createElement('div'); input.contentEditable='true'; input.id='keypad-editable-probe'; document.body.append(input); input.focus(); });
      await page.keyboard.type('3'); await expect(page.locator('#keypad-editable-probe')).toHaveText('3'); await amount('0');
      await page.locator('#keypad-editable-probe').evaluate(node=>node.remove());
    });
    await run('IME, modified keys and ARIA input controls do not change the amount', async () => {
      await page.evaluate(()=>{
        document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'7',bubbles:true,isComposing:true}));
        for(const modifier of ['ctrlKey','metaKey','altKey']) document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'8',bubbles:true,[modifier]:true}));
      });
      await amount('0'); await released();
      for(const role of ['textbox','slider','combobox']) {
        await page.evaluate(role=>{const input=document.createElement('div');input.id='keypad-role-probe';input.setAttribute('role',role);input.tabIndex=0;document.body.append(input);input.focus();},role);
        await page.keyboard.press('7'); await amount('0');
        await page.locator('#keypad-role-probe').evaluate(node=>node.remove());
      }
      await key('5').focus();
      await key('5').dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});
      await released(); await amount('0');
    });

    assert.deepEqual(errors,[]);
    console.log(`PASS: ${checks.length} keypad interaction checks; no page errors`);
    await context.close();
  } finally { await browser.close(); await server.close(); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
