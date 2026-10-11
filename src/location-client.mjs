import { normalizeLocation } from '../public/location.mjs';

// Every request is a single acquisition. No watches, timers that poll, or stored trails.
export function createLocationClient({ telegram, navigator: nav = globalThis.navigator, now = Date.now, timeout = 5000, maxAge = 60000 } = {}) {
  let cached, pending, generation = 0;
  const bounded = operation => new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish(null), timeout);
    try { operation(finish); } catch { finish(null); }
  });
  const coordinates = value => {
    const result = normalizeLocation({ lat: value?.latitude, lng: value?.longitude });
    return result?.lat !== undefined ? { ...result, ...(Number.isFinite(value?.accuracy ?? value?.horizontal_accuracy) ? { accuracy: value.accuracy ?? value.horizontal_accuracy } : {}) } : null;
  };
  async function acquire(allowPrompt, round, refresh) {
    const manager = telegram?.LocationManager;
    if (manager?.init && manager?.getLocation && (!telegram?.isVersionAtLeast || telegram.isVersionAtLeast('8.0'))) {
      if (!manager.isInited) await bounded(done => manager.init(() => done(true)));
      if (round !== generation) return null;
      if (manager.isInited && manager.isLocationAvailable) {
        if (!manager.isAccessGranted && (!allowPrompt || manager.isAccessRequested)) return null;
        return coordinates(await bounded(done => manager.getLocation(done)));
      }
    }
    if (!nav?.geolocation?.getCurrentPosition) return null;
    let permission;
    try { permission = await bounded(done => Promise.resolve(nav.permissions?.query({ name: 'geolocation' })).then(done, () => done(null))); } catch {}
    if (round !== generation) return null;
    if (permission?.state === 'denied' || (!allowPrompt && permission?.state !== 'granted')) return null;
    return coordinates(await bounded(done => nav.geolocation.getCurrentPosition(
      position => done(position.coords), () => done(null),
      { enableHighAccuracy: false, maximumAge: refresh ? 0 : maxAge, timeout },
    )));
  }
  return {
    async capture({ allowPrompt = false, refresh = false } = {}) {
      if (!refresh && cached && now() - cached.at < maxAge) return cached.value;
      if (pending) return pending;
      const round = generation;
      const job = acquire(allowPrompt, round, refresh).catch(() => null).then(value => {
        if (round !== generation) return null;
        if (value) cached = { value, at: now() };
        return value;
      }).finally(() => { if (pending === job) pending = null; });
      pending = job;
      return pending;
    },
    clear() { generation++; cached = null; pending = null; },
  };
}

export function locationPreference(scope, enabled) {
  const key = `for-pocket.location.${scope}`;
  try {
    if (enabled !== undefined) enabled ? localStorage.setItem(key, 'on') : localStorage.removeItem(key);
    return localStorage.getItem(key) === 'on';
  } catch { return false; }
}
