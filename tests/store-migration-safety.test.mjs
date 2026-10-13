import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.mjs';

function oldState() {
  const records = ['a','b'].map(owner => ({id:`expense-${owner}`,consumer:`u_${owner}`,createdBy:owner,ledgerId:owner,amountMinor:100}));
  return {version:2,revision:4,users:{a:{},b:{}},identities:{},sessions:{},links:{},
    circles:{shared:{id:'shared',ledgerId:'shared',members:['a','b']}},
    ledgers:Object.fromEntries(['a','b','shared'].map(id=>[id,{expenses:structuredClone(records)}]))};
}

async function fixture(t, initial=oldState()) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'for-migration-safety-'));
  const primary=path.join(dir,'_pocket-v2.json'), backup=path.join(dir,'_pocket-before-owned-ledgers-v2.json');
  const bytes=JSON.stringify(initial,null,2);
  await writeFile(primary,bytes);
  const store=createStore(dir,{debounceMs:60000,logger:{error() {}}});
  t.after(async()=>{await store.close(); assert.equal(path.dirname(dir),path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('for-migration-safety-')); await rm(dir,{recursive:true,force:true});});
  return {dir,primary,backup,bytes,initial,store};
}

test('ownership migration finishes a byte-exact recovery copy before exposing or persisting corrected data',async t=>{
  const f=await fixture(t);
  const migrated=await f.store.run(async db=>{
    assert.equal(await readFile(f.backup,'utf8'),f.bytes,'backup is complete before the first callback');
    assert.equal(await readFile(f.primary,'utf8'),f.bytes,'original file is unchanged before flush');
    return structuredClone(db);
  });
  assert.deepEqual(migrated.ledgers.a.expenses.map(entry=>entry.id),['expense-a']);
  assert.deepEqual(migrated.ledgers.b.expenses.map(entry=>entry.id),['expense-b']);
  await f.store.flush();
  assert.equal(JSON.parse(await readFile(f.primary,'utf8')).ledgerSyncVersion,2);
  assert.equal(await readFile(f.backup,'utf8'),f.bytes);
});

test('an existing valid recovery copy is never overwritten by another migration attempt',async t=>{
  const f=await fixture(t), originalBackup=JSON.stringify({...f.initial,revision:2,marker:'first backup'},null,2);
  await writeFile(f.backup,originalBackup);
  await f.store.run(()=>{}); await f.store.flush();
  assert.equal(await readFile(f.backup,'utf8'),originalBackup);
});

test('a failed backup cannot cache unmigrated state or let the next request bypass the backup',async t=>{
  const f=await fixture(t), originalWrite=fs.writeFile;
  const failure=Object.assign(new Error('simulated backup I/O failure'),{code:'EIO'});
  const mock=t.mock.method(fs,'writeFile',async(filename,...args)=>{if(path.resolve(String(filename))===f.backup) throw failure; return originalWrite(filename,...args);});
  syncBuiltinESMExports();
  let callbacks=0;
  try {
    for(let attempt=0;attempt<2;attempt++) await assert.rejects(f.store.run(db=>{callbacks++;db.unsafeMutation=true;}),{code:'EIO'});
    assert.equal(callbacks,0);
    await f.store.flush();
    assert.equal(await readFile(f.primary,'utf8'),f.bytes);
    await assert.rejects(readFile(f.backup),{code:'ENOENT'});
  } finally {mock.mock.restore();syncBuiltinESMExports();}
  await f.store.run(()=>{});await f.store.flush();
  assert.equal(await readFile(f.backup,'utf8'),f.bytes,'retry can migrate safely after storage recovers');
});

test('an existing truncated backup blocks migration and leaves both files untouched',async t=>{
  const f=await fixture(t), truncated='{"version":2,"users":';
  await writeFile(f.backup,truncated);
  for(let attempt=0;attempt<2;attempt++) await assert.rejects(f.store.run(()=>assert.fail('no callback without a usable backup')),SyntaxError);
  await f.store.flush();
  assert.equal(await readFile(f.primary,'utf8'),f.bytes);
  assert.equal(await readFile(f.backup,'utf8'),truncated,'do not overwrite a damaged recovery file');
});

test('projection failure never persists a partially migrated version or blocks a repaired retry',async t=>{
  const malformed=oldState();malformed.ledgers.shared.expenses={invalid:'not an array'};
  const f=await fixture(t,malformed);
  await assert.rejects(f.store.run(()=>assert.fail('invalid data must not reach the callback')),TypeError);
  await f.store.flush();
  assert.equal(await readFile(f.primary,'utf8'),f.bytes,'migration marker is not committed on failure');
  assert.equal(await readFile(f.backup,'utf8'),f.bytes,'the original malformed source is recoverable');
  await writeFile(f.primary,JSON.stringify(oldState()));
  const migrated=await f.store.run(db=>structuredClone(db));
  assert.equal(migrated.ledgerSyncVersion,2);
  assert.equal(migrated.ledgers.a.expenses.length,1,'the same store retries load after the source is repaired');
});
