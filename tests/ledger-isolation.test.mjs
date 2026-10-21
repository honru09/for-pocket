import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncAllLedgerGroups, syncLedgerGroup } from '../ledger-sync.mjs';
import { handleDomain } from '../domain.mjs';
import { initialSettings } from '../public/shared.mjs';

const entry = (id, owner, ledgerId, fields = {}) => ({ id, consumer:`u_${owner}`, createdBy:owner, ledgerId, amountMinor:100, createdAt:'2026-10-13T03:00:00.000Z', ...fields });
function database() {
  return {
    users: { a:{}, b:{}, c:{}, d:{}, unrelated:{} },
    circles: { B:{ ledgerId:'B', members:['a','b'] }, C:{ ledgerId:'C', members:['a','c','d'] } },
    ledgers: Object.fromEntries(['a','b','c','d','B','C','unrelated'].map(id => [id,{expenses:[]}]))
  };
}
const ids = (db, ledger) => db.ledgers[ledger].expenses.map(e => e.id).sort();

test('own records reach every own circle; other members never cross circles or personal ledgers', () => {
  const db=database();
  db.ledgers.a.expenses=[entry('mine','a','a')];
  db.ledgers.B.expenses=[entry('from-B','b','B')];
  db.ledgers.C.expenses=[entry('from-C','d','C')];
  db.ledgers.unrelated.expenses=[entry('private','unrelated','unrelated')];
  assert.equal(syncAllLedgerGroups(db),true);
  assert.deepEqual(ids(db,'a'),['mine']);
  assert.deepEqual(ids(db,'b'),['from-B']);
  assert.deepEqual(ids(db,'d'),['from-C']);
  assert.deepEqual(ids(db,'c'),[]);
  assert.deepEqual(ids(db,'B'),['from-B','mine']);
  assert.deepEqual(ids(db,'C'),['from-C','mine']);
  assert.deepEqual(ids(db,'unrelated'),['private']);
  assert.equal(syncAllLedgerGroups(db),false,'migration is idempotent');
});

test('repairs historical graph-union contamination without losing canonical records', () => {
  const db=database(), records=[entry('mine','a','B'),entry('from-B','b','B'),entry('from-C','d','C')];
  for (const id of ['a','b','c','d','B','C']) db.ledgers[id].expenses=structuredClone(records);
  db.ledgers.C.expenses[1].updatedAt='2026-10-13T04:00:00.000Z';
  db.ledgers.C.expenses[1].amountMinor=850;
  syncAllLedgerGroups(db);
  assert.deepEqual(ids(db,'a'),['mine']);
  assert.deepEqual(ids(db,'B'),['from-B','mine']);
  assert.deepEqual(ids(db,'C'),['from-C','mine']);
  assert.equal(db.ledgers.B.expenses.find(e=>e.id==='from-B').amountMinor,850);
  assert.equal(new Set(Object.values(db.ledgers).flatMap(l=>l.expenses.map(e=>e.id))).size,3);
});

test('spender determines ownership for old records entered on behalf of a partner', () => {
  const db=database();
  db.ledgers.B.expenses=[entry('on-behalf','b','B',{createdBy:'a'})];
  syncAllLedgerGroups(db);
  assert.deepEqual(ids(db,'a'),[]);
  assert.deepEqual(ids(db,'b'),['on-behalf']);
  assert.deepEqual(ids(db,'C'),[]);
  assert.deepEqual(ids(db,'B'),['on-behalf']);
});

test('legacy plain account ids still project to the correct owner', () => {
  const db=database();
  // Early snapshots stored the underlying account id in consumer/member,
  // without the UI u_ prefix and sometimes without createdBy.
  db.ledgers.B.expenses=[{
    id:'legacy-plain-owner', ledgerId:'B', consumer:'b', member:{ id:'b' },
    amountMinor:100, createdAt:'2026-10-13T03:00:00.000Z',
  }];
  syncAllLedgerGroups(db);
  assert.deepEqual(ids(db,'b'),['legacy-plain-owner']);
  assert.deepEqual(ids(db,'B'),['legacy-plain-owner']);
  assert.deepEqual(ids(db,'a'),[]);
  assert.deepEqual(ids(db,'C'),[]);
  assert.equal(db.ledgerSyncArchive?.length || 0,0);
});

