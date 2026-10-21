const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { expect } = require('playwright/test');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'outputs/category-materials');

async function loaded(image) {
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  assert.match(await image.getAttribute('src'), /\.webp(?:\?|$)/);
  assert.equal(await image.getAttribute('alt'), '');
  assert.equal(await image.evaluate(node => getComputedStyle(node).pointerEvents), 'none');
}
async function layout(page, label) {
  await page.evaluate(() => document.fonts.ready);
  await page.locator('main').evaluateAll(nodes => Promise.all(nodes.flatMap(node => node.getAnimations()
    .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map(animation => animation.finished.catch(() => {})))));
  const metrics = await page.evaluate(() => ({
    width:innerWidth, content:document.documentElement.scrollWidth,
    font:getComputedStyle(document.querySelector('.for-root')).fontFamily,
    loaded:document.fonts.check('600 14px "Pocket Nunito"', document.documentElement.lang==='uk' ? 'Українська' : 'English'),
  }));
  assert.ok(metrics.content <= metrics.width + 1, label + ': horizontal page overflow');
  assert.ok(metrics.font.includes('Pocket Nunito') && metrics.loaded, label + ': bundled font not loaded');
  if(label.endsWith('-record')) {
    const category=await page.locator('[data-category="stomach"]').evaluate(node=>({html:node.outerHTML,box:node.getBoundingClientRect().toJSON(),children:[...node.children].map(child=>({text:child.textContent,box:child.getBoundingClientRect().toJSON(),fontSize:getComputedStyle(child).fontSize,display:getComputedStyle(child).display}))}));
    fs.writeFileSync(path.join(OUTPUT,label+'-geometry.json'),JSON.stringify(category,null,2));
    assert.ok(category.children[1].box.width>8 && category.children[1].box.height>8, 'Category text must stay visible beside its illustration');
  }
  await page.screenshot({path:path.join(OUTPUT, label + '.png'),fullPage:true});
}

