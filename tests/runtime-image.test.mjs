import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('the production image contains every local backend import', async () => {
  const docker = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const runtime = docker.split('AS runner')[1];
  const files = await readdir(new URL('../', import.meta.url));
  const copied = new Set();
  for (const line of runtime.split('\n').filter(line => /^COPY\s/.test(line) && !line.includes('--from='))) {
    for (const source of line.trim().split(/\s+/).slice(1, -1)) {
      if (source === '*.mjs') files.filter(name => name.endsWith('.mjs')).forEach(name => copied.add(name));
      else copied.add(source);
    }
  }
  const visited = new Set();
  async function check(name) {
    if (visited.has(name)) return;
    visited.add(name);
    assert.ok(copied.has(name) || (name.startsWith('public/') && copied.has('public')), `Runtime image is missing ${name}`);
    const source = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\()['"]\.\/([^'"\s]+\.mjs)['"]/g)) {
      const dependency = new URL(match[1], new URL('../' + name, import.meta.url));
      const root = new URL('../', import.meta.url);
      await check(decodeURIComponent(dependency.pathname.slice(root.pathname.length)));
    }
  }
  await check('server.mjs');
  await check('bot.mjs');
});
