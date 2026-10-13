import { normalizeLocation, locationLabel } from './public/location.mjs';

const FRESH_FOR = 60 * 60 * 1000;

// A place label from an enabled one-shot lookup; no coordinate trail or poll.
export function updateCirclePresence(db, uid, ledgerId, value, now = Date.now()) {
  const circle=Object.values(db.circles || {}).find(c=>c.ledgerId===ledgerId && c.members.includes(uid));
  if (!circle) return;
  const location=normalizeLocation(value);
  if (!location || !locationLabel(location)) {
    if (circle.locations) delete circle.locations[uid];
    return;
  }
  const { name, area, address, countryCode }=location;
  circle.locations ||= {};
  circle.locations[uid]={location:{name,area,address,countryCode},updatedAt:now};
}

export function circleMemberLocation(circle, uid, now = Date.now()) {
  const presence=circle.locations?.[uid];
  if (!circle.members?.includes(uid) || !presence || now-presence.updatedAt>FRESH_FOR || presence.updatedAt>now+60000) return undefined;
  return normalizeLocation(presence.location);
}
