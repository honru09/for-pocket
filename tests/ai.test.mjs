import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { AiError, createExpenseParser, createExpenseSummarizer } from '../ai.mjs';
import { createApp } from '../server.mjs';
import { initialSettings } from '../public/shared.mjs';

const botToken = '123456:ai-api-test-fixture';
const now = Date.parse('2026-10-11T00:00:00.000Z');
const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const rawItem = (patch = {}) => ({ amount: 1200, currency: 'JPY', type: 'expense', categoryId: 'stomach', categoryLabel: '胃', merchant: 'Noodle shop', note: '拉面', rawText: '拉面 1200', occurredAt: '', timezone: 'Asia/Tokyo', confidence: 0.94, ...patch });
const parsedItem = (patch = {}) => ({ ...rawItem(), amountMinor: 1200, occurredAt: null, dayKey: null, source: 'text', ...patch });

function signed(id = 101) {
  const fields = { auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id, first_name: `User ${id}`, language_code: 'zh' }) };
  const check = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
}

function modelReturning(value, calls = []) {
  return { async generateContent(request) {
    calls.push(request);
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return { response: { candidates: [{ content: { parts: [{ text }] } }] } };
  } };
}

function useDefaultModels(t) {
  const keys = ['VERTEX_MODEL', 'VERTEX_TEXT_MODEL', 'VERTEX_VISION_MODEL', 'VERTEX_ENHANCED_MODEL', 'VERTEX_SUMMARY_MODEL', 'VERTEX_TEXT_FALLBACK_MODEL', 'VERTEX_VISION_FALLBACK_MODEL', 'VERTEX_SUMMARY_FALLBACK_MODEL'];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

async function fixture(t, parser) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-ai-test-'));
  const calls = [];
  const aiParser = parser || { enabled: true, async parse(input, settings) {
    calls.push({ input, settings });
    return [parsedItem(), parsedItem({ amount: 250, amountMinor: 250, note: '茶' })];
  } };
  const server = createApp({ token: botToken, dataDir, aiParser, now: () => now });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-ai-test-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  return {
    calls,
    database: async () => { await server.flushStore(); return JSON.parse(await readFile(path.join(dataDir, '_pocket-v2.json'), 'utf8')); },
    request: async (route, { user = 101, session, body, bytes, headers = {}, method = 'POST' } = {}) => {
      const response = await fetch(base + route, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session}` } : user ? { 'X-Telegram-Init-Data': signed(user) } : {}),
          ...headers,
        },
        body: bytes ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      return { status: response.status, data: await response.json() };
    },
  };
}

test('AI parser normalizes multi-item receipts, currency units, custom categories and optional fields', async () => {
  const calls = [], settings = initialSettings();
  settings.categories = [{ id: 'my_food', label: 'My lunch', icon: 'bowl', color: 'peach' }, settings.categories.at(-1)];
  const parser = createExpenseParser({ modelClient: modelReturning([
    rawItem({ amount: 12.34, currency: 'USD', categoryId: 'unknown', categoryLabel: 'My lunch', rawText:'2026/10/11 00:30 拉面 USD 12.34', occurredAt: '2026-10-10T15:30:00.000Z' }),
    rawItem({ amount: 5000, type: 'income', categoryId: 'salary', categoryLabel: 'Salary', timezone: 'not/a-zone', note: 'n'.repeat(200), rawText: 'r'.repeat(600) }),
  ], calls) });
  const items = await parser.parse({ text: 'receipt', image: { mimeType: 'image/png', data: imageBytes.toString('base64') }, timezone: 'Asia/Tokyo' }, settings);
  assert.equal(items.length, 2);
  assert.equal(items[0].amountMinor, 1234);
  assert.equal(items[0].amount, 12.34);
  assert.equal(items[0].categoryId, 'my_food');
  assert.equal(items[0].categoryLabel, 'My lunch');
  assert.equal(items[0].merchant, 'Noodle shop');
  assert.equal(items[0].dayKey, '2026-10-11');
  assert.equal(items[1].categoryId, 'wage', 'income must map within income categories');
  assert.equal(items[1].timezone, 'Asia/Tokyo');
  assert.equal(items[1].note.length, 160);
  assert.ok(items[1].rawText.length <= 400);
  assert.ok(items.every(item => item.source === 'image'));
  assert.deepEqual(calls[0].contents[0].parts.find(part => part.inlineData)?.inlineData, { mimeType: 'image/png', data: imageBytes.toString('base64') });
});

test('AI parser accepts fenced JSON and rejects unusable model data without fabricating an amount', async () => {
  const parser = createExpenseParser({ modelClient: modelReturning('```json\n' + JSON.stringify([rawItem({ timezone: 'bad-zone', occurredAt: 'yesterday' })]) + '\n```') });
  const items = await parser.parse({ text: 'lunch', timezone: 'Europe/Kyiv' }, initialSettings());
  assert.equal(items[0].timezone, 'Europe/Kyiv');
  assert.equal(items[0].occurredAt, null);
  assert.equal(items[0].source, 'text');
  for (const [raw, message, status] of [
    ['not JSON', 'errorAiResult', 502],
    [[rawItem({ amount: -10 })], 'errorAiAmount', 422],
    [[rawItem({ type: 'transfer' })], 'errorAiType', 422],
  ]) {
    const invalid = createExpenseParser({ modelClient: modelReturning(raw) });
    await assert.rejects(invalid.parse({ text: 'bad result', timezone: 'UTC' }, initialSettings()), { name: 'AiError', message, status });
  }
  const empty = createExpenseParser({ modelClient: modelReturning([]) });
  assert.deepEqual(await empty.parse({ text: 'no expense', timezone: 'UTC' }, initialSettings()), []);
});

test('AI parser selects the configured text and vision models and returns safe provider failures', async () => {
  const models = [];
  const parser = createExpenseParser({ projectId: 'fixture-project', textModel: 'fixture-text', visionModel: 'fixture-vision', vertex: { getGenerativeModel(config) {
    models.push(config.model);
    return modelReturning([rawItem()]);
  } } });
  await parser.parse({ text: 'lunch', timezone: 'UTC' }, initialSettings());
  await parser.parse({ image: { mimeType: 'image/png', data: imageBytes.toString('base64') }, timezone: 'UTC' }, initialSettings());
  assert.deepEqual(models, ['fixture-text', 'fixture-vision']);
  const broken = createExpenseParser({ modelClient: { async generateContent() { throw new Error('provider detail must stay private'); } } });
  await assert.rejects(broken.parse({ text: 'lunch' }, initialSettings()), { name: 'AiError', message: 'errorAiUnavailable', status: 503 });
});

test('default parsing, reports and explicit image retries all use standard Flash Lite', async t => {
  useDefaultModels(t);
  const usedModels = [];
  const vertex = { getGenerativeModel({ model, generationConfig }) {
    return { async generateContent() {
      usedModels.push(model);
      const text = generationConfig.responseMimeType === 'application/json' ? JSON.stringify([rawItem()]) : '本月支出以餐饮为主。';
      return { response: { candidates: [{ content: { parts: [{ text }] } }] } };
    } };
  } };
  const parser = createExpenseParser({ projectId: 'fixture-project', vertex });
  const image = { mimeType: 'image/png', data: imageBytes.toString('base64') };
  for (const input of [
    { text: 'lunch 1200' },
    { image },
    { image, enhanced: true },
    { image, enhanced: 'true' },
    { image, enhanced: 1 },
    { text: 'lunch 1200', enhanced: true },
  ]) await parser.parse(input, initialSettings());
  const summarizer = createExpenseSummarizer({ projectId: 'fixture-project', vertex });
  assert.equal(await summarizer.summarize({ prompt: 'Summarize these verified totals.' }), '本月支出以餐饮为主。');
  assert.deepEqual(usedModels, [
    'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite',
  ]);
});

test('a failed default model never automatically upgrades parsing or summaries', async t => {
  useDefaultModels(t);
  const attempts = [];
  const vertex = { getGenerativeModel({ model }) {
    return { async generateContent() { attempts.push(model); throw new Error('provider private detail'); } };
  } };
  const parser = createExpenseParser({ projectId: 'fixture-project', vertex, textFallbackModel: 'gemini-3.5-flash', visionFallbackModel: 'gemini-3.5-flash' });
  for (const input of [{ text: 'lunch' }, { image: { mimeType: 'image/png', data: imageBytes.toString('base64') } }]) {
    await assert.rejects(parser.parse(input, initialSettings()), { message: 'errorAiUnavailable', status: 503 });
  }
  const summarizer = createExpenseSummarizer({ projectId: 'fixture-project', vertex, fallbackModel: 'gemini-3.5-flash' });
  await assert.rejects(summarizer.summarize({ prompt: 'Summarize expenses.' }), { message: 'errorAiUnavailable', status: 503 });
  assert.ok(attempts.length >= 3);
  assert.ok(attempts.every(model => model === 'gemini-3.1-flash-lite'), 'failed default requests must not incur the enhanced model cost');
});

test('public parsing forwards an explicit enhanced image choice without upgrading text or truthy values', async t => {
  const f = await fixture(t);
  const image = { mimeType: 'image/png', data: imageBytes.toString('base64') };
  for (const [body, enhanced] of [
    [{ image, enhanced: true }, true],
    [{ image, enhanced: 'true' }, false],
    [{ image }, false],
    [{ text: 'lunch 1200', enhanced: true }, false],
  ]) {
    assert.equal((await f.request('/ai/parse-expense', { body })).status, 200);
    assert.equal(f.calls.at(-1).input.enhanced === true, enhanced);
  }
});

test('public AI parsing requires authentication, returns batch results and reuses the exchanged session', async t => {
  const f = await fixture(t);
  const denied = await f.request('/ai/parse-expense', { user: null, body: { text: 'lunch 1200' } });
  assert.equal(denied.status, 401);
  assert.equal(f.calls.length, 0, 'unauthenticated requests must never call the model');
  const first = await f.request('/ai/parse-expense', { body: { text: 'lunch 1200', timezone: 'Europe/Kyiv' } });
  assert.equal(first.status, 200);
  assert.equal(first.data.items.length, 2);
  assert.ok(first.data.sessionToken);
  assert.equal(f.calls[0].input.timezone, 'Europe/Kyiv');
  const again = await f.request('/ai/parse-expense', { user: null, session: first.data.sessionToken, body: { text: 'tea 250' } });
  assert.equal(again.status, 200);
  assert.equal(again.data.sessionToken, undefined);
  const database = await f.database();
  assert.equal(database.ledgers['101'].expenses.length, 0, 'parse does not save unconfirmed model results');
  assert.ok(!JSON.stringify(database).includes(first.data.sessionToken));
});

test('public AI accepts raw image streams and rejects unsupported, empty and oversized inputs', async t => {
  const f = await fixture(t);
  const image = await f.request('/ai/parse-expense', { bytes: imageBytes, headers: { 'Content-Type': 'image/png', 'X-AI-Timezone': 'Europe/Kyiv' } });
  assert.equal(image.status, 200);
  assert.deepEqual(f.calls[0].input.image, { mimeType: 'image/png', data: imageBytes.toString('base64') });
  assert.equal(f.calls[0].input.timezone, 'Europe/Kyiv');
  assert.equal((await f.request('/ai/parse-expense', { bytes: 'lunch 188', headers: { 'Content-Type': 'text/plain' } })).status, 200);
  assert.equal(f.calls[1].input.text, 'lunch 188');
  assert.equal((await f.request('/ai/parse-expense', { bytes: '<svg/>', headers: { 'Content-Type': 'image/svg+xml' } })).status, 415);
  assert.equal((await f.request('/ai/parse-expense', { bytes: Buffer.alloc(0), headers: { 'Content-Type': 'image/png' } })).status, 400);
  assert.equal((await f.request('/ai/parse-expense', { body: { text: '   ' } })).status, 400);
  assert.equal((await f.request('/ai/parse-expense', { body: { image: { mimeType: 'image/svg+xml', data: imageBytes.toString('base64') } } })).status, 415);
  const large = await f.request('/ai/parse-expense', { bytes: Buffer.alloc(8 * 1024 * 1024 + 1), headers: { 'Content-Type': 'image/png' } });
  assert.equal(large.status, 413);
  assert.equal(f.calls.length, 2, 'invalid inputs must not reach the model');
});

test('AI parsing rejects a stale ledger before model use and maps against the active ledger categories', async t => {
  const f = await fixture(t);
  const profile = await f.request('/profile', { method: 'GET' });
  const oldLedger = profile.data.ledgerId;
  const circle = await f.request('/circles/create', { body: { name: 'AI test circle' } });
  const current = circle.data;
  const custom = { id: 'custom_lunch', label: 'Circle lunch', icon: 'bowl', color: 'peach' };
  await f.request('/settings', { method: 'PUT', body: { ...current.settings, ledgerId: current.ledgerId, categories: [custom] } });
  for (const request of [
    () => f.request('/ai/parse-expense', { body: { text: 'lunch', ledgerId: oldLedger } }),
    () => f.request(`/ai/parse-expense?ledgerId=${encodeURIComponent(oldLedger)}`, { bytes: imageBytes, headers: { 'Content-Type': 'image/png' } }),
  ]) {
    const stale = await request();
    assert.equal(stale.status, 409);
    assert.equal(stale.data.error, 'errorLedgerChanged');
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('/ai/parse-expense', { body: { text: 'lunch', ledgerId: current.ledgerId } })).status, 200);
  assert.deepEqual(f.calls[0].settings.categories, [custom]);
});

test('AI provider errors preserve their public error code', async t => {
  const f = await fixture(t, { enabled: true, async parse() { throw new AiError('errorAiUnavailable', 503); } });
  const response = await f.request('/ai/parse-expense', { body: { text: 'lunch 1200' } });
  assert.equal(response.status, 503);
  assert.deepEqual(response.data, { error: 'errorAiUnavailable' });
});

test('explicit money movement requires review even when the model incorrectly calls it a purchase', async () => {
  const settings = initialSettings();
  settings.consumers = [{ id: 'u_101', name: 'Test' }];
  for (const [detectedLanguage, rawText, reason] of [
    ['zh', '今天中午十二点帮朋友代付新宿拉面1723日元', /付款方向|代付|报销/],
    ['en', 'Paid on behalf of a friend for ramen, 1723 yen today at noon', /direction|someone else/],
    ['uk', 'Переказ за обід 1723 єн сьогодні опівдні', /напрямок|іншу людину/],
  ]) {
    const raw = rawItem({ amount: 1723, categoryId: 'other', categoryLabel: '其他', rawText, note: '',
      occurredAt: '2026-10-11T03:00:00.000Z', localDate: '2026-10-11', localTime: '12:00', timeText: '', timeSource: 'explicit',
      confidence: 0.95, consumer: 'u_101', recordKind: 'purchase', needsReview: false, reviewReason: '', detectedLanguage });
    const parser = createExpenseParser({ modelClient: modelReturning([raw]), now: () => now });
    const [item] = await parser.parse({ file: { mimeType: 'audio/ogg', data: Buffer.from('voice-fixture').toString('base64') }, timezone: 'Asia/Tokyo', defaultConsumer: 'u_101' }, settings);
    assert.equal(item.needsReview, true, rawText);
    assert.match(item.reviewReason, reason);
    assert.equal(item.recordKind, 'purchase', 'uncertain money direction is not silently reclassified');
    assert.equal(item.categoryId, 'other');
  }
});

test('a valid custom category remains selected while suspicious payment wording requires review', async () => {
  const settings = initialSettings();
  settings.categories = [{ id: 'my_meals', label: 'Together meals', icon: 'bowl', color: 'peach' }, settings.categories.at(-1)];
  settings.consumers = [{ id: 'u_101', name: 'Test' }];
  const raw = rawItem({ categoryId: 'my_meals', categoryLabel: 'Together meals', rawText: '帮朋友代付拉面1200日元',
    occurredAt: '2026-10-11T03:00:00.000Z', consumer: 'u_101', recordKind: 'purchase', needsReview: false, detectedLanguage: 'zh' });
  const parser = createExpenseParser({ modelClient: modelReturning([raw]), now: () => now });
  const [item] = await parser.parse({ text: raw.rawText, timezone: 'Asia/Tokyo' }, settings);
  assert.equal(item.categoryId, 'my_meals');
  assert.equal(item.needsReview, true);
});

test('AI results are rejected when the user switches ledgers during recognition', async t => {
  let signalStarted, releaseModel;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const ready = new Promise(resolve => { releaseModel = resolve; });
  const f = await fixture(t, { enabled: true, async parse() { signalStarted(); await ready; return [parsedItem()]; } });
  const pending = f.request('/ai/parse-expense', { body: { text: 'lunch 1200', ledgerId: '101' } });
  await started;
  try {
    assert.equal((await f.request('/circles/create', { body: { name: 'Changed while reading' } })).status, 200);
  } finally { releaseModel(); }
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(result.data.error, 'errorLedgerChanged');
  const database = await f.database();
  assert.ok(Object.values(database.ledgers).every(ledger => ledger.expenses.length === 0));
});

test('batch imports are atomic, idempotent under concurrent retry and preserve confirmed time and splits', async t => {
  const f = await fixture(t);
  const created = await f.request('/circles/create', { body: { name: 'Receipt import' } });
  const ledgerId = created.data.ledgerId;
  const invite = await f.request('/circles/invite', { body: { circleId: created.data.social.activeCircleId } });
  assert.equal((await f.request('/circles/join', { user: 202, body: { code: invite.data.code, confirm: true } })).status, 200);
  const entry = (id, patch = {}) => ({ id, consumer: 'u_101', type: 'expense', amountMinor: 1200, currency: 'JPY', categoryId: 'stomach',
    note: 'Noodles', timezone: 'Asia/Tokyo', occurredAt: '2026-09-30T15:30:00.000Z', splitMode: 'equal', splitParticipants: ['u_101', 'u_202'], ...patch });
  const entries = [entry('batch-first-001'), entry('batch-second-01', { amountMinor: 250 })];
  const failed = await f.request('/expenses/import', { body: { ledgerId, entries: [entries[0], { ...entries[1], amountMinor: -1 }] } });
  assert.equal(failed.status, 400);
  assert.equal((await f.request('/profile', { method: 'GET' })).data.expenses.length, 0, 'a later invalid record rolls back earlier records');
  const responses = await Promise.all(Array.from({ length: 3 }, () => f.request('/expenses/import', { body: { ledgerId, entries } })));
  for (const result of responses) {
    assert.equal(result.status, 200);
    assert.equal(result.data.entries.length, 2);
    assert.deepEqual(result.data.entries.map(item => item.id), entries.map(item => item.id));
    assert.equal(result.data.entries[0].occurredAt, entries[0].occurredAt);
    assert.equal(result.data.entries[0].dayKey, '2026-10-01');
    assert.equal(result.data.entries[0].splitMode, 'equal');
    assert.deepEqual(result.data.entries[0].splitParticipants, ['u_101', 'u_202']);
  }
  const database = await f.database();
  assert.equal(database.ledgers[ledgerId].expenses.length, 2, 'concurrent retries must not duplicate imported purchases');
  assert.ok(database.ledgers[ledgerId].expenses.every(item => item.createdBy === '101'));
  const duplicate = await f.request('/expenses/import', { body: { ledgerId, entries: [entry('duplicate-batch'), entry('duplicate-batch', { amountMinor: 100 })] } });
  assert.equal(duplicate.status, 400, 'duplicate IDs within a batch cannot silently collapse two purchases');
  assert.equal((await f.request('/profile', { method: 'GET' })).data.expenses.length, 2);
});

test('batch imports reject unauthenticated, malformed and stale-scope writes before changing any ledger', async t => {
  const f = await fixture(t);
  const entry = { id: 'isolated-import', consumer: 'u_101', type: 'expense', amountMinor: 100, currency: 'JPY', categoryId: 'stomach',
    note: '', timezone: 'Asia/Tokyo', occurredAt: '2026-10-10T00:00:00.000Z' };
  assert.equal((await f.request('/expenses/import', { user: null, body: { entries: [entry] } })).status, 401);
  const personal = (await f.request('/profile', { method: 'GET' })).data;
  const circle = (await f.request('/circles/create', { body: { name: 'Current scope' } })).data;
  assert.equal((await f.request('/expenses/import', { body: { ledgerId: personal.ledgerId, entries: [entry] } })).status, 409);
  for (const entries of [null, [], [null], Array.from({ length: 51 }, (_, index) => ({ ...entry, id: `too-many-import-${index}` }))]) {
    const result = await f.request('/expenses/import', { body: { ledgerId: circle.ledgerId, entries } });
    assert.ok(result.status >= 400 && result.status < 500, `malformed import batch should be rejected: ${result.status}`);
  }
  const database = await f.database();
  assert.equal(database.ledgers[personal.ledgerId].expenses.length, 0);
  assert.equal(database.ledgers[circle.ledgerId].expenses.length, 0);
});

test('internal Telegram AI endpoint verifies its secret and Telegram identity for JSON and raw images', async t => {
  const f = await fixture(t);
  const body = { telegramUserId: '303', text: 'lunch 1200' };
  for (const headers of [{}, { 'X-Bot-Token': 'wrong-secret' }]) {
    const denied = await f.request('/ai/telegram-parse', { user: null, body, headers });
    assert.equal(denied.status, 401);
  }
  assert.equal(f.calls.length, 0);
  const headers = { 'X-Bot-Token': botToken };
  const parsed = await f.request('/ai/telegram-parse', { user: null, body, headers });
  assert.equal(parsed.status, 200);
  assert.equal(parsed.data.userId, 'u_303');
  assert.equal(parsed.data.items.length, 2);
  assert.equal(parsed.data.saved, false);
  const image = await f.request('/ai/telegram-parse', { user: null, bytes: imageBytes, headers: { ...headers, 'Content-Type': 'image/png', 'X-Telegram-User-Id': '303', 'X-Timezone': 'Europe/Kyiv' } });
  assert.equal(image.status, 200);
  assert.equal(f.calls.at(-1).input.timezone, 'Europe/Kyiv');
  assert.equal(f.calls.at(-1).input.image.mimeType, 'image/png');
  for (const telegramUserId of ['', '0', '-1', 'not-a-user']) {
    assert.equal((await f.request('/ai/telegram-parse', { user: null, body: { ...body, telegramUserId }, headers })).status, 400);
  }
  const database = await f.database();
  assert.deepEqual(Object.keys(database.users), ['303']);
  assert.equal(database.ledgers['303'].expenses.length, 0);
  assert.equal(Object.keys(database.sessions).length, 0, 'bot identity lookup must not mint a web session');
});
