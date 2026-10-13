import { normalizeLocation, locationLabel } from '../public/location.mjs';

// The animation and optimistic entry have already completed before this runs.
// Only the acquisition belonging to that exact draft may enrich its write.
export async function resolveExpenseLocation(payload, resolution, { timeoutMs = 4000 } = {}) {
  if (!resolution || locationLabel(payload.location)) return payload;
  let timer;
  try {
    const resolved = normalizeLocation(await Promise.race([
      Promise.resolve(resolution).catch(() => undefined),
      new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]));
    if (!resolved) return payload;
    const original = normalizeLocation(payload.location);
    if (original?.lat !== undefined && (original.lat !== resolved.lat || original.lng !== resolved.lng)) return payload;
    const location = normalizeLocation({ ...resolved, ...original });
    return location ? { ...payload, location } : payload;
  } finally { clearTimeout(timer); }
}
