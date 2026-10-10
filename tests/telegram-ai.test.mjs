import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.mjs';
import { ensureUser, handleDomain } from '../domain.mjs';
import { createTelegramHandler, DRAFT_TTL, MAX_IMAGE_BYTES } from '../telegram-ai.mjs';
import { configureTelegramBot } from '../scripts/configure-bot.mjs';
import { deriveTelegramWebhookSecret, ensureTelegramWebhook } from '../telegram-config.mjs';

const at = Date.parse('2026-10-11T01:00:00.000Z');
const parsed = (patch = {}) => ({ amountMinor: 188, currency: 'JPY', type: 'expense', categoryId: 'stomach', categoryLabel: '胃', merchant: 'Noodle shop', note: 'Ramen', occurredAt: '2026-10-10T10:00:00.000Z', timezone: 'Asia/Tokyo', ...patch });
const message = (id, text = '昨晚拉面 188 日元', from = 101, language = 'zh') => ({ update_id: id, message: { message_id: id, chat: { id: from, type: 'private' }, from: { id: from, first_name: `User ${from}`, language_code: language }, text } });
const callback = (id, draftId, action = 'confirm', from = 101, chat = from) => ({ update_id: id, callback_query: { id: `query-${id}`, from: { id: from }, message: { message_id: 7, chat: { id: chat, type: 'private' } }, data: `fp:${action}:${draftId}` } });

