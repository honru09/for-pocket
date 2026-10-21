import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateCirclePresence, circleMemberLocation } from '../circle-presence.mjs';
import { emptyState } from '../store.mjs';
import { ensureUser, handleDomain } from '../domain.mjs';

test('circle presence exposes only a fresh place label in the authorized circle', () => {
  const db={circles:{b:{ledgerId:'B',members:['a','b']},c:{ledgerId:'C',members:['a','c']}}}, now=10000000;
  updateCirclePresence(db,'a','B',{lat:35,lng:139,name:'Coffee shop',area:'新宿',countryCode:'JP'},now);
  assert.deepEqual(circleMemberLocation(db.circles.b,'a',now),{name:'Coffee shop',area:'新宿',countryCode:'JP'});
  assert.equal(db.circles.b.locations.a.location.lat,undefined);
  assert.equal(circleMemberLocation(db.circles.c,'a',now),undefined);
  assert.equal(circleMemberLocation(db.circles.b,'a',now+3600001),undefined);
  updateCirclePresence(db,'c','B',{name:'No membership'},now);
  assert.equal(db.circles.b.locations.c,undefined);
  updateCirclePresence(db,'a','B',null,now);
  assert.equal(circleMemberLocation(db.circles.b,'a',now),undefined);
});

test('unknown coordinates and departed members have no location label', () => {
  const db={circles:{b:{ledgerId:'B',members:['a','b']}}},now=Date.now();
  updateCirclePresence(db,'a','B',{lat:35,lng:139},now);
  assert.equal(circleMemberLocation(db.circles.b,'a',now),undefined);
  updateCirclePresence(db,'a','B',{name:'Station'},now);
  db.circles.b.members=['b'];
  assert.equal(circleMemberLocation(db.circles.b,'a',now),undefined);
});

test('an invitation preview contains member portraits but no locations before joining', () => {
  const db = emptyState(), now = Date.now(), options = { now, limit() {} };
  for (const id of ['101', '202']) ensureUser(db, `telegram:${id}`);
  const profile = handleDomain(db, '101', '/circles/create', 'POST', { name: 'Us' }, options);
  const circleId = profile.social.activeCircleId, circle = db.circles[circleId];
  updateCirclePresence(db, '101', circle.ledgerId, { name: 'Private cafe', area: 'Private neighborhood', countryCode: 'JP' }, now);
  const invite = handleDomain(db, '101', '/circles/invite', 'POST', { circleId }, options);
  const preview = handleDomain(db, '202', '/circles/preview', 'POST', { code: invite.code }, options);
  assert.equal(preview.alreadyMember, false);
  assert.equal(preview.circle.members.length, 1);
  assert.equal(preview.circle.members[0].avatar, 'cloud');
  assert.equal(preview.circle.members[0].location, undefined);
  const joined = handleDomain(db, '202', '/circles/join', 'POST', { code: invite.code, confirm: true }, options);
  assert.equal(joined.social.activeCircle.members.find(member => member.id === 'u_101').location.name, 'Private cafe');
});
