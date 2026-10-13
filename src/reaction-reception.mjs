import { normalizeReactionCount } from '../public/reactions.mjs';

// A receipt is presented in one scene, never one animation per network item.
// Keep only small burst summaries after acknowledging the actual received IDs.
export const RECEPTION_HISTORY_LIMIT = 32;
export const RECEPTION_PARTICLE_COUNT = 32;
export const RECEPTION_POP_MS = 1450;
export const RECEPTION_FLOOD_MS = 2600;
export const RECEPTION_QUIET_MS = 2400;
export const RECEPTION_EXIT_MS = 240;

export function createReception() {
  return { history:[], view:null, sequence:0, celebration:0 };
}

export function receiveReactions(state, events, now) {
  if (!events.length) return state;
  const history = new Map(state.history.map(item => [item.id,{ ...item }]));
  const changed = [], receivedIds = [];
  for (const event of events) {
    if (!event?.id || !event.emoji) continue;
    receivedIds.push(event.id);
    const id = event.burstId || event.id;
    const count = Math.max(1, normalizeReactionCount(event.burstCount), normalizeReactionCount(event.burstIndex));
    const old = history.get(id);
    if (!old || count > old.count) {
      const summary = { ...old,id,emoji:event.emoji,count:Math.max(old?.count || 0,count),order:state.sequence+1 };
      history.delete(id); history.set(id,summary);
      if (!changed.includes(id)) changed.push(id);
    }
  }
  // Paginated receipts can all carry the final burstCount. Consume those actual
  // IDs without replaying, or extending, an already presented celebration.
  if (!changed.length) return {
    ...state, sequence:state.sequence+1,
    view:state.view ? { ...state.view,receiptIds:receivedIds,receiptSequence:state.sequence+1 } : null,
    consumedIds:state.view ? [] : receivedIds,
  };
  const previous = state.view;
  const groups = [...changed].reverse().map(id => history.get(id));
  for (const group of previous?.groups || []) {
    if (!groups.some(item => item.id === group.id)) groups.push(history.get(group.id) || group);
  }
  const wantsFlood = changed.some(id => history.get(id).count > 5 && !history.get(id).floodPlayed)
    || (changed.length > 3 && changed.some(id => !history.get(id).floodPlayed));
  let phase, phaseUntil, celebration = state.celebration;
  if (previous?.phase === 'flood') {
    phase = 'flood'; phaseUntil = previous.phaseUntil;
  } else if (wantsFlood) {
    phase = 'flood'; phaseUntil = now+RECEPTION_FLOOD_MS; celebration++;
  } else if (previous?.phase === 'pop') {
    phase = 'pop'; phaseUntil = previous.phaseUntil;
  } else if (changed.some(id => !history.get(id).popPlayed)) {
    phase = 'pop'; phaseUntil = now+RECEPTION_POP_MS;
  } else {
    phase = 'dock'; phaseUntil = null;
  }
  for (const id of changed) {
    const item = history.get(id);
    item.popPlayed = true;
    if (phase === 'flood') item.floodPlayed = true;
  }
  const retained = [...history.values()].slice(-RECEPTION_HISTORY_LIMIT);
  // Keep the dock compact for a flood of independent bursts, but preserve a
  // small mixed batch in full. A single poll can legitimately contain four
  // different emoji; dropping the oldest one while acknowledging all four
  // makes that receipt feel lost. Four 42px chips still fit comfortably in
  // the safe-area dock on phone screens, while larger batches remain bounded.
  const visibleGroups = groups.length <= 4 ? groups : groups.slice(0,3);
  return {
    history:retained, sequence:state.sequence+1, celebration, consumedIds:[],
    view:{
      groups:visibleGroups, // one stage and a bounded set of readable counters
      // Different emoji received together become a single, mixed confetti wave.
      palette:[...new Set(groups.map(group => group.emoji))].slice(0,64),
      phase,phaseUntil,celebration,lastReceivedAt:now,
      receiptIds:receivedIds,receiptSequence:state.sequence+1,
    },
  };
}

export function advanceReception(state, now) {
  const view = state.view;
  if (!view) return state;
  if (view.phase === 'exit') return now >= view.phaseUntil ? { ...state,view:null } : state;
  if ((view.phase === 'pop' || view.phase === 'flood') && now < view.phaseUntil) return state;
  if (now >= view.lastReceivedAt+RECEPTION_QUIET_MS) {
    return { ...state,view:{ ...view,phase:'exit',phaseUntil:now+RECEPTION_EXIT_MS } };
  }
  return view.phase === 'dock' ? state : { ...state,view:{ ...view,phase:'dock',phaseUntil:null } };
}

export function receptionDeadline(state) {
  const view = state.view;
  if (!view) return null;
  return view.phase === 'dock' ? view.lastReceivedAt+RECEPTION_QUIET_MS : view.phaseUntil;
}

export function resumeReception(state, elapsed) {
  if (!state.view || elapsed <= 0) return state;
  return { ...state,view:{ ...state.view,lastReceivedAt:state.view.lastReceivedAt+elapsed,
    phaseUntil:state.view.phaseUntil == null ? null : state.view.phaseUntil+elapsed } };
}
