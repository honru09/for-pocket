import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.mjs';
import { handleCircleReactions } from '../circle-reactions.mjs';
import { createReactionNotificationService, createCloudTasksReactionQueue, reactionNotificationText } from '../reaction-notifications.mjs';

const start = Date.parse('2026-10-13T00:00:00.000Z');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'for-reaction-notify-'));
  let store = createStore(dir), time = start, serial = 0;
  await store.run(db => {
    db.users = { a: { id: 'a', name: 'Kojun', settings: { language: 'zh' } }, b: { id: 'b', name: 'Cheese', settings: { language: 'uk' } } };
    db.circles = { circle: { id: 'circle', members: ['a', 'b'], admins: ['a'], ledgerId: 'shared' } };
    db.telegram = { preferences: { a: { chatId: '101', language: 'zh' }, b: { chatId: '202', language: 'en' } } };
  });
  t.after(async () => { await store.close(); assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('for-reaction-notify-')); await rm(dir, { recursive: true, force: true }); });
  return {
    get store() { return store; }, now: () => time, advance: ms => { time += ms; },
    send: (emoji = '❤️', id = `reaction-${String(++serial).padStart(6, '0')}`) => store.run(db => handleCircleReactions(db, db.circles.circle, 'a', '/circles/reactions', 'POST', { id, emoji, recipientId: 'u_b' }, time, null, fail)),
    inbox: () => store.run(db => handleCircleReactions(db, db.circles.circle, 'b', '/circles/reactions', 'GET', {}, time, null, fail)),
    restart: async () => { await store.close(); store = createStore(dir); },
  };
}

test('same emoji groups through a 3000ms gap, duplicates do not increment, and a new emoji or longer gap resets', async t => {
  const f = await fixture(t);
  const first = await f.send('❤️', 'reaction-first');
  f.advance(3000);
  const second = await f.send('❤️', 'reaction-second');
  assert.equal(first.burstId, second.burstId);
  assert.equal(second.burstIndex, 2);
  f.advance(1);
  const retried = await f.send('❤️', 'reaction-first');
  assert.equal(retried.burstIndex, 1); assert.equal(retried.burstCount, 2);
  f.advance(3000);
  const third = await f.send();
  assert.notEqual(third.burstId, first.burstId);
  const smile = await f.send('😀');
  const heart = await f.send('❤️');
  assert.notEqual(smile.burstId, third.burstId);
  assert.notEqual(heart.burstId, third.burstId);
  const inbox = await f.inbox();
  assert.equal(inbox.items.length, 5);
  assert.deepEqual(inbox.items.slice(0, 2).map(item => [item.burstIndex, item.burstCount]), [[1, 2], [2, 2]]);
  assert.equal(inbox.items[0].burstLastAt, start + 3000);
});

test('ten rapid emoji notify once at last event +13 seconds, silently, in recipient language and survive a restart', async t => {
  const f = await fixture(t), calls = [];
  let last;
  for (let index = 0; index < 10; index++) { if (index) f.advance(200); last = await f.send(); }
  await f.restart();
  const service = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false, callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 9 }; } });
  f.advance(12999);
  assert.equal((await service.tick()).sent, 0); assert.equal(calls.length, 0);
  f.advance(1);
  assert.equal((await service.tick()).sent, 1);
  assert.equal(calls[0].method, 'sendMessage'); assert.equal(calls[0].params.chat_id, '202'); assert.equal(calls[0].params.disable_notification, true);
  assert.equal(calls[0].params.text, 'Kojun sent you ❤️ ×10');
  assert.equal((await service.deliver({ circleId: 'circle', burstId: last.burstId })).sent, 0);
  await f.restart();
  const restarted = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false, callTelegram: async () => { throw new Error('already sent'); } });
  assert.equal((await restarted.tick()).sent, 0);
});

test('one scheduled task follows a growing burst and requeues its final deadline', async t => {
  const f = await fixture(t), tasks = [], calls = [];
  const service = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false,
    enqueueTask: async task => { tasks.push(task); return { name: `task-${tasks.length}` }; },
    callTelegram: async (_, params) => { calls.push(params); return { message_id: 10 }; },
  });
  const first = await f.send();
  await service.afterReaction(first);
  for (let index = 0; index < 5; index++) { f.advance(2000); await service.afterReaction(await f.send()); }
  assert.equal(tasks.length, 1, 'high frequency sends do not create one cloud task per tap');
  f.advance(3000);
  const early = await service.deliver(tasks[0]);
  assert.equal(early.sent, 0); assert.equal(tasks.length, 2); assert.equal(calls.length, 0);
  assert.equal(tasks[1].scheduledFor, start + 23000);
  f.advance(10000);
  assert.equal((await service.deliver(tasks[1])).sent, 1);
  assert.equal(calls[0].text, 'Kojun sent you ❤️ ×6');
});

