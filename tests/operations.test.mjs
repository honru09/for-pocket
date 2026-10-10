import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { backupData } from '../scripts/backup-data.mjs';
import { restoreData } from '../scripts/restore-data.mjs';
import { verifyDeployment } from '../scripts/verify-deployment.mjs';
import { createApp } from '../server.mjs';
import { emptyState } from '../store.mjs';

async function scratch(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'for-ops-test-'));
  t.after(async () => { assert.equal(path.dirname(dir),path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('for-ops-test-')); await rm(dir,{recursive:true,force:true}); });
  return dir;
}
async function listen(t, server) {
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
test('backup restores byte-identical data and refuses corrupt backups or overwrites', async t => {
  const dir = await scratch(t), source = JSON.stringify({...emptyState(),revision:7});
  await writeFile(path.join(dir,'_pocket-v2.json'),source);
  const backup = await backupData(dir,path.join(dir,'backups'));
  assert.equal(await readFile(path.join(dir,'_pocket-v2.json'),'utf8'),source);
  const restored = path.join(dir,'restored');
  await restoreData(backup.directory,restored);
  assert.equal(await readFile(path.join(restored,'_pocket-v2.json'),'utf8'),source);
  await assert.rejects(restoreData(backup.directory,restored),/must be empty/);
  await writeFile(path.join(backup.directory,'_pocket-v2.json'),'{}');
  await assert.rejects(restoreData(backup.directory,path.join(dir,'corrupt')),/checksum/);
  await assert.rejects(readdir(path.join(dir,'corrupt')), {code:'ENOENT'});
  await assert.rejects(backupData(path.join(dir,'backups'),path.join(dir,'empty')),/No ledger/);
});
test('deployment check verifies real assets and rejects missing configured providers or wrong release', async t => {
  const base = await listen(t,createApp({token:'test-only',googleClientId:'client.apps.googleusercontent.com',dataDir:await scratch(t)}));
  const result = await verifyDeployment(base,{version:'0.5.0',requireGoogle:true,requireTelegram:true});
  assert.ok(result.assets >= 2);
  await assert.rejects(verifyDeployment(base,{version:'0.4.0'}),/Expected version/);
  await assert.rejects(verifyDeployment(base,{commit:'not-deployed'}),/expected commit/);
  const unconfigured = await listen(t,createApp({token:'',googleClientId:'',dataDir:await scratch(t)}));
  await assert.rejects(verifyDeployment(unconfigured,{requireGoogle:true}),/Google/);
  await assert.rejects(verifyDeployment(unconfigured,{requireTelegram:true}),/Telegram/);
});
test('deployment check detects SPA fallbacks masquerading as built assets', async t => {
  const base = await listen(t,http.createServer((req,res) => {
    if (['/healthz','/api/config'].includes(req.url)) { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:true,version:'0.5.0',commit:null})); }
    else { res.setHeader('Content-Type','text/html'); res.end('<script src="/assets/missing.js"></script><link href="/assets/missing.css">'); }
  }));
  await assert.rejects(verifyDeployment(base,{version:'0.5.0'}),/invalid content type/);
});
