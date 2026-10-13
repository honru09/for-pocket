import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

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

// Raster atlases are project-bound image assets, so structure checks also verify
// the PNG container and a real alpha channel. In particular, a checkerboard
// baked into an RGB image must not pass as a "transparent" atlas.
assert.ok(Array.isArray(manifest.rasters), 'manifest.rasters must be an array');
assert.ok(Array.isArray(prompts.rasterAssets), 'prompts.rasterAssets must be an array');
assert.equal(prompts.rasterAssets.length, manifest.rasters.length, 'raster prompt count');
assert.equal(new Set(manifest.rasters.map(item => item.id)).size, manifest.rasters.length, 'raster ids must be unique');
assert.equal(new Set(manifest.rasters.map(item => item.file)).size, manifest.rasters.length, 'raster files must be unique');
assert.equal(new Set(prompts.rasterAssets.map(item => item.key)).size, prompts.rasterAssets.length, 'raster prompt keys must be unique');
assert.equal(new Set(prompts.rasterAssets.map(item => item.file)).size, prompts.rasterAssets.length, 'raster prompt files must be unique');

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const rasterSizes = [];
const rasterFiles = new Set();

function paethPredictor(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function decodeRgbaAlpha(data, label) {
  assert.ok(data.length >= 33, `${label} PNG is too short`);
  assert.deepEqual(data.subarray(0, 8), pngSignature, `${label} PNG signature`);

  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  let sawIhdr = false;
  let sawIend = false;
  const idat = [];
  while (offset + 12 <= data.length) {
    const chunkLength = data.readUInt32BE(offset);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    assert.ok(chunkEnd + 4 <= data.length, `${label} PNG chunk exceeds file length`);
    const type = data.subarray(offset + 4, offset + 8).toString('ascii');
    const chunk = data.subarray(chunkStart, chunkEnd);
    if (type === 'IHDR') {
      assert.equal(chunkLength, 13, `${label} IHDR length`);
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      assert.equal(chunk[10], 0, `${label} PNG compression method`);
      assert.equal(chunk[11], 0, `${label} PNG filter method`);
      interlace = chunk[12];
      sawIhdr = true;
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') {
      assert.equal(chunkLength, 0, `${label} IEND length`);
      sawIend = true;
      break;
    }
    offset = chunkEnd + 4; // skip the CRC; validating the container is enough here
  }

  assert.ok(sawIhdr, `${label} missing IHDR`);
  assert.ok(sawIend, `${label} missing IEND`);
  assert.equal(colorType, 6, `${label} must be colorType 6 (RGBA)`);
  assert.equal(bitDepth, 8, `${label} must use 8-bit RGBA samples`);
  assert.equal(interlace, 0, `${label} must be non-interlaced RGBA`);
  assert.ok(width > 0 && height > 0, `${label} PNG dimensions must be positive`);
  assert.ok(idat.length > 0, `${label} missing IDAT`);

  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const scanlineSize = stride + 1;
  assert.equal(inflated.length, scanlineSize * height, `${label} RGBA scanline length`);

  let previous = Buffer.alloc(stride);
  let hasTransparent = false;
  let hasNearOpaque = false;
  let minAlpha = 255;
  let maxAlpha = 0;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * scanlineSize;
    const filter = inflated[rowStart];
    assert.ok(filter <= 4, `${label} unsupported PNG filter ${filter}`);
    const encoded = inflated.subarray(rowStart + 1, rowStart + scanlineSize);
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= 4 ? previous[x - 4] || 0 : 0;
      let value = encoded[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paethPredictor(left, up, upLeft);
      row[x] = value & 0xff;
    }
    for (let x = 3; x < stride; x += 4) {
      const alpha = row[x];
      if (alpha === 0) hasTransparent = true;
      if (alpha >= 250) hasNearOpaque = true;
      if (alpha < minAlpha) minAlpha = alpha;
      if (alpha > maxAlpha) maxAlpha = alpha;
    }
    previous = row;
  }
  assert.ok(hasTransparent, `${label} must contain fully transparent pixels`);
  assert.ok(hasNearOpaque, `${label} must contain near-opaque pixels (alpha >= 250)`);
  return { width, height, bitDepth, colorType, minAlpha, maxAlpha };
}

for (const item of manifest.rasters) {
  assert.equal(typeof item.id, 'string', 'raster id');
  assert.equal(typeof item.file, 'string', `${item.id} file`);
  const absolute = path.resolve(root, item.file);
  const relative = path.relative(root, absolute);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${item.id} file must stay inside the asset root`);
  assert.ok(item.file.toLowerCase().endsWith('.png'), `${item.id} must be a PNG`);
  const data = await readFile(absolute);
  const decoded = decodeRgbaAlpha(data, item.id);
  assert.equal(decoded.width, item.width, `${item.id} width`);
  assert.equal(decoded.height, item.height, `${item.id} height`);
  assert.ok(gallery.includes(`src="${item.file}"`) || extendedGallery.includes(`src="${item.file}"`), `${item.id} preview reference`);
  rasterFiles.add(item.file);
  rasterSizes.push({ id: item.id, width: decoded.width, height: decoded.height, bytes: data.length, minAlpha: decoded.minAlpha, maxAlpha: decoded.maxAlpha });
}

for (const prompt of prompts.rasterAssets) {
  assert.equal(typeof prompt.key, 'string', 'raster prompt key');
  assert.equal(typeof prompt.file, 'string', `${prompt.key} prompt file`);
  assert.ok(prompt.prompt?.trim(), `${prompt.key} raster prompt text`);
  const item = manifest.rasters.find(raster => raster.id === prompt.key);
  assert.ok(item, `${prompt.key} raster prompt must match manifest.rasters`);
  assert.equal(prompt.file, item.file, `${prompt.key} raster prompt file`);
  assert.ok(rasterFiles.has(prompt.file), `${prompt.key} raster prompt path exists`);
}
const rasterDirectoryPngs = new Set((await readdir(path.join(root, 'rasters'))).filter(name => name.toLowerCase().endsWith('.png')).map(name => `rasters/${name}`));
assert.deepEqual(rasterDirectoryPngs, rasterFiles, 'rasters directory must match manifest.rasters');

for (const file of ['README.md', manifest.sprite, manifest.copy, manifest.prompts, manifest.components, manifest.previewV2, ...manifest.frames]) assert.ok((await stat(path.join(root,file))).isFile());
assert.doesNotMatch(gallery, /<script[^>]+src=|<link[^>]+href="https?:/i);
console.log(JSON.stringify({ status:'passed', illustrations:manifest.illustrations.length, icons:manifest.icons.length, languages:3, sizes, rasters:rasterSizes, frames:manifest.frames.length, note:'Structure verification; visual and browser checks recorded separately.' }, null, 2));
