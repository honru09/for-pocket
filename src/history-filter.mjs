/*
 * The active circle ledger is shared storage, but the first view should still
 * feel personal: show the signed-in member's records and let the UI opt into
 * additional members.  Keep this logic independent of React so legacy
 * snapshots (which sometimes omit `consumer`) can be handled consistently.
 */

function asMemberId(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const id = value.trim();
  // Member ids exposed to the UI are prefixed with `u_`. Older local/imported
  // records sometimes stored the underlying user id, so normalize both forms
  // before comparing filters.
  return id.startsWith('u_') ? id : `u_${id}`;
}

function circleMemberIds(circle) {
  return new Set((circle?.members || [])
    .map(member => typeof member === 'string' ? member : member?.id)
    .map(asMemberId)
    .filter(Boolean));
}

/** Return the member id that owns an expense snapshot. */
export function expenseMemberId(entry) {
  const consumer = asMemberId(entry?.consumer);
  if (consumer) return consumer;
  const member = asMemberId(entry?.member?.id);
  if (member) return member;
  // A few early remote records did not carry `consumer`; createdBy is the
  // original database uid, whereas member ids exposed to the client use the
  // `u_` prefix.
  const creator = asMemberId(entry?.createdBy);
  if (creator) return creator.startsWith('u_') ? creator : `u_${creator}`;
  const ledger = asMemberId(entry?.ledgerId);
  if (ledger) return ledger.startsWith('u_') ? ledger : `u_${ledger}`;
  return null;
}

/**
 * Current member is always selected.  Other selections are constrained to
 * members in the active circle, preventing stale ids from leaking records
 * after somebody leaves or a profile refresh races a tap.
 */
export function selectedLedgerMembers({ circle = null, userId, selected = [] } = {}) {
  const owner = asMemberId(userId);
  if (!owner) return new Set();
  if (!circle) return new Set([owner]);
  const members = circleMemberIds(circle);
  members.add(owner);
  const picked = selected instanceof Set ? selected : new Set(selected || []);
  return new Set([owner, ...[...picked].map(asMemberId).filter(id => id && members.has(id))]);
}

export function filterLedgerEntries(entries, options = {}) {
  const members = selectedLedgerMembers(options);
  return (Array.isArray(entries) ? entries : []).filter(entry => members.has(expenseMemberId(entry)));
}
