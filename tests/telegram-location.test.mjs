import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.mjs';
import { createExpenseParser } from '../ai.mjs';
import { handleDomain } from '../domain.mjs';
import { BOT_COPY } from '../bot-i18n.mjs';
import { createTelegramHandler, LOCATION_TTL } from '../telegram-ai.mjs';

const at = Date.parse('2026-10-11T03:00:00.000Z');
const point = { latitude: 35.6595, longitude: 139.7005 };
const message = (id, text = '', user = 101, language = 'zh') => ({ update_id: id, message: {
  message_id: id, date: Math.floor(at / 1000), chat: { id: user, type: 'private' },
  from: { id: user, first_name: `User ${user}`, language_code: language }, text,
} });
const venue = (id, title = '罗森便利店 涩谷店', user = 101, language = 'zh') => {
  const update = message(id, '', user, language);
  update.message.venue = { location: { ...point }, title, address: '东京都涩谷区' };
  return update;
};
const location = id => { const update = message(id); update.message.location = { ...point }; return update; };
const callback = (id, draftId, action = 'confirm', user = 101, chatId = user) => ({ update_id: id, callback_query: {
  id: `query-${id}`, from: { id: user }, data: `fp:${action}:${draftId}`,
  message: { message_id: 5, chat: { id: chatId, type: 'private' } },
} });

async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-location-bot-'));
  const store = createStore(dataDir), calls = [], aiCalls = [], locations = [];
  const parser = { async parse(input, settings) {
    aiCalls.push({ input, settings });
    return { items: [{ type: 'expense', amountMinor: 188, currency: 'JPY', categoryId: 'stomach',
      merchant: 'Nearby guessed merchant', note: '', occurredAt: new Date(at).toISOString(), timezone: 'Asia/Tokyo' }] };
  } };
  const options = { store, aiParser: parser, now: () => at,
    callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 5 }; },
    resolveLocation: async (input, settings) => { locations.push({ input, settings }); return { ...input, countryCode: 'JP', area: '涩谷', name: 'Neighboring shop' }; },
    ...extra };
  const handler = createTelegramHandler(options);
  t.after(async () => {
    handler.close(); await store.close();
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-location-bot-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { handler, store, calls, aiCalls, locations, options, dataDir,
    database: async () => { await store.flush(); return JSON.parse(await readFile(path.join(dataDir, '_pocket-v2.json'), 'utf8')); } };
}

test('venue then numeric amount preserves explicit place and time, requires confirmation, and saves once', async t => {
  const f = await fixture(t, { autoConfirm: true });
  const received = await f.handler.handle(venue(1));
  assert.equal(received.kind, 'location');
  assert.equal(f.aiCalls.length, 0);
  assert.match(f.calls.at(-1).params.text, /罗森便利店 涩谷店/);
  assert.equal((await f.handler.handle(venue(1))).duplicate, true);
  assert.equal(f.locations.length, 1);
  const draft = await f.handler.handle(message(2, '850'));
  assert.equal(draft.kind, 'draft');
  assert.equal(f.aiCalls[0].input.locationContext.name, '罗森便利店 涩谷店');
  assert.equal(f.aiCalls[0].input.locationContext.address, '东京都涩谷区');
  assert.equal(f.aiCalls[0].input.defaultCurrency, 'JPY');
  assert.match(f.calls.at(-1).params.text, /JPY ¥850/);
  assert.match(f.calls.at(-1).params.text, /📍.*罗森便利店/);
  assert.equal((await f.database()).ledgers['101'].expenses.length, 0);
  assert.equal((await f.handler.handle(callback(3, draft.draftId))).kind, 'confirmed');
  assert.equal((await f.handler.handle(callback(4, draft.draftId))).kind, 'already');
  const db = await f.database(), saved = db.ledgers['101'].expenses;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].amountMinor, 850);
  assert.equal(saved[0].occurredAt, new Date(at).toISOString());
  assert.deepEqual(saved[0].location, { lat: point.latitude, lng: point.longitude,
    name: '罗森便利店 涩谷店', address: '东京都涩谷区', countryCode: 'JP', area: '涩谷' });
  assert.equal(Object.keys(db.telegram.locations).length, 0);
  await f.handler.handle(message(5, '900'));
  assert.equal(f.aiCalls.at(-1).input.locationContext, undefined);
});

