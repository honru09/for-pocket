import { normalizeLocation } from './public/location.mjs';

const DEFAULT_PHOTON_URL = 'https://photon.komoot.io/reverse';
const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const DEFAULT_USER_AGENT = 'for-pocket/0.5 (+https://for-pocket-698348906987.asia-northeast1.run.app)';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const providerQueues = new Map();

function coordinate(value, limit) {
  if (typeof value !== 'number' && typeof value !== 'string' || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : undefined;
}
function distanceMeters(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const lat = radians(b.lat - a.lat), lng = radians(b.lng - a.lng);
  const h = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function merchantCategory(key, value) {
  if (key === 'shop') return true;
  return ({
    amenity: ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream', 'cinema', 'theatre', 'pharmacy', 'fuel'],
    tourism: ['hotel', 'hostel', 'motel', 'museum', 'attraction', 'gallery'],
    leisure: ['fitness_centre', 'sports_centre', 'swimming_pool'],
  })[key]?.includes(value) || false;
}
function candidate(name, lat, lng, category, type) {
  const location = normalizeLocation({ name });
  const latitude = coordinate(lat, 90), longitude = coordinate(lng, 180);
  if (!location?.name || latitude === undefined || longitude === undefined || !merchantCategory(category, type)) return undefined;
  return { name: location.name, lat: latitude, lng: longitude };
}
function compactAddress(parts) {
  return [...new Set(parts.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].join(' · ');
}
function photonContext(data) {
  const item = data?.features?.[0];
  const p = item?.properties;
  if (!p || typeof p !== 'object') return {};
  const area = p.district || p.locality || p.city || p.county || p.state;
  return {
    location: normalizeLocation({ area, address: compactAddress([p.street, area, p.city, p.state]), countryCode: p.countrycode }),
    candidate: item.geometry?.type === 'Point' ? candidate(p.name, item.geometry.coordinates?.[1], item.geometry.coordinates?.[0], p.osm_key, p.osm_value) : undefined,
  };
}
function nominatimContext(data) {
  const address = data?.address;
  if (!address || typeof address !== 'object') return {};
  const area = address.neighbourhood || address.suburb || address.city_district || address.borough || address.city || address.town || address.village || address.county || address.state;
  return {
    location: normalizeLocation({ area, address: compactAddress([address.road, area, address.city || address.town || address.village, address.state]), countryCode: address.country_code }),
    candidate: candidate(data.name, data.lat, data.lon, data.category || data.class, data.type),
  };
}
function withContext(base, context, accuracy) {
  // Reverse geocoding returns a nearby indexed object, not proof of the place
  // visited. Only a close commercial POI with precise GPS can be suggested.
  const nearby = context?.candidate;
  const name = !base.name && nearby && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 50
    && distanceMeters(base, nearby) <= 25 ? nearby.name : undefined;
  return normalizeLocation({ ...context?.location, ...(name ? { name } : {}), ...base });
}

// Shared across resolver instances in this process. Public Nominatim requires
// a single deployment instance (or an external distributed limiter) as well.
function queueFor(endpoint) {
  const key = endpoint.origin;
  if (!providerQueues.has(key)) providerQueues.set(key, { tail: Promise.resolve(), nextAt: 0, pending: 0 });
  return providerQueues.get(key);
}
async function reserve(queue, { now, sleep, intervalMs, deadline, maxPending }) {
  if (queue.pending >= maxPending) return false;
  queue.pending++;
  const previous = queue.tail;
  let release;
  queue.tail = new Promise(resolve => { release = resolve; });
  try {
    await previous;
    const delay = Math.max(0, queue.nextAt - now());
    if (now() + delay >= deadline) return false;
    if (delay) await sleep(delay);
    if (now() >= deadline) return false;
    queue.nextAt = now() + intervalMs;
    return true;
  } finally {
    queue.pending--;
    release();
  }
}

/**
 * Resolve one explicitly acquired coordinate. No timers poll for location and
 * no location data is logged or written to disk by this module.
 * Photon is a modest-use default; GEO_REVERSE_URL can select a private service.
 * Public Nominatim is opt-in because its one-request/sec cap is application-wide:
 * https://operations.osmfoundation.org/policies/nominatim/
 */
export function createLocationResolver(options = {}) {
  const provider = options.provider || process.env.GEO_REVERSE_PROVIDER || 'photon';
  const source = options.endpoint ?? process.env.GEO_REVERSE_URL ?? (provider === 'nominatim' ? DEFAULT_NOMINATIM_URL : DEFAULT_PHOTON_URL);
  let endpoint;
  try { endpoint = new URL(source); } catch {}
  const publicNominatim = endpoint?.hostname === 'nominatim.openstreetmap.org';
  const acknowledged = options.allowPublicNominatim ?? process.env.GEO_NOMINATIM_PUBLIC_SINGLE_INSTANCE === 'true';
  const enabled = ['photon', 'nominatim'].includes(provider) && endpoint && ['https:', 'http:'].includes(endpoint.protocol)
    && !endpoint.username && !endpoint.password && (!publicNominatim || acknowledged);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const sleep = options.sleep || wait;
  const ttlMs = options.ttlMs ?? 2 * 60 * 60 * 1000;
  const failureTtlMs = options.failureTtlMs ?? 60 * 1000;
  const timeoutMs = Math.max(20, Math.min(options.timeoutMs ?? 3000, 10000));
  const maxEntries = Math.max(1, options.maxEntries ?? 512);
  const maxPending = Math.max(1, options.maxPending ?? 8);
  const intervalMs = publicNominatim ? Math.max(1000, options.minIntervalMs ?? 1000) : Math.max(0, options.minIntervalMs ?? 1000);
  const userAgent = options.userAgent || process.env.GEO_USER_AGENT || DEFAULT_USER_AGENT;
  const cache = new Map(), inFlight = new Map();
  const queue = enabled ? queueFor(endpoint) : null;

  function remember(key, value, lifetime) {
    cache.delete(key);
    cache.set(key, { value, expiresAt: now() + Math.max(0, lifetime) });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }
  async function lookup(base, language) {
    const deadline = now() + timeoutMs;
    if (!await reserve(queue, { now, sleep, intervalMs, deadline, maxPending })) return { failed: true };
    const url = new URL(endpoint);
    url.searchParams.set('lat', base.lat.toFixed(4));
    url.searchParams.set('lon', base.lng.toFixed(4));
    if (provider === 'nominatim') {
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('zoom', '18');
      url.searchParams.set('accept-language', language);
    } else {
      url.searchParams.set('limit', '1');
      url.searchParams.set('radius', '1');
      // The public Photon dataset has English/French/German and local names.
      // Unsupported language parameters may return 400; keep local proper names.
      if (language === 'en') url.searchParams.set('lang', 'en');
    }
    const controller = new AbortController();
    let timer;
    try {
      const request = async () => {
        const response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw new Error('Geocoder unavailable');
        const data = await response.json();
        return provider === 'nominatim' ? nominatimContext(data) : photonContext(data);
      };
      return await Promise.race([request(), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Geocoder timeout')); }, Math.max(1, deadline - now()));
      })]);
    } catch {
      return { failed: true };
    } finally { clearTimeout(timer); }
  }

  return async function resolveLocation(input, { language = 'en' } = {}) {
    const base = normalizeLocation(input);
    if (!base || base.lat === undefined || !enabled || typeof fetchImpl !== 'function') return base;
    const lang = ['zh', 'uk', 'en'].includes(language) ? language : 'en';
    const accuracy = input.accuracy ?? input.horizontal_accuracy;
    const key = `${base.lat.toFixed(4)}:${base.lng.toFixed(4)}:${lang}`;
    const cached = cache.get(key);
    if (cached?.expiresAt > now()) {
      cache.delete(key); cache.set(key, cached);
      return withContext(base, cached.value, accuracy);
    }
    cache.delete(key);
    let request = inFlight.get(key);
    if (!request) {
      request = lookup(base, lang).catch(() => ({ failed: true })).then(value => {
        remember(key, value, value.failed ? failureTtlMs : ttlMs);
        return value;
      }).finally(() => inFlight.delete(key));
      inFlight.set(key, request);
    }
    return withContext(base, await request, accuracy);
  };
}
