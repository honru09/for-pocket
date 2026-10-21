import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createExpenseParser } from '../ai.mjs';
import { initialSettings } from '../public/shared.mjs';
import { createStore } from '../store.mjs';
import { ensureUser, handleDomain } from '../domain.mjs';
import { createTelegramHandler } from '../telegram-ai.mjs';

const now = Date.parse('2026-10-11T01:00:00.000Z');
const rawItem = patch => ({
  amount:100, currency:'JPY', type:'expense', categoryId:'stomach', categoryLabel:'Food',
  merchant:'Lunch', note:'Lunch', rawText:'Lunch 100 JPY', occurredAt:'2026-10-11T01:00:00.000Z',
  timezone:'Asia/Tokyo', confidence:0.99, consumer:'u_101', splitMode:'none', splitParticipants:[],
  recordKind:'purchase', needsReview:false, reviewReason:'', detectedLanguage:'en', currencyExplicit:true,
  ...patch,
});
const parserFor = patch => createExpenseParser({ now:() => now, modelClient:{
  async generateContent() { return { response:{ candidates:[{ content:{ parts:[{ text:JSON.stringify([rawItem(patch)]) }] } }] } }; },
} });
const settingsFor = () => ({ ...initialSettings('en'), consumers:[
  { id:'u_101', name:'Owner', color:'blue', avatar:'cloud' },
  { id:'u_202', name:'Partner', color:'pink', avatar:'cloud' },
] });
async function parse(patch, settings = settingsFor()) {
  const [item] = await parserFor(patch).parse({ text:`Lunch ${patch.amount ?? 100} ${patch.currency || 'JPY'}`, timezone:'Asia/Tokyo', defaultConsumer:'u_101', now }, settings);
  return item;
}

test('nonzero excess currency decimals always require review, including decimal strings', async t => {
  for (const [amount, currency, amountMinor] of [
    [100.5, 'JPY', 101], [100.5, 'KRW', 101], [12.345, 'USD', 1235],
    [12.345, 'CNY', 1235], ['0.0100000000000000001', 'USD', 1],
  ]) await t.test(`${amount} ${currency}`, async () => {
    const item = await parse({ amount, currency });
    assert.equal(item.amountMinor, amountMinor);
    assert.equal(item.needsReview, true, 'server-side rounding cannot inherit model needsReview=false');
    assert.ok(item.reviewReason.includes(String(amount)), 'the original amount must remain available for review');
  });
});

test('exact minor units do not acquire false review flags from floating point or trailing zeros', async t => {
  for (const [amount, currency, amountMinor] of [
    [100, 'JPY', 100], ['100.000', 'JPY', 100], [0.01, 'USD', 1], [0.29, 'USD', 29],
    [1.1, 'CNY', 110], ['1.23000', 'USD', 123], [99999999, 'JPY', 99999999], [99999999.99, 'USD', 9999999999],
  ]) await t.test(`${amount} ${currency}`, async () => {
    const item = await parse({ amount, currency });
    assert.equal(item.amountMinor, amountMinor);
    assert.equal(item.needsReview, false);
  });
});

test('unknown, departed, repeated or discarded explicit split members require review', async t => {
  for (const [name, patch, expected] of [
    ['unknown name', { splitMode:'equal', splitParticipants:['u_101', 'Unknown friend'] }, ['u_101']],
    ['departed ID', { splitMode:'equal', splitParticipants:['u_101', 'u_departed'] }, ['u_101']],
    ['duplicate ID', { splitMode:'equal', splitParticipants:['u_101', 'u_202', 'u_202'] }, ['u_101', 'u_202']],
    ['same member by ID and name', { splitMode:'equal', splitParticipants:['u_101', 'Owner', 'u_202'] }, ['u_101', 'u_202']],
    ['non-split participants discarded', { splitMode:'none', splitParticipants:['u_101', 'u_202'] }, []],
    ['income split discarded', { type:'income', categoryId:'wage', splitMode:'equal', splitParticipants:['u_101', 'u_202'] }, []],
  ]) await t.test(name, async () => {
    const item = await parse(patch);
    assert.deepEqual(item.splitParticipants, expected);
    assert.equal(item.needsReview, true);
    assert.match(item.reviewReason, /split|member/i);
  });
  const lone = await parse({ splitMode:'equal', splitParticipants:['u_101'] }, { ...settingsFor(), consumers:settingsFor().consumers.slice(0, 1) });
  assert.equal(lone.splitMode, 'none');
  assert.equal(lone.needsReview, true, 'a split cannot silently become a personal purchase');
});