test('location amounts use the synced ledger timezone, not the process or model timezone', async t => {
  for (const source of ['venue', 'location']) await t.test(source, async t => {
    const f = await fixture(t, { timezone: 'Asia/Tokyo' });
    await f.handler.handle(source === 'venue' ? venue(600) : location(600));
    await f.store.run(db => handleDomain(db, '101', '/timezone', 'PUT', {
      timezone: 'America/Los_Angeles', ledgerId: '101',
    }, { now: at, limit() {} }));
    const result = await f.handler.handle(message(601, '850'));
    assert.equal(result.kind, 'draft');
    assert.equal(f.aiCalls[0].input.timezone, 'America/Los_Angeles');
    assert.equal(f.aiCalls[0].settings.timezone, 'America/Los_Angeles');
    const item = (await f.database()).telegram.drafts[result.draftId].items[0].expense;
    assert.equal(item.timezone, 'America/Los_Angeles');
    assert.equal(item.occurredAt, new Date(at).toISOString());
    assert.equal((await f.handler.handle(callback(602, result.draftId))).kind, 'confirmed');
    const saved = (await f.database()).ledgers['101'].expenses[0];
    assert.equal(saved.dayKey, '2026-10-10');
    assert.equal(saved.timezone, 'America/Los_Angeles');
  });
});

test('country currency and common decimal/thousands formats are exact even if model suggests another amount', async t => {
  const f = await fixture(t, { resolveLocation: async input => ({ ...input, countryCode: 'CN' }) });
  await f.handler.handle(location(10));
  const draft = await f.handler.handle(message(11, '12,50'));
  const item = (await f.database()).telegram.drafts[draft.draftId].items[0].expense;
  assert.equal(item.amountMinor, 1250);
  assert.equal(item.currency, 'CNY');
  assert.equal(f.aiCalls.at(-1).input.defaultCurrency, 'CNY');
  assert.equal(f.aiCalls.at(-1).settings.currency, 'CNY');
  for (const [index, amount] of ['1,234.50', '1.234,50', '1 234,50', '１２３４．５０'].entries()) {
    await f.handler.handle(location(20 + index * 2));
    const result = await f.handler.handle(message(21 + index * 2, amount));
    assert.equal((await f.database()).telegram.drafts[result.draftId].items[0].expense.amountMinor, 123450);
  }
});

test('malformed amounts do not consume the place and JPY fractional money is never silently rounded', async t => {
  const f = await fixture(t);
  await f.handler.handle(location(30));
  for (const [index, amount] of ['850.50', '0', '1,2,3'].entries()) {
    assert.equal((await f.handler.handle(message(31 + index, amount))).reason, 'location-amount-invalid');
  }
  assert.equal(f.aiCalls.length, 0);
  const result = await f.handler.handle(message(35, '1,250'));
  assert.equal(result.kind, 'draft');
  assert.equal((await f.database()).telegram.drafts[result.draftId].items[0].expense.amountMinor, 1250);
});

test('invalid coordinates clear old location, while lookup rejection or timeout keeps valid coordinates', async t => {
  const f = await fixture(t);
  await f.handler.handle(location(40));
  const invalid = location(41); invalid.message.location.latitude = 91;
  assert.equal((await f.handler.handle(invalid)).reason, 'invalid-location');
  assert.equal(f.locations.length, 1);
  assert.equal(Object.keys((await f.database()).telegram.locations).length, 0);
  await f.handler.handle(message(42, '850'));
  assert.equal(f.aiCalls.at(-1).input.locationContext, undefined);
  for (const resolveLocation of [async () => { throw new Error('lookup offline'); }, () => new Promise(() => {})]) {
    const other = await fixture(t, { resolveLocation, locationResolveTimeout: 5 });
    assert.equal((await other.handler.handle(location(43))).kind, 'location');
    const result = await other.handler.handle(message(44, '850'));
    assert.equal(result.kind, 'draft');
    assert.deepEqual(other.aiCalls[0].input.locationContext, { lat: point.latitude, lng: point.longitude });
    assert.equal(other.aiCalls[0].input.defaultCurrency, 'JPY');
  }
});