(async () => {
  const { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES } = await import(pathToFileURL(path.join(ROOT,'public/shared.mjs')));
  const presets = [...DEFAULT_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES];
  for (const category of presets) assert.ok(fs.existsSync(path.join(ROOT, 'public/assets/category-art-v1', category.id + '.webp')), 'Missing runtime art: ' + category.id);
  const { createServer } = await import(pathToFileURL(path.join(ROOT,'node_modules/vite/dist/node/index.js')));
  const server = await createServer({configFile:false,root:ROOT,publicDir:false,logLevel:'error',
    server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({headless:true});
  const errors = [], requests = new Set(), results = [];
  fs.mkdirSync(OUTPUT,{recursive:true});
  async function isolate(context, broken=false) {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      requests.add(url.href);
      if (url.origin !== base) return route.fulfill({body:''});
      if (url.pathname === '/api/config') return route.fulfill({json:{mode:'local'}});
      if (url.pathname.startsWith('/api/')) return route.fulfill({status:503,json:{error:'Local fixture only'}});
      if (broken && route.request().resourceType()==='image' && url.pathname.endsWith('/stomach.webp')) return route.abort();
      return route.continue();
    });
  }
  try {
    for (const [width,height,language] of [[320,568,'zh'],[320,568,'en'],[390,844,'en'],[430,932,'uk'],[1024,768,'uk']]) {
      const context = await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:width<600});
      await isolate(context);
      const page = await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base);
      await expect(page.locator('#keypad [data-key="8"]')).toBeEnabled();
      await page.locator('#open-settings').tap();
      await page.locator('#language').selectOption(language);
      // Use the whole current value, not only its chevron, to open the theme chooser.
      await page.locator('.theme-open span').tap();
      await page.locator('[data-theme-option="sea"]').tap();
      await expect(page.locator('.theme-sheet')).toHaveCount(0);
      const theme = await page.locator('.settings-theme-value').evaluate(node=>({
        height:node.getBoundingClientRect().height,
        overflow:getComputedStyle(node.querySelector('span')).textOverflow,
        scroll:node.querySelector('span').scrollWidth,width:node.querySelector('span').clientWidth,
      }));
      assert.ok(theme.height >= 44 && theme.overflow !== 'ellipsis' && theme.scroll <= theme.width + 1, 'Theme name must remain readable and tappable');
      if(language==='en') assert.ok(await page.locator('label[for="sound-choice"] > span').evaluate(node=>node.getBoundingClientRect().height<22), 'Key sounds label must not be squeezed by unused select space');
      await layout(page, `${language}-${width}-settings`);
      await page.locator('.bottom-nav [data-view="record"]').tap();
      const images = page.locator('#categories [data-category-art]');
      await expect(images).toHaveCount(30);
      if (width===320 && language==='zh') {
        for (let index=0;index<30;index++) await loaded(images.nth(index));
        await page.locator('.type-toggle-pill .type-pill-btn').nth(1).tap();
        await expect(images).toHaveCount(6);
        for (let index=0;index<6;index++) await loaded(images.nth(index));
        await page.locator('.type-toggle-pill .type-pill-btn').first().tap();
        await expect(images).toHaveCount(30);
      }
      await page.locator('[data-category="stomach"]').tap();
      for (const digit of '850') await page.locator(`#keypad [data-key="${digit}"]`).tap();
      await layout(page, `${language}-${width}-record`);
      const size = await page.locator('#categories [data-category="stomach"]').boundingBox();
      assert.ok(size.height >= 40 && size.height <= 48, 'Picture must not enlarge the category row');
      if(width<600) assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1), 'Home must fit one mobile screen');
      await page.locator('.mascot-confirm').tap();
      await expect(page.locator('#amount-display')).toHaveText('0');
      await page.locator('.bottom-nav [data-view="history"]').tap();
      await loaded(page.locator('.expense-row [data-category-art="stomach"]'));
      await layout(page, `${language}-${width}-history`);
      const more = await page.locator('.entry-more').boundingBox();
      const moreIcon = await page.locator('.entry-more .for-icon').boundingBox();
      assert.ok(more.width>=44 && more.height>=44 && moreIcon.x>=more.x && moreIcon.x+moreIcon.width<=more.x+more.width, 'Ledger actions must retain a complete icon and 44px target');
      await page.locator('.entry-more').tap();
      await page.locator('.swipe-action').last().tap();
      await loaded(page.locator('.entry-editor [data-category-art="stomach"]'));
      await page.locator('#edit-entry-note').fill('Ramen fixture');
      await layout(page, `${language}-${width}-edit`);
      await page.locator('.entry-editor button[type="submit"]').tap();
      await expect(page.locator('.entry-editor')).toHaveCount(0);
      await expect(page.locator('.expense-note')).toHaveText('Ramen fixture');

      if(width===320 && language==='zh') {
        // A new icon is an explicit user choice; historical snapshots must keep their original picture.
        await page.locator('.bottom-nav [data-view="record"]').tap();
        await page.locator('#edit-categories').tap();
        const row=page.locator('.editor-row').first();
        await loaded(row.locator('[data-category-art="stomach"]'));
        await row.locator('.editor-icon-trigger').tap();
        await row.locator('select').nth(1).selectOption('blue');
        await expect(row.locator('[data-category-art]')).toHaveCount(0);
        assert.notEqual(await row.locator('.editor-icon-trigger').evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)','A custom color must remain visible');
        await row.locator('select').first().selectOption('heart');
        await expect(row.locator('[data-category-art]')).toHaveCount(0);
        await expect(row.locator('.editor-icon-trigger .for-icon')).toHaveCount(2);
        await page.locator('#category-form button[type="submit"]').tap();
        await expect(page.locator('[data-category="stomach"] img')).toHaveCount(0);
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('for-pocket.preview.v1')).settings.categories[0].color),'blue');
        await page.locator('.bottom-nav [data-view="history"]').tap();
        await loaded(page.locator('.expense-row [data-category-art="stomach"]'));
      }
      results.push({width,height,language,checked:['bundled font','theme value hit','home','saved ledger','edit','no overflow']});
      await context.close();
    }
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await isolate(context,true);
    const page=await context.newPage();
    await page.goto(base);
    await expect(page.locator('[data-category="stomach"] .for-icon')).toBeVisible();
    await expect(page.locator('[data-category="stomach"] img')).toHaveCount(0);
    await context.close();
    assert.deepEqual(errors,[]);
    assert.ok(![...requests].some(url=>/fonts\.(googleapis|gstatic)\.com/.test(url)), 'Fonts must not require a third party connection');
    assert.ok(![...requests].some(url=>url.includes('/category-art-v1/') && url.includes('.png')), 'Source originals must not load in the interface');
    assert.equal(new Set([...requests].filter(url=>url.includes('/category-art-v1/')&&url.endsWith('.webp')).map(url=>new URL(url).pathname)).size,36);
    fs.writeFileSync(path.join(OUTPUT,'results.json'),JSON.stringify({results,artCount:36,fallback:true,errors},null,2));
    console.log(JSON.stringify({ok:true,cases:results.length,artCount:36,fallback:true,artifacts:OUTPUT}));
  } finally {await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
