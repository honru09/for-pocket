import { randomUUID, randomBytes, randomInt, createHash } from 'node:crypto';
import { initialSettings, resolveLanguage, validateSettings, validateExpense, validateUserProfile, validateEntryTime, dateKey, MAX_CIRCLE_MEMBERS, MAX_CATEGORIES } from './public/shared.mjs';
import { validTimezone } from './public/timezone.mjs';

export class RequestError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const fail = (message, status) => { throw new RequestError(message, status); };
export const hash = value => createHash('sha256').update(value).digest('hex');
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => codeChars[randomInt(codeChars.length)]).join('');
const memberId = id => `u_${id}`;
function forgetPendingLocations(db, ...uids) {
  if (!db.telegram) return;
  const affected = new Set(uids);
  for (const [key, session] of Object.entries(db.telegram.locations || {})) if (affected.has(session?.uid)) delete db.telegram.locations[key];
  for (const update of Object.values(db.telegram.updates || {})) if (affected.has(update?.locationEntry?.uid)) delete update.locationEntry;
}
function cleanCode(value) { const c = String(value || '').trim().toUpperCase(); if (!/^[A-Z2-9]{6}$/.test(c)) fail('errorInvalidCode'); return c; }
export function member(db, id) { const u = db.users[id]; return { id: memberId(id), name: u.name, color: u.color, avatar: u.avatar }; }
export function ensureUser(db, identity, info = {}) {
  let uid = db.identities[identity];
  if (!uid) { uid = identity.startsWith('telegram:') ? identity.slice(9) : `g_${randomUUID()}`; db.identities[identity] = uid; }
  if (!db.users[uid]) db.users[uid] = { id: uid, name: (info.first_name || info.name || 'Me').slice(0, 24), color: 'yellow', avatar: /^https:\/\//.test(info.picture || info.photo_url || '') ? info.picture || info.photo_url : 'cloud', settings: initialSettings(resolveLanguage(info.language_code || info.locale || 'en')), activeCircleId: null };
  if (info.email) db.users[uid].googleEmail = info.email;
  db.ledgers[uid] ||= { settings: initialSettings(), expenses: [] };
  return uid;
}
function circleFor(db, uid, id = db.users[uid].activeCircleId) {
  if (!id) return null;
  const c = db.circles[id]; if (!c?.members.includes(uid)) fail('errorMembership', 403); return c;
}
function context(db, uid) {
  if (db.users[uid].activeCircleId && !db.circles[db.users[uid].activeCircleId]?.members.includes(uid)) {
    db.users[uid].activeCircleId = null;
    forgetPendingLocations(db, uid);
  }
  const circle = circleFor(db, uid), ledgerId = circle?.ledgerId || uid;
  db.ledgers[ledgerId] ||= { settings: initialSettings(), expenses: [] };
  return { circle, ledgerId, ledger: db.ledgers[ledgerId], consumers: (circle?.members || [uid]).map(id => member(db, id)) };
}
function viewCircle(db, c, uid) { return { id: c.id, name: c.name, isAdmin: c.admins.includes(uid), memberCount: c.members.length, members: c.members.map(id => ({ ...member(db, id), isAdmin: c.admins.includes(id) })) }; }
function requireAdmin(c, uid) { if (!c.admins.includes(uid)) fail('errorAdminOnly', 403); }
export function visible(db, uid) {
  const user = db.users[uid], { circle, ledgerId, ledger, consumers } = context(db, uid);
  const keys = Object.keys(db.identities).filter(k => db.identities[k] === uid);
  return { ledgerId, revision: db.revision,
    settings: { ...ledger.settings, currency: user.settings.currency, language: user.settings.language, languageManual: user.settings.languageManual, consumers },
    expenses: ledger.expenses.filter(e => !e.deletedAt).map(e => ({ ...e, canDelete: !circle || circle.admins.includes(uid) || e.createdBy === uid })),
    user: member(db, uid), account: { hasTelegram: keys.some(k => k.startsWith('telegram:')), hasGoogle: keys.some(k => k.startsWith('google:')), googleEmail: user.googleEmail || null },
    social: { circles: Object.values(db.circles).filter(c => c.members.includes(uid)).map(c => viewCircle(db, c, uid)), activeCircleId: circle?.id || null, activeCircle: circle ? viewCircle(db, circle, uid) : null, maxMembers: MAX_CIRCLE_MEMBERS },
  };
}
function checkLedger(db, uid, id) { const ctx = context(db, uid); if (id && id !== ctx.ledgerId) fail('errorLedgerChanged', 409); return ctx; }
export function issueSession(db, uid, now) {
  const value = randomBytes(32).toString('base64url');
  for (const [key, s] of Object.entries(db.sessions)) if (s.expiresAt <= now) delete db.sessions[key];
  db.sessions[hash(value)] = { userId: uid, expiresAt: now + 30 * 86400000 }; return value;
}
function mergeAccounts(db, source, target) {
  if (source === target) return;
  for (const provider of ['google:', 'telegram:']) {
    const a = Object.keys(db.identities).filter(k => k.startsWith(provider) && db.identities[k] === source);
    const b = Object.keys(db.identities).filter(k => k.startsWith(provider) && db.identities[k] === target);
    if (a.length && b.length && a.some(k => !b.includes(k))) fail('errorLinkConflict', 409);
  }
  const from = db.ledgers[source], to = db.ledgers[target];
  for (const pool of ['categories', 'incomeCategories']) {
    const merged = structuredClone(to.settings[pool]);
    for (const category of from?.settings[pool] || []) {
      if (merged.some(c => c.label === category.label)) continue;
      if (merged.length >= MAX_CATEGORIES) fail('errorLinkCategories', 409);
      const id = merged.some(c => c.id === category.id) ? randomUUID() : category.id;
      merged.push({ ...category, id });
      if (id !== category.id) for (const entry of from.expenses) {
        if ((entry.type === 'income' ? 'incomeCategories' : 'categories') === pool && entry.categoryId === category.id) {
          entry.categoryId = id; if (entry.category) entry.category.id = id;
        }
      }
    }
    to.settings[pool] = merged;
  }
  if (from) for (const entry of from.expenses) {
    const existing = to.expenses.find(e => e.id === entry.id);
    if (!existing) to.expenses.push(entry);
    else if (JSON.stringify(existing) !== JSON.stringify(entry)) to.expenses.push({ ...entry, id: randomUUID() });
  }
  for (const ledger of Object.values(db.ledgers)) for (const entry of ledger.expenses) {
    if (entry.consumer === memberId(source)) { entry.consumer = memberId(target); if (entry.member) entry.member.id = memberId(target); }
    if (Array.isArray(entry.splitParticipants)) entry.splitParticipants = [...new Set(entry.splitParticipants.map(id => id === memberId(source) ? memberId(target) : id))];
    if (entry.createdBy === source) entry.createdBy = target;
  }
  for (const c of Object.values(db.circles)) {
    c.members = [...new Set(c.members.map(id => id === source ? target : id))];
    c.admins = [...new Set(c.admins.map(id => id === source ? target : id))];
  }
  for (const [key, id] of Object.entries(db.identities)) if (id === source) db.identities[key] = target;
  for (const s of Object.values(db.sessions)) if (s.userId === source) s.userId = target;
  db.users[target].googleEmail ||= db.users[source].googleEmail;
  db.users[target].activeCircleId ||= db.users[source].activeCircleId;
  for (const [key, item] of Object.entries(db.links)) if ([source, target].includes(item.userId)) delete db.links[key];
  forgetPendingLocations(db, source, target);
  delete db.ledgers[source]; delete db.users[source];
}
export function googleLogin(db, payload, { link, uid, now }) {
  const googleUid = ensureUser(db, `google:${payload.sub}`, payload);
  if (!link) return { sessionToken: issueSession(db, googleUid, now), profile: visible(db, googleUid) };
  if (googleUid === uid) return { profile: visible(db, uid) };
  const ticket = randomBytes(24).toString('base64url');
  db.links[hash(ticket)] = { userId: googleUid, forUser: uid, expiresAt: now + 900000 };
  return { linkTicket: ticket, target: member(db, googleUid), entries: db.ledgers[googleUid].expenses.length };
}

export function handleDomain(db, uid, route, method, body, { now, limit, ledgerQuery }) {
  if (route === '/profile' && method === 'GET') return visible(db, uid);
  if (route === '/auth/link-code' && method === 'POST') {
    limit(`link:${uid}`);
    for (const [key, entry] of Object.entries(db.links)) if (entry.userId === uid || entry.expiresAt <= now) delete db.links[key];
    let code; do { code = newCode(); } while (db.links[hash(code)]);
    const expiresAt = now + 900000; db.links[hash(code)] = { userId: uid, expiresAt }; return { code, expiresAt };
  }
  if (['/auth/link-preview', '/auth/link-verify'].includes(route) && method === 'POST') {
    limit(`link:${uid}`);
    const value = body.ticket || cleanCode(body.code), entry = db.links[hash(value)];
    if (!entry || entry.expiresAt <= now || entry.forUser && entry.forUser !== uid || !db.users[entry.userId]) fail('errorLinkExpired', 404);
    if (entry.userId === uid) fail('errorLinkSelf');
    if (route === '/auth/link-preview') return { target: member(db, entry.userId), entries: db.ledgers[entry.userId].expenses.length };
    if (body.confirm !== true) fail('errorConfirm');
    const target = entry.forUser ? uid : entry.userId, source = entry.forUser ? entry.userId : uid;
    mergeAccounts(db, source, target); return { profile: visible(db, target) };
  }
  if (route === '/user-profile' && method === 'PUT') { Object.assign(db.users[uid], validateUserProfile(body)); return visible(db, uid); }
  if (route === '/timezone' && method === 'PUT') {
    const ctx = checkLedger(db, uid, body.ledgerId), zone = validTimezone(body.timezone);
    if (!zone) fail('errorEntryTime');
    db.users[uid].settings.timezone = zone;
    ctx.ledger.settings.timezone = zone;
    return { timezone:zone, ledgerId:ctx.ledgerId };
  }
  if (route === '/settings' && method === 'PUT') {
    const ctx = checkLedger(db, uid, body.ledgerId), valid = validateSettings({ ...body, consumers: ctx.consumers });
    if (ctx.circle && !ctx.circle.admins.includes(uid) && (JSON.stringify(valid.categories) !== JSON.stringify(ctx.ledger.settings.categories) || JSON.stringify(valid.incomeCategories) !== JSON.stringify(ctx.ledger.settings.incomeCategories))) fail('errorAdminOnly', 403);
    db.users[uid].settings = { ...valid, consumers: [] }; ctx.ledger.settings = { ...valid, consumers: [] }; return visible(db, uid);
  }
  if (route === '/circles/create' && method === 'POST') {
    const name = String(body.name || '').trim(); if (!name || Array.from(name).length > 24) fail('errorCircleName');
    if (body.friendIds?.length) fail('errorInvitationRequired');
    const previous = context(db, uid), id = `cir_${randomUUID()}`;
    db.circles[id] = { id, name, ledgerId: id, members: [uid], admins: [uid], invite: null };
    db.ledgers[id] = { settings: structuredClone(previous.ledger.settings), expenses: [] };
    forgetPendingLocations(db, uid);
    db.users[uid].activeCircleId = id; return visible(db, uid);
  }
  if (route === '/circles/switch' && method === 'POST') { if (body.circleId) circleFor(db, uid, body.circleId); forgetPendingLocations(db, uid); db.users[uid].activeCircleId = body.circleId || null; return visible(db, uid); }
  if (route === '/circles/invite' && method === 'POST') {
    const c = circleFor(db, uid, body.circleId); if (!c) fail('errorMembership', 403);
    if (body.renew) requireAdmin(c, uid);
    if (!c.invite || c.invite.expiresAt <= now || body.renew) {
      let code; do { code = newCode(); } while (Object.values(db.circles).some(other => other.invite?.code === code));
      c.invite = { code, expiresAt: now + 72 * 3600000 };
    }
    return { ...c.invite, circleId: c.id };
  }
  if (['/circles/preview', '/circles/join'].includes(route) && method === 'POST') {
    limit(`invite:${uid}`);
    const code = cleanCode(body.code), c = Object.values(db.circles).find(c => c.invite?.code === code && c.invite.expiresAt > now);
    if (!c) fail('errorInviteExpired', 404);
    if (route === '/circles/preview') return { circle: viewCircle(db, c, uid), expiresAt: c.invite.expiresAt, alreadyMember: c.members.includes(uid) };
    if (body.confirm !== true) fail('errorConfirm');
    if (!c.members.includes(uid)) { if (c.members.length >= MAX_CIRCLE_MEMBERS) fail('errorCircleFull', 409); c.members.push(uid); }
    forgetPendingLocations(db, uid);
    db.users[uid].activeCircleId = c.id; return visible(db, uid);
  }
  if (['/circles/rename', '/circles/admin', '/circles/remove', '/circles/leave'].includes(route) && method === 'POST') {
    const c = circleFor(db, uid, body.circleId); if (!c) fail('errorMembership', 403);
    if (route !== '/circles/leave') requireAdmin(c, uid);
    if (route === '/circles/rename') {
      const name = String(body.name || '').trim(); if (!name || Array.from(name).length > 24) fail('errorCircleName'); c.name = name;
    } else if (route === '/circles/admin') {
      const person = c.members.find(id => memberId(id) === body.memberId); if (!person) fail('errorMembership', 403);
      if (body.isAdmin) c.admins = [...new Set([...c.admins, person])];
      else { if (c.admins.length === 1 && c.admins.includes(person)) fail('errorLastAdmin'); c.admins = c.admins.filter(id => id !== person); }
    } else {
      if (body.confirm !== true) fail('errorConfirm');
      const departing = route === '/circles/leave' ? uid : c.members.find(id => memberId(id) === body.memberId);
      if (!departing) fail('errorMembership', 403);
      forgetPendingLocations(db, departing);
      c.members = c.members.filter(id => id !== departing); c.admins = c.admins.filter(id => id !== departing);
      if (c.members.length && !c.admins.length) c.admins = [c.members[0]];
      if (db.users[departing].activeCircleId === c.id) db.users[departing].activeCircleId = null;
      c.invite = null;
      if (!c.members.length) delete db.circles[c.id]; // Historical ledger stays on disk.
    }
    return visible(db, uid);
  }
  if (route === '/expenses/import' && method === 'POST') {
    checkLedger(db, uid, body.ledgerId);
    if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 50) fail('errorAiInput', 400);
    const ids = body.entries.map(entry => entry?.id);
    if (new Set(ids).size !== ids.length) fail('errorExpenseId', 400);
    // The store commits the complete operation only after every row succeeds.
    return { entries: body.entries.map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('errorAiInput', 400);
      if (entry.ledgerId && entry.ledgerId !== body.ledgerId) fail('errorLedgerChanged', 409);
      return handleDomain(db, uid, '/expenses', 'POST', { ...entry, ledgerId: body.ledgerId }, { now, limit, ledgerQuery });
    }) };
  }
  if (route === '/expenses' && method === 'POST') {
    const { ledger, ledgerId, consumers } = checkLedger(db, uid, body.ledgerId), existing = ledger.expenses.find(e => e.id === body.id);
    if (existing) { if (existing.deletedAt) fail('errorDeleted', 409); return existing; }
    if (ledger.expenses.length >= 10000) fail('errorCapacity', 409);
    const valid = validateExpense(body, { ...ledger.settings, consumers });
    const occurredAt = valid.occurredAt || new Date(now).toISOString();
    const entry = { ...valid, occurredAt, ledgerId, member: structuredClone(consumers.find(c => c.id === valid.consumer)), createdBy: uid, createdAt: new Date(now).toISOString(), dayKey: dateKey(new Date(occurredAt), valid.timezone) };
    ledger.expenses.push(entry); return entry;
  }
  const recordRoute = /^\/expenses\/([a-zA-Z0-9_-]{8,64})(\/restore)?$/.exec(route);
  if (recordRoute && !recordRoute[2] && method === 'PUT') {
    const { ledger, circle } = checkLedger(db, uid, body.ledgerId);
    const entry = ledger.expenses.find(e => e.id === recordRoute[1] && !e.deletedAt); if (!entry) fail('errorMissing', 404);
    if (circle && entry.createdBy !== uid && !circle.admins.includes(uid)) fail('errorEditPermission', 403);
    Object.assign(entry, validateEntryTime(body.occurredAt, body.timezone), { updatedAt: new Date(now).toISOString() });
    return entry;
  }
  if (recordRoute && (method === 'DELETE' && !recordRoute[2] || method === 'POST' && recordRoute[2])) {
    const { ledger, circle } = checkLedger(db, uid, body.ledgerId || ledgerQuery);
    const entry = ledger.expenses.find(e => e.id === recordRoute[1]); if (!entry) fail('errorMissing', 404);
    if (circle && entry.createdBy !== uid && !circle.admins.includes(uid)) fail('errorEntryPermission', 403);
    if (method === 'DELETE') entry.deletedAt = new Date(now).toISOString(); else delete entry.deletedAt;
    return entry;
  }
  fail('errorNotFound', 404);
}