async function fixture(t, extra = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-telegram-test-'));
  const calls = [], aiCalls = [];
  const store = createStore(dataDir);
  const parser = { enabled: true, async parse(input, settings) { aiCalls.push({ input, settings }); return [parsed()]; }, ...extra.aiParser };
  const options = { store, aiParser: parser, token: 'fixture-token', publicUrl: 'https://example.com', now: () => at, callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 7 }; }, ...extra, aiParser: parser };
  const handler = createTelegramHandler(options);
  t.after(async () => {
    handler.close();
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-telegram-test-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { store, handler, calls, aiCalls, options, dataDir, database: async () => JSON.parse(await readFile(path.join(dataDir, '_pocket-v2.json'), 'utf8')) };
}

test('private text becomes a persisted preview and confirmation saves once across handler restart', async t => {
  const f = await fixture(t);
  const draft = await f.handler.handle(message(1));
  assert.equal(draft.kind, 'draft');
  assert.equal(f.aiCalls.length, 1);
  assert.equal((await f.database()).ledgers['101'].expenses.length, 0);
  const preview = f.calls.find(call => call.method === 'sendMessage');
  assert.match(preview.params.text, /188/);
  assert.equal(preview.params.reply_markup.inline_keyboard[0][0].callback_data, `fp:confirm:${draft.draftId}`);
  assert.equal((await f.handler.handle(message(1))).duplicate, true);
  assert.equal(f.aiCalls.length, 1);
  const restarted = createTelegramHandler({ ...f.options, store: createStore(f.dataDir) });
  const saved = await restarted.handle(callback(2, draft.draftId));
  assert.equal(saved.kind, 'confirmed');
  const database = await f.database();
  assert.equal(database.ledgers['101'].expenses.length, 1);
  assert.equal(database.ledgers['101'].expenses[0].amountMinor, 188);
  assert.equal(database.ledgers['101'].expenses[0].consumer, 'u_101');
  assert.equal(database.ledgers['101'].expenses[0].occurredAt, '2026-10-10T10:00:00.000Z');
  assert.equal((await restarted.handle(callback(3, draft.draftId))).kind, 'already');
  assert.equal((await f.database()).ledgers['101'].expenses.length, 1);
});

test('foreign callbacks, cancellation, expired drafts and group messages never write expenses', async t => {
  let clock = at;
  const f = await fixture(t, { now: () => clock });
  const draft = await f.handler.handle(message(10));
  assert.equal((await f.handler.handle(callback(11, draft.draftId, 'confirm', 202, 101))).kind, 'missing');
  assert.equal((await f.handler.handle(callback(12, draft.draftId, 'cancel'))).kind, 'cancelled');
  assert.equal((await f.handler.handle(callback(13, draft.draftId))).kind, 'cancelled');
  const another = await f.handler.handle(message(14));
  clock += DRAFT_TTL + 1;
  assert.equal((await f.handler.handle(callback(15, another.draftId))).kind, 'missing');
  const group = message(16); group.message.chat.type = 'group';
  assert.equal((await f.handler.handle(group)).kind, 'ignored');
  assert.equal((await f.database()).ledgers['101'].expenses.length, 0);
  assert.equal(f.aiCalls.length, 2);
});

test('confirmation rechecks current ledger and membership rather than writing to an old ledger', async t => {
  const f = await fixture(t);
  const draft = await f.handler.handle(message(20));
  await f.store.run(db => handleDomain(db, '101', '/circles/create', 'POST', { name: 'new circle' }, { now: at, limit() {} }));
  const outcome = await f.handler.handle(callback(21, draft.draftId));
  assert.equal(outcome.kind, 'errorLedgerChanged');
  assert.equal((await f.database()).ledgers['101'].expenses.length, 0);
});

test('current Telegram member is the default payer in a circle and all writes commit together', async t => {
  const f = await fixture(t, { aiParser: { async parse() { return [parsed(), parsed({ amountMinor: 250 })]; } } });
  await f.store.run(db => {
    ensureUser(db, 'telegram:101', { first_name: 'First' }); ensureUser(db, 'telegram:202', { first_name: 'Second' });
    const p = handleDomain(db, '101', '/circles/create', 'POST', { name: 'Us' }, { now: at, limit() {} });
    const circle = db.circles[p.social.activeCircleId]; circle.members.push('202'); db.users['202'].activeCircleId = circle.id;
  });
  const draft = await f.handler.handle(message(30, 'lunch 188', 202));
  assert.equal((await f.handler.handle(callback(31, draft.draftId, 'confirm', 202))).kind, 'confirmed');
  const db = await f.database(), circle = Object.values(db.circles)[0];
  assert.equal(db.ledgers[circle.ledgerId].expenses.length, 2);
  assert.ok(db.ledgers[circle.ledgerId].expenses.every(item => item.consumer === 'u_202'));
});

test('photo and document images are downloaded within bounds and forwarded as private base64 input', async t => {
  const downloads = [];
  const f = await fixture(t, { downloadFile: async fileId => { downloads.push(fileId); return Buffer.from('fixture-image'); } });
  const photo = message(40, ''); photo.message.photo = [{ file_id: 'small' }, { file_id: 'large' }]; photo.message.caption = 'Receipt';
  assert.equal((await f.handler.handle(photo)).kind, 'draft');
  assert.deepEqual(downloads, ['large']);
  assert.equal(f.aiCalls[0].input.image.mimeType, 'image/jpeg');
  assert.equal(f.aiCalls[0].input.image.data, Buffer.from('fixture-image').toString('base64'));
  assert.equal(f.aiCalls[0].input.text, 'Receipt');
  const document = message(41, ''); document.message.document = { file_id: 'receipt', mime_type: 'image/png', file_size: 100 };
  assert.equal((await f.handler.handle(document)).kind, 'draft');
  assert.equal(f.aiCalls[1].input.image.mimeType, 'image/png');
  const large = message(42, ''); large.message.document = { file_id: 'huge', mime_type: 'image/jpeg', file_size: MAX_IMAGE_BYTES + 1 };
  assert.equal((await f.handler.handle(large)).reason, 'image-too-large');
  const invalid = message(43, ''); invalid.message.document = { file_id: 'svg', mime_type: 'image/svg+xml', file_name: 'fake.png' };
  assert.equal((await f.handler.handle(invalid)).reason, 'invalid-image');
  assert.equal(downloads.length, 2);
  assert.ok(!JSON.stringify(await f.database()).includes(Buffer.from('fixture-image').toString('base64')));
});

test('summary commands use the shared AI summarizer and bot copy follows the account language', async t => {
  const summaries = [];
  const f = await fixture(t, { aiParser: { async summarize(input, profile) { summaries.push({ input, profile }); return { text: '☁️ Weekly summary' }; } } });
  assert.equal((await f.handler.handle(message(50, '/start', 303, 'uk'))).kind, 'start');
  assert.match(f.calls.at(-1).params.text, /Маленькі витрати/);
  assert.equal((await f.handler.handle(message(51, '/week', 303, 'uk'))).kind, 'summary');
  assert.equal(summaries[0].input.period, 'week');
  assert.equal(summaries[0].profile.user.id, 'u_303');
  assert.equal(f.calls.at(-1).params.text, '☁️ Weekly summary');
  assert.equal((await f.handler.handle(message(52, '我们这个月一共花了多少？', 303, 'uk'))).kind, 'summary');
});

test('invalid AI output and provider failures send safe messages without persisting a draft', async t => {
  let rejected = false;
  const f = await fixture(t, { aiParser: { async parse() { if (rejected) throw new Error('private provider detail'); return [{ amountMinor: 0 }]; } } });
  assert.equal((await f.handler.handle(message(60))).reason, 'no-result');
  rejected = true;
  assert.equal((await f.handler.handle(message(61))).reason, 'unavailable');
  const db = await f.database();
  assert.deepEqual(Object.keys(db.telegram.drafts), []);
  assert.equal(db.ledgers['101'].expenses.length, 0);
  assert.ok(!JSON.stringify(f.calls).includes('private provider detail'));
});

test('long batches show every record in bounded messages and offer confirmation only after the full preview', async t => {
  const records = Array.from({ length: 50 }, (_, index) => parsed({ amountMinor: index + 1, merchant: `Shop ${index + 1}`, note: `${index + 1}: ${'d'.repeat(145)}` }));
  const f = await fixture(t, { aiParser: { async parse() { return records; } } });
  const result = await f.handler.handle(message(70));
  const pages = f.calls.filter(call => call.method === 'sendMessage');
  assert.ok(pages.length > 1);
  assert.ok(pages.every(call => call.params.text.length <= 4096));
  assert.ok(pages.slice(0, -1).every(call => !call.params.reply_markup));
  assert.ok(pages.at(-1).params.reply_markup.inline_keyboard[0][0].callback_data.includes(result.draftId));
  const all = pages.map(call => call.params.text).join('\n');
  for (let index = 1; index <= records.length; index++) assert.match(all, new RegExp(`(?:^|\\n)${index}\\. `));
  assert.equal((await f.database()).telegram.drafts[result.draftId].previewComplete, true);
  assert.equal((await f.handler.handle(callback(71, result.draftId))).count, 50);
  assert.equal((await f.database()).ledgers['101'].expenses.length, 50);
});

test('failed preview delivery resumes from a persisted checkpoint without reparsing or losing records', async t => {
  let parses = 0, deliveries = 0, failOnce = true;
  const sent = [];
  const f = await fixture(t, {
    aiParser: { async parse() { parses++; return Array.from({ length: 25 }, (_, index) => parsed({ note: `${index}: ${'x'.repeat(145)}` })); } },
    callTelegram: async (method, params) => {
      if (method === 'sendMessage') {
        deliveries++;
        if (deliveries === 2 && failOnce) { failOnce = false; throw new Error('temporary delivery failure'); }
        sent.push(params);
      }
      return { message_id: 7 };
    },
  });
  assert.equal((await f.handler.handle(message(80))).retryable, true);
  const before = await f.database();
  const draftId = Object.keys(before.telegram.drafts)[0];
  assert.equal(before.telegram.drafts[draftId].previewSent, 1);
  assert.equal(before.telegram.drafts[draftId].previewComplete, false);
  assert.equal(before.ledgers['101'].expenses.length, 0);
  const restarted = createTelegramHandler({ ...f.options, store: createStore(f.dataDir) });
  t.after(() => restarted.close());
  const resumed = await restarted.handle(message(80));
  assert.equal(resumed.draftId, draftId);
  assert.equal(parses, 1);
  assert.equal(sent.filter(item => item.text.includes('先看一眼，再记下')).length, 1);
  assert.equal((await f.database()).telegram.updates['80'].status, 'done');
  assert.equal((await restarted.handle(callback(81, draftId))).count, 25);
  assert.equal((await f.database()).ledgers['101'].expenses.length, 25);
});

test('simultaneous duplicate updates share one parse and a failed confirmation response never duplicates saved expenses', async t => {
  let parses = 0, blockReplies = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, {
    aiParser: { async parse() { parses++; await gate; return [parsed()]; } },
    callTelegram: async method => { if (blockReplies && ['editMessageText', 'sendMessage'].includes(method)) throw new Error('offline'); return { message_id: 7 }; },
  });
  const first = f.handler.handle(message(90)), second = f.handler.handle(message(90));
  release();
  const [draft, duplicate] = await Promise.all([first, second]);
  assert.equal(parses, 1);
  assert.equal(duplicate.duplicate, true);
  blockReplies = true;
  assert.equal((await f.handler.handle(callback(91, draft.draftId))).retryable, true);
  assert.equal((await f.database()).ledgers['101'].expenses.length, 1);
  blockReplies = false;
  assert.equal((await f.handler.handle(callback(91, draft.draftId))).kind, 'confirmed');
  assert.equal((await f.database()).ledgers['101'].expenses.length, 1);
});

