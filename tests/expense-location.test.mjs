import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExpenseLocation } from '../src/expense-location.mjs';

const coords = { lat:35.69, lng:139.7 };
const payload = { id:'entry-one', amountMinor:850, location:coords };

test('a pending original capture enriches a saved entry without mutating the snapshot', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const write = resolveExpenseLocation(payload,pending);
  release({ ...coords, area:'新宿', countryCode:'JP' });
  assert.deepEqual((await write).location,{ ...coords, area:'新宿', countryCode:'JP' });
  assert.deepEqual(payload.location,coords);
});

test('an acquisition that finishes after save can attach only its own coordinates', async () => {
  assert.deepEqual((await resolveExpenseLocation({id:'no-coords-yet'},Promise.resolve({...coords,area:'新宿'}))).location,{...coords,area:'新宿'});
  assert.equal(await resolveExpenseLocation(payload,Promise.resolve({lat:40,lng:-73,area:'Somewhere else'})),payload);
  assert.equal(await resolveExpenseLocation(payload,Promise.resolve({area:'Unbound area'})),payload);
});

test('manually selected venue is preserved and network failures never block recording', async () => {
  const named = {...payload,location:{...coords,name:'Chosen place'}};
  assert.equal(await resolveExpenseLocation(named,new Promise(()=>{}),{timeoutMs:10}),named);
  assert.equal(await resolveExpenseLocation(payload,Promise.reject(new Error('offline'))),payload);
  assert.equal(await resolveExpenseLocation(payload,new Promise(()=>{}),{timeoutMs:10}),payload);
  assert.equal(await resolveExpenseLocation(payload),payload);
});