test('a gap greater than three seconds creates two quiet messages, and viewing an emoji does not cancel notification', async t => {
  const f = await fixture(t), calls = [];
  const first = await f.send();
  f.advance(3001);
  const second = await f.send();
  await f.store.run(db => { db.circles.circle.reactions[0].seenAt = f.now(); });
  const service = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false, callTelegram: async (_, params) => { calls.push(params); return { message_id: calls.length }; } });
  f.advance(9999);
  assert.equal((await service.tick()).sent, 1);
  assert.equal((await service.deliver(first)).sent, 0);
  f.advance(3001);
  assert.equal((await service.deliver(second)).sent, 1);
  assert.deepEqual(calls.map(item => item.text), ['Kojun sent you ❤️', 'Kojun sent you ❤️']);
});

test('an early cloud task returns a retryable failure if the replacement task cannot be enqueued', async t => {
  const f = await fixture(t), tasks = [];
  let failEnqueue = false;
  const service = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false,
    enqueueTask: async task => { if (failEnqueue) throw new Error('temporary'); tasks.push(task); return { name: `task-${tasks.length}` }; },
    callTelegram: async () => ({ message_id: 1 }),
  });
  await service.afterReaction(await f.send());
  f.advance(2000); await service.afterReaction(await f.send());
  f.advance(11000); failEnqueue = true;
  const failed = await service.deliver(tasks[0]);
  assert.equal(failed.ok, false); assert.equal(failed.failed, 1); assert.equal(failed.sent, 0);
  failEnqueue = false;
  assert.equal((await service.deliver(tasks[0])).ok, true);
  assert.equal(tasks.length, 2); assert.equal(tasks[1].scheduledFor, start + 15000);
});

test('an expired process lease recovers while a live lease prevents a second sender', async t => {
  const f = await fixture(t), calls = [];
  const first = await f.send(); f.advance(13000);
  await f.store.run(db => { Object.assign(db.circles.circle.reactionBursts[0].notification, { status: 'sending', claimUntil: f.now() + 1000 }); });
  const service = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false, callTelegram: async (_, params) => { calls.push(params); return { message_id: 13 }; } });
  assert.equal((await service.deliver(first)).sent, 0); assert.equal(calls.length, 0);
  f.advance(1000);
  assert.equal((await service.deliver(first)).sent, 1); assert.equal(calls.length, 1);
});

test('failed notification is retryable and concurrent dispatch cannot send duplicates', async t => {
  const f = await fixture(t), calls = [];
  const first = await f.send(); f.advance(13000);
  let failed = true;
  const service = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false, callTelegram: async (_, params) => { calls.push(params); if (failed) throw new Error('temporary'); return { message_id: 11 }; } });
  assert.equal((await service.tick()).failed, 1);
  failed = false;
  const result = await Promise.all([service.tick(), service.deliver(first)]);
  assert.equal(result.reduce((sum, item) => sum + item.sent, 0), 1);
  assert.equal(calls.length, 2);
});

test('a checkpoint flush failure after Telegram acceptance cannot immediately resend a successful message', async t => {
  const f = await fixture(t), calls = [];
  const first = await f.send(); f.advance(13000);
  let flushes = 0;
  const store = { run: callback => f.store.run(callback), async flush() { if (++flushes === 2) throw new Error('temporary persistence failure after send'); await f.store.flush(); } };
  const service = createReactionNotificationService({ store, now: f.now, localTimers: false, callTelegram: async (_, params) => { calls.push(params); return { message_id: 21 }; } });
  assert.equal((await service.deliver(first)).failed, 1, 'worker signals retry until the checkpoint has been persisted');
  assert.equal(calls.length, 1);
  assert.equal((await service.deliver(first)).sent, 0);
  assert.equal(calls.length, 1, 'in-memory sent checkpoint survives a failed flush');
  await f.restart();
  const restarted = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false, callTelegram: async () => { throw new Error('must remain sent after restart'); } });
  assert.equal((await restarted.deliver(first)).sent, 0);
});

test('a cloud callback delayed past its deadline sends the final burst once and ignores older retries', async t => {
  const f = await fixture(t), tasks = [], calls = [];
  const service = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false, enqueueTask: async task => { tasks.push(task); return { name: 'delayed-task' }; }, callTelegram: async (_, params) => { calls.push(params); return { message_id: 22 }; } });
  await service.afterReaction(await f.send());
  f.advance(2500); await service.afterReaction(await f.send());
  f.advance(60000);
  assert.equal((await service.deliver(tasks[0])).sent, 1);
  assert.equal(calls[0].text, 'Kojun sent you ❤️ ×2');
  assert.equal((await service.deliver(tasks[0])).sent, 0);
  assert.equal((await service.tick()).sent, 0);
  assert.equal(calls.length, 1);
});