test('missing receipt dates require the explicit current-time button', async t => {
  let clock = at;
  const f = await fixture(t, { now: () => clock, aiParser: { async parse() { return [parsed({ occurredAt: null })]; } } });
  const draft = await f.handler.handle(message(100));
  const preview = f.calls.find(call => call.method === 'sendMessage').params;
  assert.match(preview.text, /未识别时间/);
  assert.equal(preview.reply_markup.inline_keyboard[0][0].callback_data, `fp:now:${draft.draftId}`);
  assert.equal((await f.handler.handle(callback(101, draft.draftId))).kind, 'needs-time');
  assert.equal((await f.database()).ledgers['101'].expenses.length, 0);
  clock += 60000;
  assert.equal((await f.handler.handle(callback(102, draft.draftId, 'now'))).kind, 'confirmed');
  assert.equal((await f.database()).ledgers['101'].expenses[0].occurredAt, new Date(clock).toISOString());
});

test('parsed payer and equal shares use only current members, and removed members invalidate the whole batch', async t => {
  const f = await fixture(t, { aiParser: { async parse() { return [parsed({ consumer: 'u_202', splitMode: 'equal', splitParticipants: ['u_101', 'u_202', 'u_999', 'u_202'] })]; } } });
  let ledgerId;
  await f.store.run(db => {
    ensureUser(db, 'telegram:101', { first_name: 'First' }); ensureUser(db, 'telegram:202', { first_name: 'Second' });
    const profile = handleDomain(db, '101', '/circles/create', 'POST', { name: 'Us' }, { now: at, limit() {} });
    const circle = db.circles[profile.social.activeCircleId]; circle.members.push('202'); ledgerId = circle.ledgerId;
  });
  const draft = await f.handler.handle(message(110));
  const stored = (await f.database()).telegram.drafts[draft.draftId].items[0].expense;
  assert.equal(stored.consumer, 'u_202');
  assert.equal(stored.splitMode, 'equal');
  assert.deepEqual(stored.splitParticipants, ['u_101', 'u_202']);
  assert.equal((await f.handler.handle(callback(111, draft.draftId))).kind, 'confirmed');
  const again = await f.handler.handle(message(112));
  await f.store.run(db => { Object.values(db.circles)[0].members = ['101']; });
  assert.equal((await f.handler.handle(callback(113, again.draftId))).kind, 'failed');
  assert.equal((await f.database()).ledgers[ledgerId].expenses.length, 1);
});

