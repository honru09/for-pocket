import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindForegroundRefresh } from '../src/foreground-refresh.mjs';

test('foreground location refresh listens to app activation without polling', async () => {
  const listeners = new Map(), calls = [];
  const doc = { hidden:false, addEventListener(name, fn) { listeners.set(`doc:${name}`, fn); }, removeEventListener() {} };
  const win = { addEventListener(name, fn) { listeners.set(`win:${name}`, fn); }, removeEventListener() {} };
  let now = 1000;
  const clean = bindForegroundRefresh({ document:doc, window:win, now:() => now, refresh:() => calls.push(now) });
  listeners.get('win:pageshow')();
  assert.deepEqual(calls, [1000]);
  listeners.get('win:focus')();
  assert.deepEqual(calls, [1000]);
  now += 1000;
  listeners.get('doc:visibilitychange')();
  assert.deepEqual(calls, [1000, 2000]);
  clean();
});
