import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateCirclePresence, circleMemberLocation } from '../circle-presence.mjs';

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
