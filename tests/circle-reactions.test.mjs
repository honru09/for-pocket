import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { normalizeReactionEmoji } from '../public/reactions.mjs';

const token = '123456789:reaction-fixture';
function signed(id, now) {
  const fields = { auth_date: String(Math.floor(now / 1000)), user: JSON.stringify({ id, first_name: `Member ${id}` }) };
  const text = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(text).digest('hex') }).toString();
}
async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-reactions-'));
  let server, base, time = Date.now();
  async function start() {
    server = createApp({ token, dataDir, now: () => time });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api`;
  }
  await start();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-reactions-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  const request = async (route, user = 101, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Telegram-Init-Data': signed(user, time) } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  const created = (await request('/circles/create', 101, { name: 'Together' })).data;
  const circleId = created.social.activeCircleId, ledgerId = created.ledgerId;
  const invite = (await request('/circles/invite', 101, { circleId })).data;
  await request('/circles/join', 202, { code: invite.code, confirm: true });
  return { request, circleId, ledgerId, advance: n => { time += n; }, restart: async () => { await new Promise(resolve => server.close(resolve)); await start(); } };
}
const payload = (f, id = 'reaction-0001', emoji = '❤️') => ({ id, emoji, recipientId: 'u_202', circleId: f.circleId, ledgerId: f.ledgerId });

test('single emoji supports flags, modifiers and ZWJ without accepting messages or HTML', () => {
  for (const emoji of ['❤️', '😀', '♥', '🇯🇵', '👩🏽‍❤️‍👩🏻', '1️⃣', '🫶🏽']) assert.equal(normalizeReactionEmoji(emoji), emoji);
  for (const invalid of ['', 'hi', '1', '❤️😀', '<b>😀</b>', 'hello❤️', null]) assert.equal(normalizeReactionEmoji(invalid), null);
});

test('circle reactions reach only the chosen member, persist and are idempotent', async t => {
  const f = await fixture(t), r = f.request, input = payload(f);
  assert.equal((await r('/circles/reactions', null, input)).status, 401);
  for (let n = 0; n < 2; n++) assert.equal((await r('/circles/reactions', 101, input)).status, 200);
  assert.equal((await r('/circles/reactions', 101)).data.items.length, 0);
  await f.restart();
  const inbox = (await r('/circles/reactions', 202)).data;
  assert.equal(inbox.circleId, f.circleId); assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].emoji, '❤️'); assert.equal(inbox.items[0].sender.id, 'u_101');
  assert.equal((await r('/circles/reactions/ack', 101, { circleId:f.circleId, ids:[input.id] })).status, 200);
  assert.equal((await r('/circles/reactions', 202)).data.items.length, 1, 'sender cannot acknowledge the receiver inbox');
  assert.equal((await r('/circles/reactions/ack', 202, { circleId:f.circleId, ids:[input.id] })).status, 200);
  assert.equal((await r('/circles/reactions', 202)).data.items.length, 0);
  await r('/circles/reactions', 101, input);
  assert.equal((await r('/circles/reactions', 202)).data.items.length, 0, 'a retried send cannot replay an acknowledged reaction');
});

test('reactions reject stale circles, strangers, identity forgery and non-emoji content', async t => {
  const f = await fixture(t), r = f.request;
  assert.equal((await r('/circles/reactions', 303, payload(f))).status, 409);
  assert.equal((await r('/circles/reactions', 101, { ...payload(f), recipientId:'u_303' })).status, 403);
  assert.equal((await r('/circles/reactions', 101, { ...payload(f), recipientId:'u_101' })).status, 403);
  assert.equal((await r('/circles/reactions', 101, payload(f, 'reaction-0001', '<img>'))).status, 400);
  await r('/circles/reactions', 101, { ...payload(f), from:'u_202' });
  assert.equal((await r('/circles/reactions', 202)).data.items[0].sender.id, 'u_101');
  assert.equal((await r('/circles/reactions', 202, { ...payload(f), recipientId:'u_101' })).status, 409);
  await r('/circles/switch', 101, { circleId:null });
  assert.equal((await r('/circles/reactions', 101, payload(f, 'reaction-0002'))).status, 409);
});

test('rapid sends remain independent and removed members cannot read or send', async t => {
  const f = await fixture(t), r = f.request;
  const sends = await Promise.all(Array.from({length:20}, (_,n) => r('/circles/reactions', 101, payload(f, `reaction-${String(n).padStart(4,'0')}`, n % 2 ? '😀' : '❤️'))));
  assert.ok(sends.every(item => item.status === 200));
  assert.equal((await r('/circles/reactions', 202)).data.items.length, 20);
  await r('/circles/remove', 101, { circleId:f.circleId, memberId:'u_202', confirm:true });
  assert.equal((await r('/circles/reactions', 202)).status, 403);
  assert.equal((await r('/circles/reactions', 101, payload(f, 'reaction-new-01'))).status, 403);
});

test('old undelivered emoji expire after seven days', async t => {
  const f = await fixture(t);
  await f.request('/circles/reactions',101,payload(f));
  f.advance(7*86400000+1);
  assert.equal((await f.request('/circles/reactions',202)).data.items.length,0);
});
