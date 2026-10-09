import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { validateInitData } from '../auth.mjs';
import { dateKey, resolveLanguage } from '../public/shared.mjs';

const token = '123456789:test-only-not-a-real-bot-token';
function signed(userId = 101, authDate = Math.floor(Date.now() / 1000), languageCode = 'zh') {
  const fields = { auth_date: String(authDate), query_id: 'test-query', user: JSON.stringify({ id: userId, first_name: '测试用户', language_code: languageCode }) };
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
  async function request(route, { user = 101, method = 'GET', body, auth = signed(user), origin, headers = {} } = {}) {
    const response = await fetch(base + '/api' + route, { method, headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': auth, ...(origin ? { Origin: origin } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await request('/profile', { auth: '' })).status, 401);
  assert.equal((await request('/settings', { method: 'PUT', origin: 'https://untrusted.example', body: {} })).status, 403);
  assert.equal((await request('/settings', { method: 'PUT', origin: 'https://web.telegram.org', body: { currency: 'JPY', language: 'zh', categories: [] } })).status, 400); // 400 due to empty categories, not 403 origin!
  assert.equal((await request('/settings', { method: 'PUT', origin: 'null', body: { currency: 'JPY', language: 'zh', categories: [] } })).status, 400); // not 403!
  assert.equal((await request('/settings', { method: 'PUT', origin: 'https://for-pocket.onrender.com', headers: { 'X-Forwarded-Host': 'for-pocket.onrender.com' }, body: { currency: 'JPY', language: 'zh', categories: [] } })).status, 400); // not 403!
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

test('auto-detects Telegram language and preserves manual language choice', async t => {
  assert.equal(resolveLanguage('zh-CN'), 'zh');
  assert.equal(resolveLanguage('zh-Hans'), 'zh');
  assert.equal(resolveLanguage('uk-UA'), 'uk');
  assert.equal(resolveLanguage('ru'), 'uk');
  assert.equal(resolveLanguage('en-US'), 'en');
  assert.equal(resolveLanguage('ja'), 'en');

  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-pocket-lang-test-'));
  const server = createApp({ token, dataDir });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  async function request(route, { user = 301, method = 'GET', body, lang = 'zh' } = {}) {
    const response = await fetch(base + '/api' + route, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': signed(user, undefined, lang) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }

  // Ukrainian Telegram user defaults to Ukrainian
  const ukUser = await request('/profile', { user: 401, lang: 'uk' });
  assert.equal(ukUser.status, 200);
  assert.equal(ukUser.data.settings.language, 'uk');

  // English Telegram user defaults to English
  const enUser = await request('/profile', { user: 402, lang: 'en' });
  assert.equal(enUser.status, 200);
  assert.equal(enUser.data.settings.language, 'en');

  // Chinese Telegram user defaults to Chinese
  const zhUser = await request('/profile', { user: 403, lang: 'zh-Hans' });
  assert.equal(zhUser.status, 200);
  assert.equal(zhUser.data.settings.language, 'zh');

  // Manual language change takes precedence
  const updated = await request('/settings', {
    user: 403,
    method: 'PUT',
    lang: 'zh-Hans',
    body: { ...zhUser.data.settings, language: 'en', languageManual: true },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.settings.language, 'en');

  // Re-opening still preserves manual choice
  const reopenedZh = await request('/profile', { user: 403, lang: 'zh-Hans' });
  assert.equal(reopenedZh.data.settings.language, 'en');
});

test('two-person shared ledger pairing, historical merge, real-time sync, and unpairing', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-pocket-share-test-'));
  const server = createApp({ token, dataDir });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  async function request(route, { user = 501, method = 'GET', body } = {}) {
    const response = await fetch(base + '/api' + route, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': signed(user) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }

  // User A and User B start with their own profiles
  const profileA = (await request('/profile', { user: 501 })).data;
  const profileB = (await request('/profile', { user: 502 })).data;

  assert.ok(profileA.share.code && profileA.share.code.length === 6);
  assert.ok(profileB.share.code && profileB.share.code.length === 6);
  assert.notEqual(profileA.share.code, profileB.share.code);
  assert.equal(profileA.share.isPaired, false);
  assert.equal(profileB.share.isPaired, false);

  // User A logs an expense
  const expA = await request('/expenses', {
    user: 501,
    method: 'POST',
    body: { id: 'exp-user-a-01', amountMinor: 1200, currency: 'JPY', categoryId: 'stomach', consumer: 'xingrun', note: 'A的拉面', timezone: 'Asia/Tokyo' }
  });
  assert.equal(expA.status, 200);

  // User B logs an expense independently
  const expB = await request('/expenses', {
    user: 502,
    method: 'POST',
    body: { id: 'exp-user-b-01', amountMinor: 800, currency: 'JPY', categoryId: 'hobby', consumer: 'liia', note: 'B的游戏', timezone: 'Asia/Tokyo' }
  });
  assert.equal(expB.status, 200);

  // User B fails to pair with non-existent code
  const failInvalid = await request('/pair', { user: 502, method: 'POST', body: { code: 'NONEXIST' } });
  assert.equal(failInvalid.status, 400); // not 6 chars

  const failNotFound = await request('/pair', { user: 502, method: 'POST', body: { code: 'ZZZZZZ' } });
  assert.equal(failNotFound.status, 404);

  // User B fails to pair with own code
  const failSelf = await request('/pair', { user: 502, method: 'POST', body: { code: profileB.share.code } });
  assert.equal(failSelf.status, 400);

  // User B pairs with User A's share code
  const pairedResult = await request('/pair', { user: 502, method: 'POST', body: { code: profileA.share.code } });
  assert.equal(pairedResult.status, 200);
  assert.equal(pairedResult.data.share.isPaired, true);

  // Both expenses are merged in the shared ledger!
  assert.equal(pairedResult.data.expenses.length, 2);
  const ids = pairedResult.data.expenses.map(e => e.id);
  assert.ok(ids.includes('exp-user-a-01'));
  assert.ok(ids.includes('exp-user-b-01'));

  // User A now fetches their profile, sees paired status and both expenses
  const freshA = (await request('/profile', { user: 501 })).data;
  assert.equal(freshA.share.isPaired, true);
  assert.equal(freshA.expenses.length, 2);

  // User B logs a new expense to the shared ledger
  const expB2 = await request('/expenses', {
    user: 502,
    method: 'POST',
    body: { id: 'exp-user-b-02', amountMinor: 350, currency: 'JPY', categoryId: 'daily', consumer: 'u_502', note: '共同牙膏', timezone: 'Asia/Tokyo' }
  });
  assert.equal(expB2.status, 200);

  // User A immediately sees User B's new expense
  const refreshedA = (await request('/profile', { user: 501 })).data;
  assert.equal(refreshedA.expenses.length, 3);
  assert.ok(refreshedA.expenses.some(e => e.id === 'exp-user-b-02'));

  // User B updates profile
  const updatedUserB = await request('/user-profile', {
    user: 502,
    method: 'PUT',
    body: { name: 'Liia 宝宝', color: 'milk', avatar: 'bunny' }
  });
  assert.equal(updatedUserB.status, 200);
  assert.equal(updatedUserB.data.user.name, 'Liia 宝宝');

  // User A checks profile, sees partner name updated
  const freshA2 = (await request('/profile', { user: 501 })).data;
  assert.equal(freshA2.share.partner.name, 'Liia 宝宝');

  // User B unpairs
  const unpairResult = await request('/unpair', { user: 502, method: 'POST' });
  assert.equal(unpairResult.status, 200);
  assert.equal(unpairResult.data.share.isPaired, false);
  // User B still has all 3 expenses from the shared ledger (no data loss)
  assert.equal(unpairResult.data.expenses.length, 3);

  // User A is also unpaired now
  const freshA3 = (await request('/profile', { user: 501 })).data;
  assert.equal(freshA3.share.isPaired, false);
  assert.equal(freshA3.expenses.length, 3);

  // New expense by A is no longer seen by B
  await request('/expenses', {
    user: 501,
    method: 'POST',
    body: { id: 'exp-user-a-solo', amountMinor: 999, currency: 'JPY', categoryId: 'stomach', consumer: 'xingrun', note: '独立咖啡', timezone: 'Asia/Tokyo' }
  });
  const soloA = (await request('/profile', { user: 501 })).data;
  const soloB = (await request('/profile', { user: 502 })).data;
  assert.equal(soloA.expenses.length, 4);
  assert.equal(soloB.expenses.length, 3);
});

test('income entries, Google login, cross-device sync codes, friends and Life360 circles (max 4)', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-pocket-circle-test-'));
  const server = createApp({ token, dataDir });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  async function request(route, { user = 601, method = 'GET', body, auth = signed(user), token: sessionToken, origin, headers = {} } = {}) {
    const authHeaders = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : { 'X-Telegram-Init-Data': auth };
    const response = await fetch(base + '/api' + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders, ...(origin ? { Origin: origin } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }

  // 1. Record income entry
  const incomeRes = await request('/expenses', {
    user: 601,
    method: 'POST',
    body: {
      id: 'inc-user-601-01',
      type: 'income',
      amountMinor: 300000,
      currency: 'JPY',
      categoryId: 'wage',
      consumer: 'u_601',
      note: '月薪入账',
      timezone: 'Asia/Tokyo'
    }
  });
  assert.equal(incomeRes.status, 200);
  assert.equal(incomeRes.data.type, 'income');
  assert.equal(incomeRes.data.amountMinor, 300000);

  const profile601 = (await request('/profile', { user: 601 })).data;
  assert.equal(profile601.expenses.length, 1);
  assert.equal(profile601.expenses[0].type, 'income');

  // 2. Google Login & Session
  const googleRes = await request('/auth/google', {
    auth: '',
    method: 'POST',
    body: { email: 'xingrun@example.com', sub: 'google-sub-601', name: 'Xingrun Google' }
  });
  assert.equal(googleRes.status, 200);
  assert.ok(googleRes.data.sessionToken);
  const googleToken = googleRes.data.sessionToken;

  // Read profile using Google session token
  const googleProfileRes = await request('/profile', { token: googleToken, auth: '' });
  assert.equal(googleProfileRes.status, 200);
  assert.equal(googleProfileRes.data.account.hasGoogle, true);

  // 3. Link Code (merge Google user with Telegram user 601)
  const linkCodeRes = await request('/auth/link-code', { user: 601, method: 'POST' });
  assert.equal(linkCodeRes.status, 200);
  assert.equal(linkCodeRes.data.code.length, 6);
  const syncCode = linkCodeRes.data.code;

  const verifyRes = await request('/auth/link-verify', {
    token: googleToken,
    auth: '',
    method: 'POST',
    body: { code: syncCode }
  });
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.data.ok, true);

  // After link, Google user sees the income recorded on Telegram!
  const unifiedGoogleProfile = (await request('/profile', { token: googleToken, auth: '' })).data;
  assert.equal(unifiedGoogleProfile.expenses.length, 1);
  assert.equal(unifiedGoogleProfile.expenses[0].id, 'inc-user-601-01');

  // 4. Friends & Circles (Life360 Model)
  // Create users 701, 702, 703, 704, 705
  const p701 = (await request('/profile', { user: 701 })).data;
  const p702 = (await request('/profile', { user: 702 })).data;
  const p703 = (await request('/profile', { user: 703 })).data;
  const p704 = (await request('/profile', { user: 704 })).data;
  const p705 = (await request('/profile', { user: 705 })).data;

  // 701 attempts to create circle with 702 before becoming friends -> 400
  const earlyCircle = await request('/circles/create', {
    user: 701,
    method: 'POST',
    body: { name: '早退圈', friendIds: ['702'] }
  });
  assert.equal(earlyCircle.status, 400);

  // 701 adds 702, 703, 704, 705 as friends via friend codes
  assert.equal((await request('/friends/add', { user: 701, method: 'POST', body: { friendCode: p702.social.myFriendCode } })).status, 200);
  assert.equal((await request('/friends/add', { user: 701, method: 'POST', body: { friendCode: p703.social.myFriendCode } })).status, 200);
  assert.equal((await request('/friends/add', { user: 701, method: 'POST', body: { friendCode: p704.social.myFriendCode } })).status, 200);
  assert.equal((await request('/friends/add', { user: 701, method: 'POST', body: { friendCode: p705.social.myFriendCode } })).status, 200);

  // Mutual friend check: 702 now has 701 in friends list
  const p702Friends = (await request('/profile', { user: 702 })).data;
  assert.ok(p702Friends.social.friends.some(f => f.userId === '701' || f.id === 'u_701'));

  // 701 tries to create circle with 4 friends (total 5 people) -> exceeds max 4
  const exceedCircle = await request('/circles/create', {
    user: 701,
    method: 'POST',
    body: { name: '超员圈', friendIds: ['702', '703', '704', '705'] }
  });
  assert.equal(exceedCircle.status, 400);

  // 701 creates circle with 3 friends (total 4 people) -> success
  const createCircleRes = await request('/circles/create', {
    user: 701,
    method: 'POST',
    body: { name: '温馨四人小窝', friendIds: ['702', '703', '704'] }
  });
  assert.equal(createCircleRes.status, 200);
  const circleId = createCircleRes.data.social.activeCircleId;
  assert.ok(circleId);

  // Active circle has 4 consumers
  assert.equal(createCircleRes.data.settings.consumers.length, 4);

  // 701 records an expense in the circle ledger
  const circleExpense = await request('/expenses', {
    user: 701,
    method: 'POST',
    body: {
      id: 'cir-exp-01',
      amountMinor: 12000,
      currency: 'JPY',
      categoryId: 'stomach',
      consumer: 'u_701',
      note: '四人家庭聚餐',
      timezone: 'Asia/Tokyo'
    }
  });
  assert.equal(circleExpense.status, 200);

  // 702 switches to this circle and sees the expense!
  const switch702 = await request('/circles/switch', {
    user: 702,
    method: 'POST',
    body: { circleId }
  });
  assert.equal(switch702.status, 200);
  assert.equal(switch702.data.expenses.length, 1);
  assert.equal(switch702.data.expenses[0].id, 'cir-exp-01');

  // 701 switches back to personal ledger -> circle expense not in personal ledger
  const switchBack701 = await request('/circles/switch', {
    user: 701,
    method: 'POST',
    body: { circleId: null }
  });
  assert.equal(switchBack701.status, 200);
  assert.equal(switchBack701.data.social.activeCircleId, null);
  assert.equal(switchBack701.data.expenses.length, 0);
});