test('removed members and unbound/group chats do not receive private reactions', async t => {
  for (const mode of ['removed', 'unbound', 'group']) {
    const f = await fixture(t), calls = [];
    await f.send(); f.advance(13000);
    await f.store.run(db => { if (mode === 'removed') db.circles.circle.members = ['a']; else if (mode === 'unbound') delete db.telegram.preferences.b; else db.telegram.preferences.b.chatId = '-100202'; });
    const service = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false, callTelegram: async (...args) => { calls.push(args); return { message_id: 12 }; } });
    assert.equal((await service.tick()).sent, 0); assert.equal(calls.length, 0);
  }
});

test('a stale private preference belonging to another account cannot receive a reaction', async t => {
  const f = await fixture(t), calls = [];
  await f.send(); f.advance(13000);
  await f.store.run(db => {
    db.telegram.preferences.b = { chatId: '101', chatType: 'private', language: 'en' };
    db.identities = { 'telegram:101': 'a' };
  });
  const service = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false, callTelegram: async (_, params) => { calls.push(params); return { message_id: 31 }; } });
  assert.equal((await service.tick()).sent, 0);
  assert.equal(calls.length, 0, 'never send the recipient notification back to the other account');
});

test('a group preference falls back only to the selected member verified private identity and profile language', async t => {
  const f = await fixture(t), calls = [];
  await f.send(); f.advance(13000);
  await f.store.run(db => {
    db.telegram.preferences.b = { chatId: '999', chatType: 'group', language: 'en' };
    db.identities = { 'telegram:101': 'a', 'telegram:202': 'b' };
  });
  const service = createReactionNotificationService({ store: f.store, now: f.now, localTimers: false, callTelegram: async (_, params) => { calls.push(params); return { message_id: 32 }; } });
  assert.equal((await service.tick()).sent, 1);
  assert.deepEqual(calls, [{ chat_id: '202', text: 'Від Kojun тобі ❤️', disable_notification: true }]);
});

test('notification copy omits count for a single emoji and uses natural recipient-language wording', () => {
  assert.equal(reactionNotificationText({ name: '芝士', emoji: '😀', count: 1 }, 'zh'), '芝士给你发了 😀');
  assert.equal(reactionNotificationText({ name: 'Kojun', emoji: '🥰', count: 3 }, 'uk'), 'Від Kojun тобі 🥰 ×3');
  assert.equal(reactionNotificationText({ name: 'Cheese', emoji: '😀', count: 1 }, 'en'), 'Cheese sent you 😀');
});

test('Cloud Tasks queue uses an authenticated scheduled JSON callback with a stable id and no bot token', async () => {
  const requests = [];
  const queue = createCloudTasksReactionQueue({ project: 'fixture-project', location: 'asia-northeast1', queue: 'reaction-notifications', publicUrl: 'https://pocket.example/', cronSecret: 'test-cron-secret',
    auth: { getClient: async () => ({ request: async options => { requests.push(options); return { data: { name: options.data.task.name } }; } }) },
  });
  const input = { circleId: 'circle', burstId: 'reaction-first', scheduledFor: start + 13000 };
  await queue(input); await queue(input);
  const request = requests[0];
  assert.equal(request.url, 'https://cloudtasks.googleapis.com/v2/projects/fixture-project/locations/asia-northeast1/queues/reaction-notifications/tasks');
  assert.equal(request.data.task.scheduleTime, new Date(start + 13000).toISOString());
  assert.equal(request.data.task.httpRequest.headers['X-Cron-Secret'], 'test-cron-secret');
  assert.equal(request.data.task.httpRequest.url, 'https://pocket.example/api/cron/reactions');
  assert.deepEqual(JSON.parse(Buffer.from(request.data.task.httpRequest.body, 'base64').toString()), input);
  assert.equal(request.data.task.name, requests[1].data.task.name);
  assert.equal(createCloudTasksReactionQueue({ project: '', queue: '' }), null);
});

test('Cloud Tasks duplicate names are treated as already scheduled and credentials never escape errors', async () => {
  let code = 409;
  const queue = createCloudTasksReactionQueue({ project: 'fixture-project', queue: 'reactions', publicUrl: 'https://pocket.example', cronSecret: 'secret-that-must-stay-private', auth: { getClient: async () => ({ request: async () => { throw { response: { status: code }, message: 'secret-that-must-stay-private' }; } }) } });
  const input = { circleId: 'circle', burstId: 'first', scheduledFor: start };
  assert.equal((await queue(input)).duplicate, true);
  code = 403;
  await assert.rejects(queue(input), error => error.message === 'reaction-task-enqueue-failed');
});
