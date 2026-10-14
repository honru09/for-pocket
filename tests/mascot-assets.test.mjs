import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/mascot');
const files = [
  'mascot-expressions-atlas-v1.png',
  'mascot-tap-frames-v1.png',
  'mascot-cash-frames-v1.png',
  'mascot-pop-frames-v1.png',
];

test('mascot atlases keep a registered transparent 4x2 RGBA layout', async () => {
  for (const name of files) {
    const data = await readFile(path.join(root, name));
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name} PNG signature`);
    assert.equal(data.readUInt32BE(16), 1774, `${name} width`);
    assert.equal(data.readUInt32BE(20), 887, `${name} height`);
    assert.equal(data[25], 6, `${name} must be RGBA`);
    assert.equal(data[24], 8, `${name} must use 8-bit channels`);
    assert.ok(data.includes(Buffer.from('IEND')), `${name} must be complete`);
  }
});
