import test from 'node:test';
import assert from 'node:assert/strict';
import { createReception,receiveReactions,advanceReception,resumeReception,
  RECEPTION_HISTORY_LIMIT,RECEPTION_FLOOD_MS,RECEPTION_QUIET_MS,RECEPTION_EXIT_MS } from '../src/reaction-reception.mjs';

const receipt = (index,count=index,burst='a') => ({id:`${burst}-${index}`,burstId:burst,burstIndex:index,burstCount:count,emoji:'❤️'});

test('one hundred unread taps are a single flood; paginated counts never add or replay', () => {
  let state = receiveReactions(createReception(),Array.from({length:40},(_,i)=>receipt(i+1,100)),0);
  assert.equal(state.view.phase,'flood');
  assert.equal(state.view.groups[0].count,100);
  assert.equal(state.view.receiptIds.length,40);
  const celebration = state.celebration;
  for (const [offset,size] of [[40,40],[80,20]]) {
    state = receiveReactions(state,Array.from({length:size},(_,i)=>receipt(offset+i+1,100)),offset*20);
    assert.equal(state.view.groups[0].count,100);
    assert.equal(state.celebration,celebration);
    assert.equal(state.view.receiptIds.length,size);
    assert.equal(state.view.phaseUntil,RECEPTION_FLOOD_MS);
  }
  state = advanceReception(state,RECEPTION_FLOOD_MS);
  assert.equal(state.view.phase,'exit');
  state = advanceReception(state,RECEPTION_FLOOD_MS+RECEPTION_EXIT_MS);
  assert.equal(state.view,null);
  state = receiveReactions(state,[receipt(101)],5000);
  assert.equal(state.view.phase,'dock','later taps from the same burst do not replay the flood');
  assert.equal(state.view.groups[0].count,101);
  assert.equal(state.celebration,celebration);
});

test('tap six escalates once and an endless run docks after a bounded full-screen effect', () => {
  let state = createReception();
  for (let i=1;i<=5;i++) state = receiveReactions(state,[receipt(i)],i*100);
  assert.equal(state.view.phase,'pop');
  state = receiveReactions(state,[receipt(6)],600);
  assert.equal(state.view.phase,'flood');
  const until = state.view.phaseUntil;
  for (let i=7;i<=40;i++) state = receiveReactions(state,[receipt(i)],i*100);
  state = advanceReception(state,4000);
  assert.equal(until,600+RECEPTION_FLOOD_MS);
  assert.equal(state.view.phase,'dock');
  assert.equal(state.celebration,1);
  assert.equal(state.view.groups[0].count,40);
});

test('an incoming update interrupts exit without an old deadline clearing the new display', () => {
  let state = receiveReactions(createReception(),[receipt(1)],0);
  state = advanceReception(state,RECEPTION_QUIET_MS);
  assert.equal(state.view.phase,'exit');
  state = receiveReactions(state,[receipt(2)],RECEPTION_QUIET_MS+100);
  assert.equal(state.view.phase,'dock');
  state = advanceReception(state,RECEPTION_QUIET_MS+RECEPTION_EXIT_MS);
  assert.equal(state.view.phase,'dock');
  assert.equal(state.view.groups[0].count,2);
});

test('repeated server data acknowledges only fetched ids and never decreases a badge', () => {
  let state = receiveReactions(createReception(),[receipt(1,100)],0);
  state = receiveReactions(state,[receipt(2,8),receipt(3,100)],200);
  assert.equal(state.view.groups[0].count,100);
  assert.deepEqual(state.view.receiptIds,['a-2','a-3']);
  assert.equal(state.view.lastReceivedAt,0);
});

test('many independent bursts share one bounded scene, not an unbounded animation queue', () => {
  const state = receiveReactions(createReception(),Array.from({length:100},(_,i)=>receipt(1,1,`group-${i}`)),0);
  assert.equal(state.view.phase,'flood');
  assert.equal(state.view.groups.length,3);
  assert.equal(state.history.length,RECEPTION_HISTORY_LIMIT);
  assert.equal(state.view.receiptIds.length,100);
  assert.equal(state.celebration,1);
});

test('background time is excluded from the visual lifetime', () => {
  let state = receiveReactions(createReception(),[receipt(1,20)],1000);
  const deadline = state.view.phaseUntil;
  state = resumeReception(state,10000);
  assert.equal(state.view.phaseUntil,deadline+10000);
  assert.equal(state.view.lastReceivedAt,11000);
  assert.equal(advanceReception(state,12000).view.phase,'flood');
});

test('four different unread emoji are all represented by a mixed wave before acknowledgement', () => {
  const emojis = ['❤️','😂','🌷','🧀'];
  const state = receiveReactions(createReception(),emojis.map((emoji,i)=>({...receipt(1,1,`mixed-${i}`),emoji})),0);
  assert.equal(state.view.phase,'flood');
  assert.deepEqual(new Set(state.view.palette),new Set(emojis));
  assert.deepEqual(state.view.groups.map(group => group.emoji),emojis.slice().reverse(),
    'a small mixed poll keeps every burst in the dock while it is acknowledged');
  assert.equal(state.view.receiptIds.length,4);
});
