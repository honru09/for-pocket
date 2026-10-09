import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { validateInitData } from '../auth.mjs';
import { dateKey } from '../public/shared.mjs';

const token = '123456789:test-only-not-a-real-bot-token';
function signed(userId = 101, authDate = Math.floor(Date.now() / 1000)) {
  const fields = { auth_date: String(authDate), query_id: 'test-query', user: JSON.stringify({ id: userId, first_name: '测试用户' }) };
  const check = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
}
test('Telegram identity rejects unsigned, tampered, expired and duplicate data', () => {
  assert.equal(validateInitData(signed(), token).id, 101);
  assert.throws(() => validateInitData('user=101', token));
  const tampered = new URLSearchParams(signed()); tampered.set('user', JSON.stringify({ id: 202 }));
  assert.throws(() => validateInitData(tampered.toString(), token));
  assert.throws(() => validateInitData(signed(101, 1), token));
  assert.throws(() => validateInitData(signed() + '&auth_date=1', token));
  assert.throws(() => validateInitData(signed(), 'another-token'));
});
test('ledger persists, isolates users, saves concurrent requests, deduplicates retry and restores deletion', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-pocket-test-'));
  let server = createApp({ token, dataDir });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('for-pocket-test-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  async function request(route, { user = 101, method = 'GET', body, auth = signed(user), origin } = {}) {
    const response = await fetch(base + '/api' + route, { method, headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': auth, ...(origin ? { Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await request('/profile', { auth: '' })).status, 401);
  assert.equal((await request('/settings', { method: 'PUT', origin: 'https://untrusted.example', body: {} })).status, 403);
  const payload = { id: 'expense-test-001', amountMinor: 650, currency: 'JPY', categoryId: 'stomach', consumer: 'xingrun', note: '拉面 🍜', timezone: 'Asia/Tokyo' };
  const first = await request('/expenses', { method: 'POST', body: payload });
  assert.equal(first.status, 200); assert.equal(first.data.amountMinor, 650); assert.equal(first.data.note, '拉面 🍜');
  assert.equal(first.data.dayKey, dateKey(new Date(), 'Asia/Tokyo'));
  assert.equal(first.data.consumer, 'xingrun');
  const duplicate = await request('/expenses', { method: 'POST', body: payload });
  assert.equal(duplicate.data.createdAt, first.data.createdAt);
  assert.equal((await request('/profile')).data.expenses.length, 1);
  assert.equal((await request('/profile', { user: 202 })).data.expenses.length, 0);
  assert.equal((await request('/expenses/expense-test-001', { user: 202, method: 'DELETE' })).status, 404);
  assert.equal((await request('/expenses', { method: 'POST', body: { ...payload, id: 'expense-invalid-1', amountMinor: 1.5 } })).status, 400);
  assert.equal((await request('/expenses', { method: 'POST', body: { ...payload, id: 'expense-invalid-2', consumer: undefined } })).status, 400);
  assert.equal((await request('/expenses', { method: 'POST', body: { ...payload, id: 'expense-invalid-3', consumer: 'constructor' } })).status, 400);
  await Promise.all(Array.from({ length: 8 }, (_, i) => request('/expenses', { method: 'POST', body: { ...payload, id: `expense-concurrent-${i}`, amountMinor: 100 + i } })));
  let profile = (await request('/profile')).data;
  assert.equal(profile.expenses.length, 9);
  profile.settings.categories[0].label = '快乐吃饭';
  profile.settings.language = 'uk';
  assert.equal((await request('/settings', { method: 'PUT', body: profile.settings })).status, 200);
  profile = (await request('/profile')).data;
  assert.equal(profile.expenses[0].category.label, '胃', 'Old entries retain their original category');
  assert.equal(profile.settings.categories[0].label, '快乐吃饭');
  assert.equal(profile.settings.language, 'uk');
  assert.equal((await request('/expenses/expense-test-001', { method: 'DELETE' })).status, 200);
  assert.equal((await request('/profile')).data.expenses.length, 8);
  assert.equal((await request('/expenses/expense-test-001/restore', { method: 'POST' })).data.note, '拉面 🍜');
  assert.equal((await request('/profile')).data.expenses.find(e => e.id === 'expense-test-001').consumer, 'xingrun');
  assert.equal((await request('/profile')).data.expenses.length, 9);
  const max = await request('/expenses', { method: 'POST', body: { ...payload, id: 'expense-decimal-max', currency: 'CNY', amountMinor: 9999999999 } });
  assert.equal(max.status, 200);
  const liia = await request('/expenses', { method: 'POST', body: { ...payload, id: 'expense-liia-001', consumer: 'liia', amountMinor: 420 } });
  assert.equal(liia.status, 200); assert.equal(liia.data.consumer, 'liia');
  await new Promise(resolve => server.close(resolve));
  server = createApp({ token, dataDir }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  const reopened = (await request('/profile')).data;
  assert.equal(reopened.expenses.length, 11, 'Records survive a server restart');
  assert.equal(reopened.settings.language, 'uk');
  assert.equal(reopened.expenses.find(e => e.id === 'expense-liia-001').consumer, 'liia');
  assert.equal((await request('/profile', { user: 202 })).data.expenses.length, 0);
});