test('image enhancement is manual, owner-bound, and replaces the prior draft without saving it twice', async t => {
  const requests = [];
  const f = await fixture(t, {
    downloadFile: async () => Buffer.from('private-receipt'),
    aiParser: { async parse(input) { requests.push(input); return [parsed({ amountMinor: input.enhanced ? 198 : 188 })]; } },
  });
  const photo = message(120, ''); photo.message.photo = [{ file_id: 'receipt' }];
  const initial = await f.handler.handle(photo);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].enhanced, false);
  const retryData = f.calls.find(call => call.method === 'sendMessage').params.reply_markup.inline_keyboard[1][0].callback_data;
  const retryId = retryData.split(':')[2];
  assert.equal((await f.handler.handle(callback(121, retryId, 'retry', 202, 101))).reason, 'retry-expired');
  assert.equal(requests.length, 1);
  const enhanced = await f.handler.handle(callback(122, retryId, 'retry'));
  assert.equal(enhanced.kind, 'draft');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].enhanced, true);
  assert.equal(requests[1].image.data, requests[0].image.data);
  assert.equal((await f.handler.handle(callback(123, initial.draftId))).kind, 'cancelled');
  assert.equal((await f.handler.handle(callback(124, enhanced.draftId))).kind, 'confirmed');
  const db = await f.database();
  assert.equal(db.ledgers['101'].expenses.length, 1);
  assert.equal(db.ledgers['101'].expenses[0].amountMinor, 198);
  assert.ok(!JSON.stringify(db).includes(Buffer.from('private-receipt').toString('base64')));
  assert.equal((await f.handler.handle(callback(125, retryId, 'retry'))).reason, 'retry-expired');
  assert.equal(requests.length, 2);
});