test('location is scoped to the account and expires; unrelated text and /cancel discard it', async t => {
  let clock = at;
  const f = await fixture(t, { now: () => clock });
  await f.handler.handle(venue(50));
  await f.handler.handle(message(51, '850', 202));
  assert.equal(f.aiCalls.at(-1).input.locationContext, undefined);
  assert.equal(Object.keys((await f.database()).telegram.locations).length, 1);
  clock += LOCATION_TTL + 1;
  await f.handler.handle(message(52, '850'));
  assert.equal(f.aiCalls.at(-1).input.locationContext, undefined);
  await f.handler.handle(venue(53));
  await f.handler.handle(message(54, 'yesterday books 900'));
  assert.equal(f.aiCalls.at(-1).input.locationContext, undefined);
  await f.handler.handle(message(55, '850'));
  assert.equal(f.aiCalls.at(-1).input.locationContext, undefined);
  await f.handler.handle(venue(56));
  await f.handler.handle(message(57, '/cancel'));
  assert.equal(Object.keys((await f.database()).telegram.locations).length, 0);
});

test('changing ledger invalidates pending places and already-previewed locations cannot cross ledgers', async t => {
  const f = await fixture(t);
  await f.handler.handle(venue(60));
  const profile = await f.store.run(db => handleDomain(db, '101', '/circles/create', 'POST', { name: 'Travel' }, { now: at, limit() {} }));
  await f.handler.handle(message(61, '850'));
  assert.ok(!f.aiCalls.at(-1)?.input.locationContext);
  await f.handler.handle(venue(62));
  await f.store.run(db => handleDomain(db, '101', '/circles/switch', 'POST', { circleId: null }, { now: at, limit() {} }));
  await f.store.run(db => handleDomain(db, '101', '/circles/switch', 'POST', { circleId: profile.social.activeCircleId }, { now: at, limit() {} }));
  await f.handler.handle(message(63, '850'));
  assert.ok(!f.aiCalls.at(-1)?.input.locationContext);
  await f.handler.handle(venue(64));
  const draft = await f.handler.handle(message(65, '850'));
  await f.store.run(db => handleDomain(db, '101', '/circles/switch', 'POST', { circleId: null }, { now: at, limit() {} }));
  assert.equal((await f.handler.handle(callback(66, draft.draftId))).kind, 'errorLedgerChanged');
  const db = await f.database();
  assert.ok(Object.values(db.ledgers).every(ledger => ledger.expenses.length === 0));
});

test('editing a location draft retains place context while still requiring confirmation', async t => {
  const f = await fixture(t, { autoConfirm: true });
  await f.handler.handle(venue(70));
  const draft = await f.handler.handle(message(71, '850'));
  assert.equal((await f.handler.handle(callback(72, draft.draftId, 'edit'))).kind, 'editing');
  const revised = await f.handler.handle(message(73, '900'));
  assert.equal(revised.kind, 'draft');
  assert.equal(f.aiCalls.at(-1).input.locationContext.name, '罗森便利店 涩谷店');
  assert.equal(f.aiCalls.at(-1).input.previousRecords[0].location.name, '罗森便利店 涩谷店');
  assert.equal((await f.handler.handle(callback(74, draft.draftId))).kind, 'cancelled');
  assert.equal((await f.handler.handle(callback(75, revised.draftId))).kind, 'confirmed');
  assert.equal((await f.database()).ledgers['101'].expenses[0].location.name, '罗森便利店 涩谷店');
});

test('location language follows the sender and group or edited live-location updates are ignored', async t => {
  const f = await fixture(t);
  for (const [index, language] of ['zh', 'en', 'uk'].entries()) {
    const user = 110 + index, id = 80 + index * 2;
    await f.handler.handle(venue(id, 'Coffee', user, language));
    const prompt = f.calls.at(-1).params.text;
    assert.equal(prompt, BOT_COPY[language].locationReceived.replace('{name}', '涩谷 · Coffee'));
    await f.handler.handle(message(id + 1, '850', user, language));
    assert.equal(f.aiCalls.at(-1).input.language, language);
    assert.match(f.calls.at(-1).params.text, new RegExp(BOT_COPY[language].previewTitle));
  }
  const group = venue(87); group.message.chat.type = 'group';
  assert.equal((await f.handler.handle(group)).kind, 'ignored');
  const edited = venue(88); edited.edited_message = edited.message; delete edited.message;
  assert.equal((await f.handler.handle(edited)).kind, 'ignored');
  assert.equal(f.locations.length, 3);
});

