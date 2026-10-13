// WMO weather-code presentation for the little cloud. This is deliberately
// a small, deterministic mapping: weather is decoration, so an unknown code
// should quietly fall back to the plain cloud instead of blocking entry.
const CODE_GROUPS = {
  storm: new Set([95, 96, 97, 99]),
  snow: new Set([71, 73, 75, 77, 85, 86]),
  fog: new Set([45, 48]),
  rain: new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]),
  sun: new Set([0, 1]),
  cloudy: new Set([2, 3]),
};

/**
 * Convert an Open-Meteo WMO weather code into a mascot accessory state.
 * Wind is in metres per second because the API request explicitly asks for
 * that unit. Severe precipitation always wins over the wind accessory.
 */
export function classifyWeather(code, windSpeed = 0) {
  if ((typeof code !== 'number' && typeof code !== 'string') || String(code).trim() === '') return null;
  const value = Number(code);
  if (!Number.isInteger(value) || !Object.values(CODE_GROUPS).some(group => group.has(value))) return null;
  for (const kind of ['storm', 'snow', 'fog', 'rain']) {
    if (CODE_GROUPS[kind].has(value)) return kind;
  }
  const wind = Number(windSpeed);
  if (Number.isFinite(wind) && wind >= 10) return 'wind';
  if (CODE_GROUPS.sun.has(value)) return 'sun';
  if (CODE_GROUPS.cloudy.has(value)) return 'cloudy';
  return null;
}

export function isWeatherDay(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const day = Number(value);
  return day === 0 ? false : day === 1 ? true : null;
}

// Weather does not need an exact GPS position. A roughly 1 km cell also avoids
// requesting a forecast again when GPS jitters or a new entry reuses the place.
export function weatherCell(location) {
  const { lat, lng } = location || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

export function mascotEnvironment(weather, now = new Date(), timezone) {
  if (weather && ['rain', 'snow', 'fog', 'wind', 'storm'].includes(weather.kind)) return weather.kind;
  let hour = now.getHours();
  try {
    if (timezone) hour = Number(new Intl.DateTimeFormat('en', { timeZone:timezone, hour:'numeric', hourCycle:'h23' }).format(now));
  } catch {}
  if (hour >= 23 || hour < 6) return 'night';
  // The sleep hat belongs to late night, rather than immediately at sunset.
  return weather?.kind === 'sun' && weather.isDay !== false ? 'sun' : null;
}

export function createWeatherClient({ fetch:fetcher = globalThis.fetch, now = Date.now, ttl = 15 * 60_000, timeout = 4500 } = {}) {
  const cache = new Map();
  return {
    async load(location, { signal } = {}) {
      const key = weatherCell(location);
      if (!key || signal?.aborted || typeof fetcher !== 'function') return null;
      const cached = cache.get(key);
      if (cached && now() < cached.until) return cached.value;
      const controller = new AbortController();
      let finishAbort;
      const aborted = new Promise(resolve => { finishAbort = () => resolve(null); });
      const abort = () => { controller.abort(); finishAbort(); };
      signal?.addEventListener('abort', abort, { once:true });
      const timer = setTimeout(abort, timeout);
      try {
        const [lat, lng] = key.split(',');
        const query = new URLSearchParams({ latitude:lat, longitude:lng, current:'weather_code,is_day,wind_speed_10m', wind_speed_unit:'ms', timezone:'auto' });
        const request = (async () => {
          try {
            const response = await fetcher(`https://api.open-meteo.com/v1/forecast?${query}`, { signal:controller.signal });
            if (!response.ok) return null;
            const data = await response.json(), current = data?.current;
            const kind = classifyWeather(current?.weather_code, current?.wind_speed_10m);
            return kind ? { kind, isDay:isWeatherDay(current?.is_day) } : null;
          } catch { return null; }
        })();
        const value = await Promise.race([request, aborted]);
        if (controller.signal.aborted) return null;
        cache.delete(key);
        cache.set(key, { value, until:now() + (value ? ttl : 30_000) });
        if (cache.size > 8) cache.delete(cache.keys().next().value);
        return value;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
    clear() { cache.clear(); },
  };
}