test('failed image recognition offers a manual retry and image cache expiry or restart requires resending', async t => {
  let clock = at;
  const requests = [];
  const f = await fixture(t, {
    now: () => clock, downloadFile: async () => Buffer.from('private-receipt'),
    aiParser: { async parse(input) { requests.push(input); if (!input.enhanced) throw new Error('provider unavailable'); return [parsed()]; } },
  });
  const photo = message(130, ''); photo.message.photo = [{ file_id: 'receipt' }];
  assert.equal((await f.handler.handle(photo)).reason, 'unavailable');
  const retryId = f.calls.at(-1).params.reply_markup.inline_keyboard[0][0].callback_data.split(':')[2];
  assert.equal(requests.length, 1);
  assert.equal((await f.handler.handle(callback(131, retryId, 'retry'))).kind, 'draft');
  assert.equal(requests.length, 2);
  photo.update_id = 132;
  await f.handler.handle(photo);
  const expiring = f.calls.at(-1).params.reply_markup.inline_keyboard[0][0].callback_data.split(':')[2];
  clock += DRAFT_TTL + 1;
  assert.equal((await f.handler.handle(callback(133, expiring, 'retry'))).reason, 'retry-expired');
  photo.update_id = 134;
  await f.handler.handle(photo);
  const beforeRestart = f.calls.at(-1).params.reply_markup.inline_keyboard[0][0].callback_data.split(':')[2];
  const restarted = createTelegramHandler({ ...f.options, store: createStore(f.dataDir) });
  t.after(() => restarted.close());
  assert.equal((await restarted.handle(callback(135, beforeRestart, 'retry'))).reason, 'retry-expired');
  assert.equal(requests.length, 4);
});

test('plain spending sentences with amounts stay on the parsing path', async t => {
  const f = await fixture(t);
  assert.equal((await f.handler.handle(message(140, '今天花了188'))).kind, 'draft');
  assert.equal((await f.handler.handle(message(141, 'spent 200 on lunch'))).kind, 'draft');
  assert.equal(f.aiCalls.length, 2);
});