test('pending location survives handler restart; numeric update delivery retry uses one persisted draft', async t => {
  const f = await fixture(t);
  await f.handler.handle(venue(90)); await f.store.flush();
  const restartedStore = createStore(f.dataDir);
  let fail = true;
  const restarted = createTelegramHandler({ ...f.options, store: restartedStore, callTelegram: async (method, params) => {
    if (fail && method === 'sendMessage') { fail = false; throw new Error('Telegram delivery timeout'); }
    f.calls.push({ method, params }); return { message_id: 5 };
  } });
  t.after(async () => { restarted.close(); await restartedStore.close(); });
  assert.equal((await restarted.handle(message(91, '850'))).retryable, true);
  const draft = await restarted.handle(message(91, '850'));
  assert.equal(draft.kind, 'draft');
  assert.equal(f.aiCalls.length, 1);
  assert.equal((await restarted.handle(callback(92, draft.draftId))).kind, 'confirmed');
  await restartedStore.flush();
  const db = await f.database();
  assert.equal(db.ledgers['101'].expenses.length, 1);
  assert.equal(db.ledgers['101'].expenses[0].location.name, '罗森便利店 涩谷店');
  assert.equal(Object.keys(db.telegram.locations).length, 0);
});

test('late reverse lookup cannot overwrite a newer shared location', async t => {
  let finish;
  const started = new Promise(resolve => { finish = resolve; });
  let release;
  const f = await fixture(t, { resolveLocation: input => {
    if (input.name === 'Old cafe') { finish(); return new Promise(resolve => { release = resolve; }); }
    return Promise.resolve({ ...input, countryCode: 'US' });
  } });
  const old = f.handler.handle(venue(100, 'Old cafe'));
  await started;
  assert.equal((await f.handler.handle(venue(101, 'New cafe'))).kind, 'location');
  release({ countryCode: 'JP', name: 'Old cafe' });
  assert.equal((await old).kind, 'location-superseded');
  const draft = await f.handler.handle(message(102, '8.50'));
  const expense = (await f.database()).telegram.drafts[draft.draftId].items[0].expense;
  assert.equal(expense.location.name, 'New cafe');
  assert.equal(expense.currency, 'USD');
  assert.equal(expense.amountMinor, 850);
});

test('out-of-order location and numeric updates cannot replace or consume a newer place', async t => {
  const f = await fixture(t);
  await f.handler.handle(venue(120, 'New cafe'));
  assert.equal((await f.handler.handle(venue(119, 'Old cafe'))).kind, 'location-superseded');
  await f.handler.handle(message(118, '500'));
  assert.equal(f.aiCalls.at(-1).input.locationContext, undefined);
  const result = await f.handler.handle(message(121, '850'));
  assert.equal(result.kind, 'draft');
  assert.equal(f.aiCalls.at(-1).input.locationContext.name, 'New cafe');
});

test('older nonnumeric messages and cancel commands cannot clear a newer shared venue', async t => {
  const f = await fixture(t);
  await f.handler.handle(venue(125, 'New cafe'));
  await f.handler.handle(message(123, 'books 500'));
  await f.handler.handle(message(124, '/cancel'));
  const pending = Object.values((await f.database()).telegram.locations);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].location.name, 'New cafe');
  const result = await f.handler.handle(message(126, '850'));
  assert.equal(result.kind, 'draft');
  assert.equal(f.aiCalls.at(-1).input.locationContext.name, 'New cafe');
  assert.equal((await f.database()).telegram.drafts[result.draftId].items[0].expense.amountMinor, 850);
});

test('Telegram horizontal accuracy is used only for lookup, never stored on the expense', async t => {
  const f = await fixture(t);
  const update = location(130); update.message.location.horizontal_accuracy = 12;
  await f.handler.handle(update);
  assert.equal(f.locations[0].input.accuracy, 12);
  const result = await f.handler.handle(message(131, '850'));
  assert.equal((await f.database()).telegram.drafts[result.draftId].items[0].expense.location.accuracy, undefined);
});

