import { createHash } from 'node:crypto';

/* A record belongs to its spender. Project it into that person's personal
 * ledger and their circles, never through another member's circle graph.
 * Original shared-ledger history remains there when a member leaves. */
export function expenseOwnerId(db, entry) {
  for (const member of [entry?.consumer, entry?.member?.id]) {
    if (typeof member === 'string' && member.startsWith('u_') && db.users?.[member.slice(2)]) return member.slice(2);
  }
  if (db.users?.[entry?.createdBy]) return entry.createdBy;
  return db.users?.[entry?.ledgerId] ? entry.ledgerId : null;
}

function recordStamp(entry) {
  // Deletion is a real state and must win over an older live copy.  Legacy
  // entries may not have updatedAt, so createdAt remains a stable fallback.
  return [entry?.updatedAt, entry?.deletedAt].filter(Boolean).sort().at(-1) || entry?.createdAt || entry?.occurredAt || '';
}

function newest(a, b) {
  const left = recordStamp(a), right = recordStamp(b);
  const winner = right > left ? b : left > right ? a : (Boolean(b?.deletedAt) && !a?.deletedAt ? b : a);
  // Only merge participants for tied snapshots (account linking). A newer
  // edit is authoritative, including deliberate removal of a participant.
  if (left !== right) return winner;
  const participants = [...new Set([
    ...(Array.isArray(a?.splitParticipants) ? a.splitParticipants : []),
    ...(Array.isArray(b?.splitParticipants) ? b.splitParticipants : []),
  ])];
  return participants.length ? { ...winner, splitParticipants: participants } : winner;
}

// Older clients could reuse an ID in unrelated ledgers. They are separate
// records when their original sources differ; never let the newest amount
// overwrite the other person's history while cleaning up old mirrors.
function normalizeRecordCollisions(db) {
  const byId = new Map();
  for (const entries of [...Object.values(db.ledgers || {}).map(ledger => ledger.expenses || []), db.ledgerSyncArchive || []]) {
    for (const entry of entries) if (entry?.id) {
      if (!byId.has(entry.id)) byId.set(entry.id, []);
      byId.get(entry.id).push(entry);
    }
  }
  const usedIds = new Set(byId.keys());
  let changed = false;
  for (const [id, snapshots] of byId) {
    const sourced = snapshots.filter(entry => entry.ledgerId);
    const groups = new Map();
    for (const entry of snapshots) {
      const owner = expenseOwnerId(db, entry);
      let source = entry.ledgerId;
      if (!source) {
        const matching = [...new Set(sourced.filter(candidate => !owner || expenseOwnerId(db, candidate) === owner).map(candidate => candidate.ledgerId))];
        if (matching.length === 1) source = matching[0];
      }
      const key = source ? `source:${source}` : owner ? `owner:${owner}` : 'unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    if (groups.size < 2) continue;
    // Keep one original ID, consistently regardless of object/ledger order.
    const ordered = [...groups].sort(([a], [b]) => a.localeCompare(b));
    for (const [key, entries] of ordered.slice(1)) {
      let nextId, attempt = 0;
      do { nextId = `sync_${createHash('sha256').update(JSON.stringify([id, key, attempt++])).digest('hex').slice(0, 40)}`; } while (usedIds.has(nextId));
      usedIds.add(nextId);
      for (const source of new Set(entries.map(entry => entry.ledgerId).filter(Boolean))) {
        const oldKey = `${source}:${id}`, nextKey = `${source}:${nextId}`;
        if (db.telegram?.expenseMessages?.[oldKey]) {
          db.telegram.expenseMessages[nextKey] = db.telegram.expenseMessages[oldKey];
          delete db.telegram.expenseMessages[oldKey];
        }
      }
      for (const entry of entries) { entry.syncOriginalId ||= id; entry.id = nextId; }
      changed = true;
    }
  }
  return changed;
}

function projectLedgers(db, updatedEntry, seedLedgerId) {
  let changed = normalizeRecordCollisions(db);
  const records = new Map(), copies = new Map();
  const collect = (entry, ledgerId) => {
    if (!entry?.id) return;
    const previous = records.get(entry.id);
    records.set(entry.id, previous ? newest(previous, entry) : entry);
    if (ledgerId) {
      if (!copies.has(entry.id)) copies.set(entry.id, new Set());
      copies.get(entry.id).add(ledgerId);
    }
  };
  for (const [id, ledger] of Object.entries(db.ledgers || {})) for (const entry of ledger.expenses || []) collect(entry, id);
  // Unattributable legacy records are retained privately for recovery. Never
  // infer their owner from a polluted mirror, and never silently delete them.
  for (const entry of db.ledgerSyncArchive || []) collect(entry);
  if (updatedEntry?.id) records.set(updatedEntry.id, { ...updatedEntry, ledgerId:updatedEntry.ledgerId || seedLedgerId });
  const projected = new Map(Object.keys(db.ledgers || {}).map(id => [id, []])), archive = [];
  const ownerCircles = new Map();
  for (const circle of Object.values(db.circles || {})) for (const uid of circle.members || []) {
    if (!ownerCircles.has(uid)) ownerCircles.set(uid, []);
    ownerCircles.get(uid).push(circle.ledgerId);
  }
  for (let entry of records.values()) {
    // A lone v1 source is unambiguous. Once provenance is assigned it stays
    // stable, so subsequent projections cannot change its owner.
    if (!entry.ledgerId && copies.get(entry.id)?.size === 1) entry = { ...entry, ledgerId:[...copies.get(entry.id)][0] };
    const owner = expenseOwnerId(db, entry), destinations = new Set();
    if (owner) {
      destinations.add(owner);
      for (const id of ownerCircles.get(owner) || []) destinations.add(id);
    }
    if (entry.ledgerId && !db.users?.[entry.ledgerId]) destinations.add(entry.ledgerId);
    let retained = false;
    for (const id of destinations) if (projected.has(id)) {
      projected.get(id).push(entry); retained = true;
    }
    if (!retained) archive.push(entry);
  }
  for (const [id, entries] of projected) if (JSON.stringify(db.ledgers[id].expenses || []) !== JSON.stringify(entries)) {
    db.ledgers[id].expenses = structuredClone(entries); changed = true;
  }
  if (JSON.stringify(db.ledgerSyncArchive || []) !== JSON.stringify(archive)) {
    db.ledgerSyncArchive = structuredClone(archive); changed = true;
  }
  return changed;
}

// Keep the mutation API stable; rebuilding the projections also removes
// obsolete mirrors left by the former transitive graph implementation.
export function syncLedgerGroup(db, seedLedgerId, updatedEntry) { return projectLedgers(db, updatedEntry, seedLedgerId); }
export function syncAllLedgerGroups(db) { return projectLedgers(db); }
