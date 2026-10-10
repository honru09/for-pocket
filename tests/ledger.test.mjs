import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { validateInitData } from '../auth.mjs';
import { initialSettings, MAX_CIRCLE_MEMBERS } from '../public/shared.mjs';

const token = '123456789:test-token', clientId = 'test-client.apps.googleusercontent.com';
export function signed(id = 101, time = Date.now(), lang = 'zh') {
  const fields = { auth_date: String(Math.floor(time / 1000)), user: JSON.stringify({ id, first_name: `User ${id}`, language_code: lang }) };
  const text = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(text).digest('hex') }).toString();
}
async function fixture(t, options = {}) {
  const dataDir = options.dataDir || await mkdtemp(path.join(os.tmpdir(), 'for-v05-test-'));
  let time = Date.now(), server, base;
  const start = async () => { server = createApp({ token, dataDir, googleClientId: clientId, now: () => time, verifyGoogle: async credential => { if (!/^verified-[ab]$/.test(credential)) throw new Error('Invalid signature fixture'); return { sub: credential, name: credential, email: `${credential}@example.test`, aud: clientId, iss: 'https://accounts.google.com', exp: Math.floor(time / 1000) + 3600 }; }, ...options }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; };
  await start();
  t.after(async () => { await new Promise(r => server.close(r)); assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir())); assert.ok(path.basename(dataDir).startsWith('for-v05-test-')); await rm(dataDir, { recursive:true, force:true }); });
  return { dataDir, advance: n => { time += n; }, restart: async () => { await new Promise(r => server.close(r)); await start(); },
    request: async (route, { user = 101, session, body, method = body ? 'POST' : 'GET', origin, headers = {} } = {}) => {
      const response = await fetch(base + '/api' + route, { method, headers: { 'Content-Type':'application/json', ...(session ? { Authorization:`Bearer ${session}` } : user ? { 'X-Telegram-Init-Data':signed(user, time) } : {}), ...(origin ? { Origin:origin } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      return { status:response.status, data:await response.json() };
    },
  };
}
const expense = (id, consumer, rest = {}) => ({ id, consumer, amountMinor:650, currency:'JPY', categoryId:'stomach', type:'expense', note:'拉面 🍜', timezone:'Asia/Tokyo', ...rest });
test('Telegram rejects forged, missing, expired and duplicated authentication', () => {
  assert.equal(validateInitData(signed(),token).id,101);
  assert.throws(() => validateInitData('',token));
  assert.throws(() => validateInitData(signed(101,1),token));
  assert.throws(() => validateInitData(signed() + '&auth_date=1',token));
  assert.throws(() => validateInitData(signed(), 'wrong'));
  const tampered = new URLSearchParams(signed()); tampered.set('user','{"id":202}'); assert.throws(() => validateInitData(tampered.toString(),token));
});
test('real identities, amount/type validation, concurrency, retry, deletion and restart', async t => {
  const f = await fixture(t), r = f.request;
  assert.equal((await r('/profile',{user:null})).status,401);
  const p = (await r('/profile')).data;
  assert.deepEqual(p.settings.consumers.map(c=>c.id), ['u_101']); assert.equal(p.account.hasTelegram,true);
  assert.equal((await r('/expenses',{body:expense('invalid-consumer','liia')})).status,400);
  assert.equal((await r('/expenses',{body:expense('invalid-type-001','u_101',{type:'nope'})})).status,400);
  assert.equal((await r('/expenses',{body:expense('invalid-money-01','u_101',{currency:'constructor'})})).status,400);
  assert.equal((await r('/expenses',{body:expense('wrong-pool-001','u_101',{type:'income'})})).status,400);
  assert.equal((await r('/settings',{method:'PUT',body:p.settings,origin:'https://evil.test'})).status,403);
  assert.equal((await r('/settings',{method:'PUT',body:p.settings,origin:'https://evil.test',headers:{'X-Forwarded-Host':'evil.test'}})).status,403);
  const payload = expense('entry-test-0001','u_101');
  const entry = await r('/expenses',{body:payload}); assert.equal(entry.status,200); assert.equal(entry.data.member.name,'User 101');
  assert.equal((await r('/expenses',{body:payload})).data.createdAt,entry.data.createdAt);
  const results = await Promise.all(Array.from({length:8},(_,i)=>r('/expenses',{body:expense(`concurrent-${i}`,'u_101')})));
  assert.ok(results.every(x=>x.status===200));
  assert.equal((await r('/profile',{user:202})).data.expenses.length,0);
  assert.equal((await r('/expenses/entry-test-0001',{user:202,method:'DELETE'})).status,404);
  assert.equal((await r('/expenses/entry-test-0001',{method:'DELETE'})).status,200);
  assert.equal((await r('/expenses/entry-test-0001/restore',{body:{}})).status,200);
  await r('/user-profile',{method:'PUT',body:{name:'New name',color:'mint',avatar:'fox'}});
  const renamed = (await r('/profile')).data; assert.equal(renamed.user.name,'New name'); assert.equal(renamed.expenses[0].member.name,'User 101');
  await r('/settings',{method:'PUT',body:{...renamed.settings,language:'uk',languageManual:true}});
  await f.restart(); const reloaded = (await r('/profile')).data;
  assert.equal(reloaded.expenses.length,9); assert.equal(reloaded.settings.language,'uk');
});

test('entry time supports backdated entries and edits with timezone grouping and permissions', async t => {
  const f=await fixture(t), r=f.request;
  const occurredAt='2026-09-30T16:30:00.000Z';
  const first=await r('/expenses',{body:expense('backdated-entry-1','u_101',{occurredAt})});
  assert.equal(first.status,200); assert.equal(first.data.dayKey,'2026-10-01');
  assert.equal(first.data.occurredAt,occurredAt); assert.notEqual(first.data.createdAt,occurredAt);
  const edit=await r('/expenses/backdated-entry-1',{method:'PUT',body:{occurredAt:'2026-08-31T16:30:00.000Z',timezone:'Europe/Kyiv'}});
  assert.equal(edit.status,200); assert.equal(edit.data.dayKey,'2026-08-31'); assert.equal(edit.data.createdAt,first.data.createdAt);
  assert.equal((await r('/expenses/backdated-entry-1',{method:'PUT',body:{occurredAt:'2026-02-30T10:00:00Z',timezone:'Asia/Tokyo'}})).status,400);
  assert.equal((await r('/expenses/backdated-entry-1',{method:'PUT',body:{occurredAt,timezone:'Invalid/Zone'}})).status,400);
  assert.equal((await r('/expenses/backdated-entry-1',{user:202,method:'PUT',body:{occurredAt,timezone:'Asia/Tokyo'}})).status,404);
  const created=(await r('/circles/create',{body:{name:'Time'}})).data;
  const invite=(await r('/circles/invite',{body:{circleId:created.social.activeCircleId}})).data;
  await r('/circles/join',{user:202,body:{code:invite.code,confirm:true}});
  await r('/expenses',{body:expense('shared-time-001','u_101')});
  assert.equal((await r('/expenses/shared-time-001',{user:202,method:'PUT',body:{occurredAt,timezone:'Asia/Tokyo'}})).status,403);
  await r('/circles/switch',{body:{circleId:null}});
  assert.equal((await r('/expenses/backdated-entry-1',{method:'PUT',body:{ledgerId:created.ledgerId,occurredAt,timezone:'Asia/Tokyo'}})).status,409);
  await f.restart(); const saved=(await r('/profile')).data.expenses[0]; assert.equal(saved.dayKey,'2026-08-31'); assert.equal(saved.timezone,'Europe/Kyiv');
});
test('equal splits persist across retries and restarts and only accept current circle members', async t => {
  const f = await fixture(t), r = f.request;
  const created = (await r('/circles/create', { body: { name: 'Shared meals' } })).data;
  const circleId = created.social.activeCircleId;
  const invite = (await r('/circles/invite', { body: { circleId } })).data;
  assert.equal((await r('/circles/join', { user: 202, body: { code: invite.code, confirm: true } })).status, 200);
  const participants = ['u_101', 'u_202'];
  const payload = expense('split-meal-0001', 'u_101', { splitMode: 'equal', splitParticipants: participants });
  const saved = await r('/expenses', { body: payload });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.splitMode, 'equal');
  assert.deepEqual(saved.data.splitParticipants, participants);
  assert.equal(saved.data.amountMinor, 650, 'splitting retains the full expense amount');
  const repeated = await r('/expenses', { body: payload });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.data.id, saved.data.id);
  assert.equal(repeated.data.createdAt, saved.data.createdAt, 'retry returns the same expense');
  assert.deepEqual(repeated.data.splitParticipants, participants);

  const invalid = [
    { splitMode: 'weighted', splitParticipants: participants },
    { splitMode: 'equal' },
    { splitMode: 'equal', splitParticipants: [] },
    { splitMode: 'equal', splitParticipants: 'u_101' },
    { splitMode: 'equal', splitParticipants: ['u_101', 'u_101'] },
    { splitMode: 'equal', splitParticipants: ['u_101', 'u_303'] },
    { splitMode: 'none', splitParticipants: participants },
    { splitMode: 'equal', splitParticipants: participants, type: 'income', categoryId: 'wage' },
  ];
  for (const [index, fields] of invalid.entries()) {
    assert.equal((await r('/expenses', { body: expense(`bad-split-${index}`, 'u_101', fields) })).status, 400,
      `invalid split must be rejected: ${JSON.stringify(fields)}`);
  }
  const plain = await r('/expenses', { body: expense('no-split-0001', 'u_101') });
  assert.equal(plain.status, 200);
  assert.equal(plain.data.splitMode, 'none');
  assert.deepEqual(plain.data.splitParticipants, []);
  const single = await r('/expenses', { body: expense('solo-split-0001', 'u_101', { splitMode: 'equal', splitParticipants: ['u_101'] }) });
  assert.equal(single.status, 200);

  await r('/circles/leave', { user: 202, body: { circleId, confirm: true } });
  assert.equal((await r('/expenses', { body: { ...payload, id: 'departed-split-1' } })).status, 400,
    'a departed member cannot be selected for a new split');
  await f.restart();
  const reloaded = (await r('/profile')).data.expenses;
  assert.equal(reloaded.length, 3, 'rejected and retried requests must not add records');
  assert.deepEqual(reloaded.find(entry => entry.id === payload.id).splitParticipants, participants,
    'historical splits retain their participants when a member leaves');
  assert.equal(reloaded.find(entry => entry.id === payload.id).splitMode, 'equal');
});

test('linking accounts remaps split participants in every ledger without duplicate shares', async t => {
  const f = await fixture(t), r = f.request;
  const login = await r('/auth/google', { user: null, body: { credential: 'verified-a' } });
  assert.equal(login.status, 200);
  const session = login.data.sessionToken, googleMember = login.data.profile.user.id;
  const personal = await r('/expenses', { session, body: expense('google-split-01', googleMember, {
    splitMode: 'equal', splitParticipants: [googleMember],
  }) });
  assert.equal(personal.status, 200);
  const circleId = (await r('/circles/create', { session, body: { name: 'Linked shares' } })).data.social.activeCircleId;
  const invite = (await r('/circles/invite', { session, body: { circleId } })).data;
  for (const user of [101, 202]) {
    assert.equal((await r('/circles/join', { user, body: { code: invite.code, confirm: true } })).status, 200);
  }
  const shared = await r('/expenses', { session, body: expense('merged-split-01', googleMember, {
    splitMode: 'equal', splitParticipants: [googleMember, 'u_101', 'u_202'],
  }) });
  assert.equal(shared.status, 200);
  const code = (await r('/auth/link-code', { body: {} })).data.code;
  assert.equal((await r('/auth/link-verify', { session, body: { code, confirm: true } })).status, 200);

  await f.restart();
  const circle = (await r('/profile', { session })).data;
  assert.equal(circle.user.id, 'u_101');
  assert.equal(circle.social.activeCircle.memberCount, 2);
  assert.equal(circle.expenses[0].consumer, 'u_101');
  assert.equal(circle.expenses[0].splitMode, 'equal');
  assert.deepEqual(circle.expenses[0].splitParticipants, ['u_101', 'u_202'],
    'the same person linked through two providers must receive only one share');
  await r('/circles/switch', { session, body: { circleId: null } });
  const mergedPersonal = (await r('/profile', { session })).data.expenses;
  assert.equal(mergedPersonal.length, 1);
  assert.equal(mergedPersonal[0].id, 'google-split-01');
  assert.equal(mergedPersonal[0].consumer, 'u_101');
  assert.deepEqual(mergedPersonal[0].splitParticipants, ['u_101']);
});

test('circle invitation requires acceptance; membership, admins, isolation, expiry and stale scope', async t => {
  const f = await fixture(t), r = f.request;
  const created = await r('/circles/create',{body:{name:'Home'}}); assert.equal(created.status,200);
  const id = created.data.social.activeCircleId, scope = created.data.ledgerId;
  assert.equal((await r('/circles/create',{body:{name:'Forced',friendIds:['u_202']}})).status,400);
  const invite = (await r('/circles/invite',{body:{circleId:id}})).data;
  assert.equal(invite.expiresAt > Date.now()+71*3600000,true);
  const preview = await r('/circles/preview',{user:202,body:{code:invite.code}});
  assert.equal(preview.data.circle.members.length,1);
  assert.equal((await r('/profile',{user:202})).data.social.circles.length,0);
  assert.equal((await r('/circles/join',{user:202,body:{code:invite.code}})).status,400);
  await r('/circles/join',{user:202,body:{code:invite.code,confirm:true}});
  await r('/circles/join',{user:202,body:{code:invite.code,confirm:true}});
  assert.equal((await r('/profile')).data.social.activeCircle.members.length,2);
  assert.equal((await r('/circles/rename',{user:202,body:{circleId:id,name:'No'}})).status,403);
  assert.equal((await r('/circles/switch',{user:303,body:{circleId:id}})).status,403);
  assert.equal((await r('/expenses',{body:expense('circle-income-01','u_202',{type:'income',categoryId:'wage',ledgerId:scope})})).status,200);
  assert.equal((await r('/profile',{user:202})).data.expenses.length,1);
  assert.equal((await r('/expenses/circle-income-01',{user:202,method:'DELETE'})).status,403);
  const memberInvite = await r('/circles/invite',{user:202,body:{circleId:id}}); assert.equal(memberInvite.status,200);
  await r('/circles/admin',{body:{circleId:id,memberId:'u_202',isAdmin:true}});
  assert.equal((await r('/expenses/circle-income-01',{user:202,method:'DELETE'})).status,200);
  await r('/circles/admin',{body:{circleId:id,memberId:'u_101',isAdmin:false}});
  assert.equal((await r('/circles/admin',{user:202,body:{circleId:id,memberId:'u_202',isAdmin:false}})).status,400);
  await r('/circles/switch',{body:{circleId:null}});
  assert.equal((await r('/expenses',{body:expense('stale-scope-001','u_101',{ledgerId:scope})})).status,409);
  assert.equal((await r('/profile')).data.expenses.length,0);
  await r('/circles/leave',{user:202,body:{circleId:id,confirm:true}});
  const owner = (await r('/profile')).data.social.circles[0]; assert.equal(owner.isAdmin,true); assert.equal(owner.members.length,1);
  assert.equal((await r('/circles/switch',{user:202,body:{circleId:id}})).status,403);
  const fresh = (await r('/circles/invite',{body:{circleId:id}})).data;
  f.advance(73*3600000); assert.equal((await r('/circles/preview',{user:303,body:{code:fresh.code}})).status,404);
});
test('Google rejects unverifiable credentials and links both records and circle identities atomically', async t => {
  const f = await fixture(t), r=f.request;
  assert.equal((await r('/auth/google',{user:null,body:{email:'victim@test',sub:'123'}})).status,401);
  assert.equal((await r('/auth/google',{user:null,body:{credential:'header.fake.signature'}})).status,401);
  const login = await r('/auth/google',{user:null,body:{credential:'verified-a'}}); assert.equal(login.status,200);
  const session=login.data.sessionToken, googleMember=login.data.profile.user.id;
  const googleSettings = login.data.profile.settings;
  googleSettings.categories.push({ id:'custom',label:'Coffee',icon:'coffee',color:'peach' });
  await r('/settings',{session,method:'PUT',body:googleSettings});
  await r('/expenses',{session,body:expense('google-expense-01',googleMember)});
  await r('/expenses',{body:expense('telegram-exp-01','u_101')});
  const googleCircle = (await r('/circles/create',{session,body:{name:'Travel'}})).data.social.activeCircleId;
  const link = (await r('/auth/link-code',{body:{}})).data;
  const preview = await r('/auth/link-preview',{session,body:{code:link.code}}); assert.equal(preview.data.target.id,'u_101');
  assert.equal((await r('/auth/link-verify',{session,body:{code:link.code}})).status,400);
  assert.equal((await r('/auth/link-verify',{session,body:{code:link.code,confirm:true}})).status,200);
  const fromGoogle = (await r('/profile',{session})).data;
  assert.equal(fromGoogle.user.id,'u_101'); assert.equal(fromGoogle.account.hasGoogle,true); assert.equal(fromGoogle.account.hasTelegram,true);
  assert.equal(fromGoogle.social.circles[0].members[0].id,'u_101'); assert.equal(fromGoogle.social.circles[0].isAdmin,true);
  await r('/circles/switch',{session,body:{circleId:null}});
  const merged=(await r('/profile')).data; assert.equal(merged.expenses.length,2); assert.ok(merged.expenses.every(e=>e.consumer==='u_101'));
  assert.ok(merged.settings.categories.some(c=>c.label==='Coffee'), 'custom categories survive account merge');
  await r('/circles/switch',{session,body:{circleId:googleCircle}});
  assert.equal((await r('/profile')).data.social.activeCircleId,googleCircle);
  assert.equal((await r('/auth/link-verify',{session,body:{code:link.code,confirm:true}})).status,404);
  const again=await r('/auth/google',{user:null,body:{credential:'verified-a'}}); assert.equal(again.data.profile.user.id,'u_101');
  await r('/auth/logout',{session,body:{}}); assert.equal((await r('/profile',{session})).status,401);
  await f.restart(); assert.equal((await r('/profile')).data.account.hasGoogle,true);
});
test('direct Google link needs confirmation and prevents conflicting provider merges', async t => {
  const f=await fixture(t), r=f.request;
  const link=await r('/auth/google',{body:{credential:'verified-a',link:true}}); assert.ok(link.data.linkTicket);
  assert.equal((await r('/profile')).data.account.hasGoogle,false);
  const merged=await r('/auth/link-verify',{body:{ticket:link.data.linkTicket,confirm:true}}); assert.equal(merged.status,200);
  const another=await r('/auth/google',{body:{credential:'verified-b',link:true}});
  assert.equal((await r('/auth/link-verify',{body:{ticket:another.data.linkTicket,confirm:true}})).status,409);
  const code=(await r('/auth/link-code',{body:{}})).data.code;
  f.advance(16*60000); assert.equal((await r('/auth/link-preview',{user:202,body:{code}})).status,404);
});
test('legacy files migrate without deleting entries or retaining fake default members/sessions', async t => {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'for-v05-test-'));
  const settings={...initialSettings(),consumers:[{id:'xingrun',name:'Xingrun',color:'blue',avatar:'cat'},{id:'liia',name:'Liia',color:'milk',avatar:'bunny'}]};
  const legacy={settings,expenses:[{...expense('legacy-entry-01','liia'),category:settings.categories[0],createdAt:new Date().toISOString(),dayKey:'2026-10-10'}]};
  await writeFile(path.join(dataDir,'101.json'),JSON.stringify(legacy));
  await writeFile(path.join(dataDir,'_shares.json'),JSON.stringify({userProfiles:{101:{name:'Actual user',color:'blue',avatar:'cat'}},sessions:{unsafe:{userId:'101',expiresAt:Date.now()+100000}}}));
  const f=await fixture(t,{dataDir}), p=(await f.request('/profile')).data;
  assert.deepEqual(p.settings.consumers.map(c=>c.name),['Actual user']); assert.equal(p.expenses[0].member.name,'Liia');
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir,'101.json'),'utf8')),legacy);
  assert.equal(JSON.parse(await readFile(path.join(dataDir,'_pocket-v2.json'),'utf8')).version,2);
  await f.restart(); assert.equal((await f.request('/profile')).data.expenses[0].member.name,'Liia');
  assert.equal((await f.request('/profile',{session:'unsafe'})).status,401);
});
test('capacity uses distinct members and blocked attempts do not mutate membership', async t => {
  const f=await fixture(t), r=f.request, created=(await r('/circles/create',{body:{name:'Capacity'}})).data;
  const id=created.social.activeCircleId, invite=(await r('/circles/invite',{body:{circleId:id}})).data;
  for(let i=0;i<MAX_CIRCLE_MEMBERS-1;i++) assert.equal((await r('/circles/join',{user:1000+i,body:{code:invite.code,confirm:true}})).status,200);
  assert.equal((await r('/circles/join',{user:9999,body:{code:invite.code,confirm:true}})).status,409);
  assert.equal((await r('/profile')).data.social.activeCircle.memberCount,MAX_CIRCLE_MEMBERS);
});
