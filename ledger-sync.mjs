/*
 * A ledger is a view over one account's connected circle graph.  Personal
 * ledgers and circle ledgers used to be isolated files, which meant that a
 * record disappeared as soon as the user changed the selected circle.  Keep
 * the files for compatibility, but mirror the records inside the connected
 * graph so every ledger the same account can access has the same history.
 *
 * A user's personal ledger connects all circles they belong to.  A circle
 * connects the personal ledgers of its members.  Unrelated users therefore
 * remain private and are never included in the sync set.
 */

function ledgerGraph(db) {
  const graph = new Map();
  const ensure = id => {
    if (!id) return null;
    if (!graph.has(id)) graph.set(id, new Set());
    return id;
  };
  const link = (a, b) => {
    a = ensure(a); b = ensure(b);
    if (!a || !b) return;
    graph.get(a).add(b); graph.get(b).add(a);
  };

  for (const [uid, user] of Object.entries(db.users || {})) {
    ensure(uid);
    if (db.ledgers?.[uid]) ensure(uid);
    // A user participating in any circle is connected to that circle ledger.
    for (const circle of Object.values(db.circles || {})) {
      if (circle.members?.includes(uid) && db.ledgers?.[circle.ledgerId]) link(uid, circle.ledgerId);
    }
  }
  for (const circle of Object.values(db.circles || {})) {
    if (!db.ledgers?.[circle.ledgerId]) continue;
    ensure(circle.ledgerId);
    for (const uid of circle.members || []) if (db.ledgers?.[uid]) link(circle.ledgerId, uid);
  }
  // Preserve standalone historical ledgers created by the v1 migration.
  for (const id of Object.keys(db.ledgers || {})) ensure(id);
  return graph;
}

export function connectedLedgerIds(db, seedLedgerId) {
  const graph = ledgerGraph(db);
  if (!graph.has(seedLedgerId)) return seedLedgerId && db.ledgers?.[seedLedgerId] ? [seedLedgerId] : [];
  const seen = new Set([seedLedgerId]), queue = [seedLedgerId];
  while (queue.length) {
    const current = queue.shift();
    for (const next of graph.get(current) || []) if (!seen.has(next)) {
      seen.add(next); queue.push(next);
    }
  }
  return [...seen].filter(id => db.ledgers?.[id]);
}

function recordStamp(entry) {
  // Deletion is a real state and must win over an older live copy.  Legacy
  // entries may not have updatedAt, so createdAt remains a stable fallback.
  return [entry?.updatedAt, entry?.deletedAt].filter(Boolean).sort().at(-1) || entry?.createdAt || entry?.occurredAt || '';
}

function newest(a, b) {
  const left = recordStamp(a), right = recordStamp(b);
  const winner = right > left ? b : left > right ? a : (Boolean(b?.deletedAt) && !a?.deletedAt ? b : a);
  // Account linking can touch the same expense from two ledgers in one
  // transaction.  Preserve all explicitly selected split members while the
  // timestamp winner supplies the rest of the fields.
  const participants = [...new Set([
    ...(Array.isArray(a?.splitParticipants) ? a.splitParticipants : []),
    ...(Array.isArray(b?.splitParticipants) ? b.splitParticipants : []),
  ])];
  return participants.length ? { ...winner, splitParticipants: participants } : winner;
}

/**
 * Mirror the union of records across one connected account graph.
 * Returns true when the in-memory database changed.
 */
export function syncLedgerGroup(db, seedLedgerId, updatedEntry) {
  const ids = connectedLedgerIds(db, seedLedgerId);
  if (ids.length < 2) return false;
  const union = new Map();
  for (const id of ids) for (const entry of db.ledgers[id]?.expenses || []) {
    const previous = union.get(entry.id);
    union.set(entry.id, previous ? newest(previous, entry) : entry);
  }
  // A mutation is authoritative within this store transaction. Timestamp
  // ties must not resurrect an old deletion or add removed split members.
  if (updatedEntry?.id) union.set(updatedEntry.id, updatedEntry);
  const canonical = [...union.values()];
  let changed = false;
  for (const id of ids) {
    const ledger = db.ledgers[id];
    const before = ledger.expenses || [];
    if (JSON.stringify(before) !== JSON.stringify(canonical)) {
      ledger.expenses = structuredClone(canonical);
      changed = true;
    }
  }
  return changed;
}

/** Synchronize every existing graph once after loading old data. */
export function syncAllLedgerGroups(db) {
  const visited = new Set();
  let changed = false;
  for (const id of Object.keys(db.ledgers || {})) {
    if (visited.has(id)) continue;
    const ids = connectedLedgerIds(db, id);
    ids.forEach(value => visited.add(value));
    changed = syncLedgerGroup(db, id) || changed;
  }
  return changed;
}
