// Last confirmed server profile, cached so the app can open instantly.
// The cache is a render shortcut only: it is written from confirmed server
// snapshots (never from optimistic or unconfirmed entries), it never stores
// a session token, and every boot still refreshes from the network in the
// background and reconciles against this snapshot.
export const PROFILE_CACHE_KEY = 'for-pocket.profile-cache.v1';

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

export function writeProfileCache(profile, storage) {
  const value = cacheable(profile);
  if (!value) return false;
  try {
    storageFor(storage)?.setItem(PROFILE_CACHE_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), profile: value }));
    return true;
  } catch { return false; }
}

export function readProfileCache(storage) {
  try {
    const raw = storageFor(storage)?.getItem(PROFILE_CACHE_KEY);
    if (!raw || raw.length > 2_000_000) return null;
    const stored = JSON.parse(raw);
    if (stored?.version !== 1 || !Number.isFinite(stored.savedAt)) return null;
    return cacheable(stored.profile);
  } catch { return null; }
}

export function clearProfileCache(storage) {
  try { storageFor(storage)?.removeItem(PROFILE_CACHE_KEY); } catch {}
}
