const PREFIX = 'for-pocket.import-draft.v1:';
const listeners = new Map();
const bounded = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const strings = (values, count, max) => Array.isArray(values) ? values.slice(0, count).map(value => bounded(value, max)).filter(Boolean) : [];
const storageFor = storage => {
  try { return storage ?? globalThis.sessionStorage; } catch { return null; }
};

export function importDraftScope(profile) {
  const user = profile?.user?.id, ledger = profile?.ledgerId;
  return typeof user === 'string' && user && typeof ledger === 'string' && ledger ? JSON.stringify([user, ledger]) : null;
}

function normalize(draft) {
  const items = Array.isArray(draft?.items) ? draft.items.slice(0, 50).filter(item => item && typeof item.id === 'string' && item.id).map(item => {
    const next = {};
    for (const [key, max] of Object.entries({ id: 96, amount: 40, currency: 8, type: 16, occurredAt: 40, timezone: 80,
      categoryId: 96, consumer: 96, merchant: 160, note: 160, splitMode: 16, recordKind: 24, reviewReason: 400,
      rawText: 1000, sourceName: 160, categorySuggestion: 80 })) {
      if (key !== 'categorySuggestion' || typeof item[key] === 'string') next[key] = bounded(item[key], max);
    }
    next.splitParticipants = strings(item.splitParticipants, 32, 96);
    next.needsReview = item.needsReview === true;
    next.confidence = Number.isFinite(item.confidence) ? Math.max(0, Math.min(1, item.confidence)) : null;
    return next;
  }) : [];
  const warnings = Array.isArray(draft?.warnings) ? draft.warnings.slice(0, 16).map(warning => typeof warning === 'string' ? bounded(warning, 160)
    : warning && typeof warning.code === 'string' ? { name: bounded(warning.name, 160), code: bounded(warning.code, 80) } : '').filter(Boolean) : [];
  return { text: bounded(draft?.text, 12000), items, warnings, fileNames: strings(draft?.fileNames, 8, 160) };
}

function remove(scope, storage) {
  if (!scope) return;
  try { storageFor(storage)?.removeItem(PREFIX + scope); } catch {}
}

export function writeImportDraft(scope, draft, storage) {
  if (!scope) return;
  const value = normalize(draft);
  if (!value.text.trim() && !value.items.length && !value.fileNames.length) return remove(scope, storage);
  try { storageFor(storage)?.setItem(PREFIX + scope, JSON.stringify({ version: 1, scope, updatedAt: Date.now(), ...value })); } catch {}
}

export function readImportDraft(scope, savedEntries = [], storage) {
  if (!scope) return null;
  try {
    const raw = storageFor(storage)?.getItem(PREFIX + scope);
    if (!raw) return null;
    if (raw.length > 250000) { remove(scope, storage); return null; }
    const stored = JSON.parse(raw);
    if (stored?.version !== 1 || stored.scope !== scope || !Number.isFinite(stored.updatedAt)) { remove(scope, storage); return null; }
    const draft = normalize(stored);
    const saved = new Set((savedEntries || []).map(entry => entry?.id).filter(Boolean));
    const remaining = draft.items.filter(item => !saved.has(item.id));
    if (remaining.length !== draft.items.length) {
      // A lost response can leave a draft after the server already committed it.
      if (!remaining.length) { remove(scope, storage); return null; }
      draft.items = remaining;
      writeImportDraft(scope, draft, storage);
    }
    return draft;
  } catch { remove(scope, storage); return null; }
}

function notify(scope) {
  for (const listener of listeners.get(scope) || []) { try { listener(); } catch {} }
}

export function subscribeImportDraft(scope, listener) {
  if (!scope) return () => {};
  const set = listeners.get(scope) || new Set();
  set.add(listener); listeners.set(scope, set);
  return () => { set.delete(listener); if (!set.size) listeners.delete(scope); };
}

export function clearImportDraft(scope, storage) {
  remove(scope, storage);
  notify(scope);
}

export function settleImportDraft(scope, submitted, savedIds, storage) {
  const current = readImportDraft(scope, [], storage), ids = new Set(savedIds || []);
  if (!current || !ids.size) return;
  const remaining = current.items.filter(item => !ids.has(item.id));
  if (remaining.length === current.items.length) return;
  const sameSource = current.text === submitted.text && JSON.stringify(current.fileNames) === JSON.stringify(submitted.fileNames || []);
  if (!remaining.length && sameSource) remove(scope, storage);
  else writeImportDraft(scope, { ...current, items: remaining }, storage);
  // The original component may have unmounted while its request was pending.
  // A newly opened form must drop those acknowledged IDs immediately too.
  notify(scope);
}
