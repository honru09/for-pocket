import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readClipboardQuietly } from '../src/clipboard-client.mjs';

test('switching views cannot open native Paste UI without a persistent permission grant', async () => {
  let reads=0;
  const clipboard={readText:async()=>{reads++;return 'Paid ¥850';}};
  for (const permissions of [undefined, {query:async()=>{throw new TypeError('unsupported permission');}}, {query:async()=>({state:'prompt'})}, {query:async()=>({state:'denied'})}]) {
    assert.equal(await readClipboardQuietly({clipboard,permissions}),'');
  }
  assert.equal(reads,0,'Safari readText must not be called from a navigation effect');
});

test('a browser with an existing clipboard grant can still suggest copied bills silently', async () => {
  assert.equal(await readClipboardQuietly({permissions:{query:async()=>({state:'granted'})},clipboard:{readText:async()=>'Paid ¥850'}}),'Paid ¥850');
  assert.equal(await readClipboardQuietly({permissions:{query:async()=>({state:'granted'})},clipboard:{readText:async()=>{throw new Error('unfocused');}}}),'');
});