test('real parser maps convenience-store numeric entry to food and never sends precise GPS to model', async t => {
  const requests = [];
  const aiParser = createExpenseParser({ modelClient: { async generateContent(request) {
    requests.push(request);
    return { response: { candidates: [{ content: { parts: [{ text: JSON.stringify([{
      amount: 999, currency: 'USD', type: 'expense', categoryId: 'other', categoryLabel: '其他',
      merchant: 'Fake shop', note: 'Invented purchase', rawText: '850',
      occurredAt: '2026-09-01T01:00:00Z', timezone: 'UTC', confidence: 0.8,
      consumer: '', splitMode: 'none', splitParticipants: [], recordKind: 'purchase',
      needsReview: false, reviewReason: '', detectedLanguage: 'en', currencyExplicit: false,
    }]) }] } }] } };
  } } });
  const f = await fixture(t, { aiParser });
  await f.handler.handle(venue(140));
  const draft = await f.handler.handle(message(141, '850'));
  assert.equal(draft.kind, 'draft');
  const item = (await f.database()).telegram.drafts[draft.draftId].items[0];
  assert.equal(item.expense.categoryId, 'stomach');
  assert.equal(item.expense.amountMinor, 850);
  assert.equal(item.expense.currency, 'JPY');
  assert.equal(item.expense.consumer, 'u_101');
  assert.equal(item.merchant, '罗森便利店 涩谷店');
  assert.equal(item.expense.occurredAt, new Date(at).toISOString());
  assert.ok(!JSON.stringify(requests).includes(String(point.latitude)));
  assert.ok(!JSON.stringify(requests).includes(String(point.longitude)));
  assert.equal((await f.handler.handle(callback(142, draft.draftId, 'confirm', 202, 101))).kind, 'missing');
  assert.equal((await f.database()).ledgers['101'].expenses.length, 0);
});

test('a numeric reply during reverse lookup waits for the country once before parsing currency', async t => {
  let markStarted, release;
  const started = new Promise(resolve => { markStarted = resolve; });
  let lookups = 0;
  const f = await fixture(t, { resolveLocation: input => {
    lookups++;
    markStarted();
    return new Promise(resolve => { release = () => resolve({ ...input, countryCode: 'US', area: 'Seattle' }); });
  } });
  const locationResult = f.handler.handle(location(150));
  await started;
  const amountResult = f.handler.handle(message(151, '8.50'));
  // Let both messages reach their asynchronous boundary before lookup settles.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.aiCalls.length, 0);
  release();
  assert.equal((await locationResult).kind, 'location');
  const draft = await amountResult;
  assert.equal(draft.kind, 'draft');
  assert.equal(lookups, 1);
  assert.equal(f.aiCalls.length, 1);
  assert.equal(f.aiCalls[0].input.defaultCurrency, 'USD');
  assert.equal(f.aiCalls[0].input.locationContext.area, 'Seattle');
  const expense = (await f.database()).telegram.drafts[draft.draftId].items[0].expense;
  assert.equal(expense.amountMinor, 850);
  assert.equal(expense.currency, 'USD');
  assert.equal((await f.handler.handle(callback(152, draft.draftId))).kind, 'confirmed');
  assert.equal((await f.handler.handle(callback(153, draft.draftId))).kind, 'already');
  assert.equal((await f.database()).ledgers['101'].expenses.length, 1);
});

test('a session interrupted during lookup resumes after restart before accepting a foreign decimal', async t => {
  const f = await fixture(t, { resolveLocation: async input => ({ ...input, countryCode: 'CN' }) });
  await f.handler.handle(location(160));
  await f.store.run(db => {
    const pending = db.telegram.locations['101:101'];
    pending.status = 'resolving';
    pending.location = { lat: point.latitude, lng: point.longitude };
  });
  await f.store.flush();
  const restartedStore = createStore(f.dataDir);
  let lookupCount = 0;
  const restarted = createTelegramHandler({ ...f.options, store: restartedStore,
    resolveLocation: async input => { lookupCount++; return { ...input, countryCode: 'CN' }; } });
  t.after(async () => { restarted.close(); await restartedStore.close(); });
  const draft = await restarted.handle(message(161, '12,50'));
  await restartedStore.flush();
  assert.equal(draft.kind, 'draft');
  assert.equal(lookupCount, 1);
  const expense = (await f.database()).telegram.drafts[draft.draftId].items[0].expense;
  assert.equal(expense.currency, 'CNY');
  assert.equal(expense.amountMinor, 1250);
});

test('a concurrent numeric reply is rejected without rounding when resolved currency is JPY', async t => {
  let markStarted, release;
  const started = new Promise(resolve => { markStarted = resolve; });
  const f = await fixture(t, { resolveLocation: input => {
    markStarted();
    return new Promise(resolve => { release = () => resolve({ ...input, countryCode: 'JP' }); });
  } });
  const first = f.handler.handle(location(170));
  await started;
  const second = f.handler.handle(message(171, '850.50'));
  await new Promise(resolve => setImmediate(resolve));
  release();
  await first;
  assert.equal((await second).reason, 'location-amount-invalid');
  assert.equal(f.aiCalls.length, 0);
  assert.equal(Object.keys((await f.database()).telegram.locations).length, 1);
});