test('valid member names normalize to IDs without changing split meaning', async () => {
  const item = await parse({ splitMode:'equal', splitParticipants:['Owner', 'Partner'] });
  assert.deepEqual(item.splitParticipants, ['u_101', 'u_202']);
  assert.equal(item.needsReview, false);
});

test('duplicate nicknames are ambiguous, while an exact member ID stays valid', async () => {
  const settings = settingsFor();
  settings.consumers.forEach(member => { member.name = 'Same name'; });
  const ambiguous = await parse({ splitMode:'equal', splitParticipants:['u_101', 'Same name'] }, settings);
  assert.deepEqual(ambiguous.splitParticipants, ['u_101']);
  assert.equal(ambiguous.needsReview, true);
  const exact = await parse({ splitMode:'equal', splitParticipants:['u_101', 'u_202'] }, settings);
  assert.deepEqual(exact.splitParticipants, ['u_101', 'u_202']);
  assert.equal(exact.needsReview, false);
});

test('rounding never permits amounts below a minor unit or beyond the supported limit', async () => {
  for (const patch of [{ amount:0.1 }, { amount:0.001, currency:'USD' }, { amount:99999999.999, currency:'USD' }]) {
    await assert.rejects(parse(patch), { name:'AiError', message:'errorAiAmount', status:422 });
  }
});

test('real parser prevents lossy monetary or split normalization from Telegram auto-confirming', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-lossy-ai-'));
  const store = createStore(dataDir);
  let patch = {};
  const parser = createExpenseParser({ now:() => now, modelClient:{ async generateContent() {
    return { response:{ candidates:[{ content:{ parts:[{ text:JSON.stringify([rawItem(patch)]) }] } }] } };
  } } });
  const handler = createTelegramHandler({ store, aiParser:parser, token:'fixture-token', autoConfirm:true,
    now:() => now, callTelegram:async () => ({ message_id:7 }), publicUrl:'https://example.com' });
  t.after(async () => {
    handler.close(); await store.close();
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-lossy-ai-'));
    await rm(dataDir, { recursive:true, force:true });
  });
  await store.run(db => {
    ensureUser(db, 'telegram:101', { first_name:'Owner' });
    ensureUser(db, 'telegram:202', { first_name:'Partner' });
    const profile = handleDomain(db, '101', '/circles/create', 'POST', { name:'Us' }, { now, limit(){} });
    db.circles[profile.social.activeCircleId].members.push('202');
  });
  let id = 800;
  for (const next of [
    { amount:100.5 },
    { amount:12.345, currency:'USD' },
    { splitMode:'equal', splitParticipants:['u_101', 'Unknown friend'] },
    { splitMode:'equal', splitParticipants:['u_101', 'u_202', 'u_202'] },
  ]) {
    patch = next; id++;
    const result = await handler.handle({ update_id:id, message:{ message_id:id, chat:{ id:101, type:'private' }, from:{ id:101, first_name:'Owner', language_code:'en' }, text:`Lunch ${next.amount || 100} ${next.currency || 'JPY'}` } });
    assert.equal(result.kind, 'draft');
    assert.notEqual(result.auto, true);
    await store.run(db => {
      assert.equal(db.telegram.drafts[result.draftId].needsReview, true);
      assert.ok(Object.values(db.ledgers).every(ledger => ledger.expenses.length === 0));
    });
  }
});
