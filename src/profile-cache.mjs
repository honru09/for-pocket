// Last confirmed server profile, cached so the app can open instantly.
// The cache is a render shortcut only: it is written from confirmed server
// snapshots (never from optimistic or unconfirmed entries), it never stores
// a session token, and every boot still refreshes from the network in the
// background and reconciles against this snapshot.
//
// The cache is tagged with the Telegram user id that owned the snapshot
// (when known). A boot that arrives under a different Telegram account must
// not render — and must never write against — the previous account's
// ledger, so a mismatched tag makes the cache invisible.
// Oversized snapshots are trimmed (oldest entries dropped from the cached
// copy only) instead of being dropped entirely: the background refresh
// restores the full ledger within moments, and a partial instant render is
// strictly better than a blocking spinner for heavy accounts.
export const PROFILE_CACHE_KEY = 'for-pocket.profile-cache.v1';
const MAX_CACHE_CHARS = 4_500_000;
const TRIM_STEPS = [400, 200, 80];

const storageFor = storage => {
  try { return storage ?? globalThis.localStorage; } catch { return null; }
};

function cacheable(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const userId = profile.user?.id, ledgerId = profile.ledgerId;
  if (typeof userId !== 'string' || !userId || userId === 'u_local') return null;
  if (typeof ledgerId !== 'string' || !ledgerId || ledgerId === 'local') return null;
  if (!profile.settings || typeof profile.settings !== 'object') return null;
  if (!Array.isArray(profile.expenses)) return null;
  // A session token must never be persisted in a render cache.
  const { sessionToken, ...rest } = profile;
  return rest;
}

const entryTime = entry => entry?.occurredAt || entry?.createdAt || '';

function trimmed(profile, keep) {
  const expenses = [...profile.expenses].sort((a, b) => entryTime(b).localeCompare(entryTime(a))).slice(0, keep);
  return { ...profile, expenses };
}

export function writeProfileCache(profile, storage, { telegramId = null } = {}) {
  const value = cacheable(profile);
  if (!value) return false;
  const store = storageFor(storage);
  if (!store) return false;
  const tag = Number.isSafeInteger(telegramId) && telegramId > 0 ? telegramId : null;
  const attempts = [value, ...TRIM_STEPS.map(keep => (value.expenses.length > keep ? trimmed(value, keep) : null)).filter(Boolean)];
  for (const candidate of attempts) {
    try {
      const raw = JSON.stringify({ version: 1, savedAt: Date.now(), telegramId: tag, trimmed: candidate !== value, profile: candidate });
      if (raw.length > MAX_CACHE_CHARS && candidate !== attempts.at(-1)) continue;
      if (raw.length > MAX_CACHE_CHARS) return false;
      store.setItem(PROFILE_CACHE_KEY, raw);
      return true;
    } catch { /* quota or privacy mode: try the next smaller candidate */ }
  }
  return false;
}

export function readProfileCacheEntry(storage, { telegramId = null } = {}) {
  try {
    const raw = storageFor(storage)?.getItem(PROFILE_CACHE_KEY);
    if (!raw || raw.length > MAX_CACHE_CHARS + 100_000) return null;
    const stored = JSON.parse(raw);
    if (stored?.version !== 1 || !Number.isFinite(stored.savedAt)) return null;
    const profile = cacheable(stored.profile);
    if (!profile) return null;
    // A tagged cache belongs to one Telegram account. When the current
    // launch identifies a different account, the cache must not be used.
    if (stored.telegramId && telegramId && stored.telegramId !== telegramId) return null;
    return { profile, telegramId: stored.telegramId || null, savedAt: stored.savedAt, trimmed: stored.trimmed === true };
  } catch { return null; }
}

export function readProfileCache(storage, options) {
  return readProfileCacheEntry(storage, options)?.profile || null;
}

export function clearProfileCache(storage) {
  try { storageFor(storage)?.removeItem(PROFILE_CACHE_KEY); } catch {}
}