test('instant undo and split changes are authoritative even in the same millisecond', () => {
  const db=database(), timestamp='2026-10-13T03:00:00.000Z';
  const deleted=entry('instant-undo','a','B',{deletedAt:timestamp,splitParticipants:['u_a','u_b']});
  syncLedgerGroup(db,'B',deleted);
  const restored={...deleted,updatedAt:timestamp,splitParticipants:['u_a']};
  delete restored.deletedAt;
  syncLedgerGroup(db,'B',restored);
  for (const id of ['a','B','C']) {
    const actual=db.ledgers[id].expenses.find(e=>e.id===restored.id);
    assert.equal(actual.deletedAt,undefined);
    assert.deepEqual(actual.splitParticipants,['u_a']);
  }
  assert.deepEqual(ids(db,'b'),[]);
  syncAllLedgerGroups(db);
  assert.equal(db.ledgers.a.expenses[0].deletedAt,undefined);
});

test('unknown ownership stays in its original shared ledger, never guessed from mirrors', () => {
  const db=database(), unknown={id:'unknown',ledgerId:'B',amountMinor:250};
  for (const id of ['a','b','B','C']) db.ledgers[id].expenses=[structuredClone(unknown)];
  syncAllLedgerGroups(db);
  assert.deepEqual(ids(db,'a'),[]);
  assert.deepEqual(ids(db,'C'),[]);
  assert.deepEqual(ids(db,'B'),['unknown']);
});

test('departure removes imported records while original circle history stays intact', () => {
  const db=database();
  db.ledgers.B.expenses=[entry('original','b','B')];
  db.ledgers.b.expenses=[entry('personal','b','b')];
  syncAllLedgerGroups(db);
  db.circles.B.members=['a'];
  syncAllLedgerGroups(db);
  assert.deepEqual(ids(db,'B'),['original']);
  assert.deepEqual(ids(db,'b'),['original','personal']);
  assert.deepEqual(ids(db,'a'),[]);
});

test('unattributable contaminated rows are archived once instead of guessed into a personal ledger', () => {
  const db=database(), unknown={id:'unknown-no-source',amountMinor:250,note:'keep original'};
  for (const id of ['a','b','B','C']) db.ledgers[id].expenses=[structuredClone(unknown)];
  assert.equal(syncAllLedgerGroups(db),true);
  for (const id of ['a','b','B','C']) assert.deepEqual(ids(db,id),[]);
  assert.deepEqual(db.ledgerSyncArchive,[unknown]);
  assert.equal(syncAllLedgerGroups(db),false);
  assert.deepEqual(db.ledgerSyncArchive,[unknown]);
});

test('unrelated historical records reusing an ID keep their separate amounts and stable IDs', () => {
  const db=database(), mine=entry('old-reused-id','a','a'), theirs=entry('old-reused-id','unrelated','unrelated',{amountMinor:999});
  db.ledgers.a.expenses=[mine]; db.ledgers.unrelated.expenses=[theirs];
  db.ledgers.B.expenses=[structuredClone(mine)];
  db.telegram={expenseMessages:{'a:old-reused-id':[{chatId:'101',messageId:1}],'unrelated:old-reused-id':[{chatId:'202',messageId:2}]}};
  syncAllLedgerGroups(db);
  const own=db.ledgers.a.expenses[0], foreign=db.ledgers.unrelated.expenses[0];
  assert.equal(own.amountMinor,100);
  assert.equal(foreign.amountMinor,999);
  assert.notEqual(own.id,foreign.id,'conflicting historical IDs receive one stable safe identity');
  assert.equal(db.ledgers.B.expenses.length,1);
  assert.equal(db.ledgers.B.expenses[0].id,own.id);
  assert.equal(db.ledgers.C.expenses[0].id,own.id);
  assert.equal(db.telegram.expenseMessages[`a:${own.id}`][0].messageId,1);
  assert.equal(db.telegram.expenseMessages[`unrelated:${foreign.id}`][0].messageId,2,'existing Telegram cards remain editable after migration');
  const snapshot=structuredClone(db);
  assert.equal(syncAllLedgerGroups(db),false);
  assert.deepEqual(db,snapshot,'a restart must not repeatedly rewrite the migrated identity');
});

function domainDatabase() {
  const db=database();
  db.identities={ 'telegram:a':'a', 'google:source-account':'b' }; db.sessions={}; db.links={};
  for (const [id] of Object.entries(db.users)) db.users[id]={id,name:id,color:'blue',avatar:'cloud',settings:initialSettings('en'),activeCircleId:null};
  for (const ledger of Object.values(db.ledgers)) ledger.settings=initialSettings('en');
  for (const [id,circle] of Object.entries(db.circles)) Object.assign(circle,{id,name:id,admins:['a'],invite:null});
  return db;
}
const domainOptions={now:Date.parse('2026-10-13T05:00:00.000Z'),limit() {}};
const domain=(db,uid,route,method,body={})=>handleDomain(db,uid,route,method,body,domainOptions);
const input=(db,uid,id)=>({id,consumer:`u_${uid}`,type:'expense',amountMinor:100,currency:'JPY',categoryId:db.ledgers[uid].settings.categories[0].id,note:'',timezone:'Asia/Tokyo'});