test('bot configuration is read-only by default and explicit apply preserves pending updates', async () => {
  const calls = [];
  const url = 'https://example.com';
  const config = { token: 'fixture-token', publicUrl: url, webhookSecret: 'fixture_secret', expectedUsername: 'fixture_bot', callTelegram: async (method, body) => {
    calls.push({ method, body });
    if (method === 'getMe') return { username: 'fixture_bot' };
    if (method === 'getChatMenuButton') return { type: 'web_app', web_app: { url } };
    if (method === 'getWebhookInfo') return { url: `${url}/api/telegram/webhook`, pending_update_count: 3 };
    return true;
  } };
  const status = await configureTelegramBot(config);
  assert.equal(status.webhookConfigured, true);
  assert.equal(status.pendingUpdates, 3);
  assert.ok(calls.every(item => item.method.startsWith('get')));
  await configureTelegramBot({ ...config, apply: true });
  const setup = calls.find(item => item.method === 'setWebhook').body;
  assert.equal(setup.url, `${url}/api/telegram/webhook`);
  assert.equal(setup.secret_token, 'fixture_secret');
  assert.deepEqual(setup.allowed_updates, ['message', 'callback_query']);
  assert.equal(setup.drop_pending_updates, undefined);
  assert.ok(!JSON.stringify(status).includes('fixture_secret'));
});

test('wrong bot identity and malformed webhook secret never mutate Telegram configuration', async () => {
  const calls = [];
  const config = { token: 'fixture-token', publicUrl: 'https://example.com', webhookSecret: 'fixture_secret', expectedUsername: 'intended_bot', apply: true,
    callTelegram: async method => { calls.push(method); return { username: 'other_bot' }; } };
  await assert.rejects(configureTelegramBot(config), /different bot/);
  assert.deepEqual(calls, ['getMe']);
  calls.length = 0;
  await assert.rejects(configureTelegramBot({ ...config, webhookSecret: 'invalid secret with spaces' }), /TELEGRAM_WEBHOOK_SECRET/);
  assert.deepEqual(calls, []);
});

test('webhook secret derivation is deterministic, explicit secrets are validated, and setup never overwrites another URL', async () => {
  const token = '123456:fixture';
  const first = deriveTelegramWebhookSecret(token);
  assert.equal(first, deriveTelegramWebhookSecret(token));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(deriveTelegramWebhookSecret(token, 'explicit_secret-1'), 'explicit_secret-1');
  for (const value of ['', 'bad secret', 'x'.repeat(257), 7]) {
    if (value === '') continue;
    assert.throws(() => deriveTelegramWebhookSecret(token, value), /TELEGRAM_WEBHOOK_SECRET/);
  }
  await assert.rejects(ensureTelegramWebhook({ token: '', publicUrl: 'https://example.com', callTelegram: async () => true }), /BOT_TOKEN/);
  await assert.rejects(ensureTelegramWebhook({ token, publicUrl: 'http://example.com', callTelegram: async () => true }), /HTTPS/);
  const blockedCalls = [];
  const blocked = await ensureTelegramWebhook({ token, publicUrl: 'https://example.com', callTelegram: async (method, body) => {
    blockedCalls.push({ method, body });
    return method === 'getWebhookInfo' ? { url: 'https://other.example/api/telegram/webhook' } : true;
  } });
  assert.deepEqual(blocked, { status: 'blocked', reason: 'existing-webhook' });
  assert.deepEqual(blockedCalls.map(item => item.method), ['getWebhookInfo']);
  const sameCalls = [];
  const same = await ensureTelegramWebhook({ token, publicUrl: 'https://example.com', callTelegram: async (method, body) => {
    sameCalls.push({ method, body });
    return method === 'getWebhookInfo' ? { url: 'https://example.com/api/telegram/webhook' } : true;
  } });
  assert.deepEqual(same, { status: 'configured' });
  assert.deepEqual(sameCalls.map(item => item.method), ['getWebhookInfo', 'setWebhook']);
  assert.deepEqual(sameCalls[1].body, {
    url: 'https://example.com/api/telegram/webhook',
    secret_token: first,
    allowed_updates: ['message', 'callback_query'],
    max_connections: 1,
  });
});
