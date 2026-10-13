import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/assets/ui-kit-v1/', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const gallery = await readFile(path.join(root, 'index.html'), 'utf8');
const extendedGallery = await readFile(path.join(root, manifest.previewV2 || 'index.html'), 'utf8');
assert.ok(manifest.illustrations.length >= 4);
assert.ok(manifest.icons.length >= 16);
assert.equal(new Set(manifest.icons.map(item => item.id)).size, manifest.icons.length);
const sizes = [];
for (const item of manifest.illustrations) {
  const data = await readFile(path.join(root, item.file));
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(data.readUInt32BE(16), item.width, `${item.id} width`);
  assert.equal(data.readUInt32BE(20), item.height, `${item.id} height`);
  assert.ok(gallery.includes(`src="${item.file}"`) || extendedGallery.includes(`src="${item.file}"`));
  sizes.push({ id:item.id, width:item.width, height:item.height, bytes:data.length });
}
const sprite = await readFile(path.join(root, manifest.sprite), 'utf8');
for (const item of manifest.icons) {
  const svg = await readFile(path.join(root, item.file), 'utf8');
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /stroke-width="1\.6"/);
  assert.doesNotMatch(svg, /<script|foreignObject|onload=|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
  assert.ok(sprite.includes(`id="${item.id}"`));
  assert.ok(gallery.includes(`id="${item.id}"`) || extendedGallery.includes(`#${item.id}`));
}
assert.equal((await readdir(path.join(root, 'icons'))).filter(name => name.endsWith('.svg')).length, manifest.icons.length);
const copy = JSON.parse(await readFile(path.join(root, manifest.copy), 'utf8'));
for (const key of ['emptyLedger','importReview','circleInvite','saveUnconfirmed']) {
  for (const language of ['zh','en','uk']) for (const field of ['title','body','action']) {
    assert.ok(copy[key][language][field].trim(), `${key}.${language}.${field}`);
  }
}
const prompts = JSON.parse(await readFile(path.join(root, manifest.prompts), 'utf8'));
assert.equal(prompts.assets.length, manifest.illustrations.length);
for (const item of manifest.illustrations) assert.ok(prompts.assets.some(prompt => prompt.key === item.id && prompt.prompt.length > 500));
for (const file of ['README.md', manifest.sprite, manifest.copy, manifest.prompts, manifest.components, manifest.previewV2, ...manifest.frames]) assert.ok((await stat(path.join(root,file))).isFile());
assert.doesNotMatch(gallery, /<script[^>]+src=|<link[^>]+href="https?:/i);
console.log(JSON.stringify({ status:'passed', illustrations:manifest.illustrations.length, icons:manifest.icons.length, languages:3, sizes, frames:manifest.frames.length, note:'Structure verification; visual and browser checks recorded separately.' }, null, 2));