test('another user cannot overwrite or receive an unrelated record by posting its ID', () => {
  const db=domainDatabase(), id='known-record-0001';
  const original=domain(db,'a','/expenses','POST',input(db,'a',id));
  assert.throws(()=>domain(db,'unrelated','/expenses','POST',{...input(db,'unrelated',id),amountMinor:999}),error=>error.status===409);
  assert.equal(db.ledgers.a.expenses[0].amountMinor,100);
  assert.deepEqual(ids(db,'unrelated'),[]);
  assert.deepEqual(domain(db,'a','/expenses','POST',input(db,'a',id)),original,'the owner can safely retry');
  db.users.b.activeCircleId='B';
  assert.throws(()=>domain(db,'b','/expenses','POST',{...input(db,'b',id),ledgerId:'B'}),error=>error.status===409,'a visible partner record is not an idempotent own POST');
});

test('account merge remaps legacy member-only ownership, archived snapshots, presence and bursts', () => {
  const db=domainDatabase();
  const legacy=entry('legacy-member-001','b','B',{consumer:'old-role',createdBy:undefined,member:{id:'u_b',name:'old-name'}});
  db.ledgers.B.expenses=[legacy];
  // An archive may contain a recoverable older snapshot restored from backup.
  db.ledgerSyncArchive=[entry('archived-link-001','b','b',{consumer:'old-role',createdBy:undefined,member:{id:'u_b',name:'old-name'}})];
  db.circles.B.locations={a:{location:{name:'older'},updatedAt:1},b:{location:{name:'newer'},updatedAt:2}};
  db.circles.B.reactions=[{id:'reaction-link-01',from:'b',to:'a'}];
  db.circles.B.reactionBursts=[{id:'burst-link-001',from:'b',to:'a',count:2}];
  db.telegram={preferences:{b:{chatId:'101',language:'uk',seenAt:domainOptions.now}},expenseMessages:{'B:legacy-member-001':[{uid:'b',chatId:'101',messageId:9}]}};
  db.cron={missingEntryReminders:{'b:2026-10-13':{uid:'b',localDate:'2026-10-13',status:'sent',messageId:4}}};
  const code=domain(db,'a','/auth/link-code','POST').code;
  domain(db,'b','/auth/link-verify','POST',{code,confirm:true});
  assert.equal(db.users.b,undefined);
  assert.deepEqual(ids(db,'a'),['archived-link-001','legacy-member-001']);
  for (const actual of db.ledgers.a.expenses) assert.equal(actual.member.id,'u_a');
  assert.deepEqual(ids(db,'B'),['archived-link-001','legacy-member-001']);
  assert.deepEqual(ids(db,'C'),['archived-link-001','legacy-member-001']);
  assert.equal(db.circles.B.locations.b,undefined);
  assert.equal(db.circles.B.locations.a.location.name,'newer');
  assert.equal(db.circles.B.reactions[0].from,'a');
  assert.equal(db.circles.B.reactionBursts[0].from,'a');
  assert.equal(db.circles.B.reactionBursts[0].to,'a');
  assert.equal(db.telegram.preferences.a.language,'uk');
  assert.equal(db.telegram.preferences.b,undefined);
  assert.equal(db.telegram.expenseMessages['B:legacy-member-001'][0].uid,'a');
  assert.equal(db.cron.missingEntryReminders['a:2026-10-13'].status,'sent');
  assert.equal(db.cron.missingEntryReminders['b:2026-10-13'],undefined);
});

test('leaving a circle clears shared presence immediately and retains only its original history', () => {
  const db=domainDatabase();
  db.users.b.activeCircleId='B';
  db.circles.B.locations={b:{location:{name:'a shop'},updatedAt:domainOptions.now}};
  db.ledgers.B.expenses=[entry('original-shared','b','B')];
  db.ledgers.b.expenses=[entry('personal-import','b','b')];
  syncAllLedgerGroups(db);
  const result=domain(db,'b','/circles/leave','POST',{circleId:'B',confirm:true});
  assert.equal(db.circles.B.locations.b,undefined);
  assert.equal(result.ledgerId,'b');
  assert.deepEqual(ids(db,'B'),['original-shared']);
  assert.deepEqual(ids(db,'b'),['original-shared','personal-import']);
  assert.deepEqual(ids(db,'a'),[]);
  assert.throws(()=>domain(db,'b','/circles/switch','POST',{circleId:'B'}),error=>error.status===403);
});
