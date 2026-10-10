import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { initialSettings, validateSettings } from './public/shared.mjs';

export const emptyState = () => ({ version: 2, revision: 0, users: {}, identities: {}, sessions: {}, links: {}, circles: {}, ledgers: {} });

// All related changes (identity, circle membership and ledger) commit together.
// The original v1 files remain untouched as a recovery copy after migration.
export function createStore(dataDir) {
  const file = path.join(dataDir, '_pocket-v2.json');
  let state, needsPersist = false, queue = Promise.resolve();
  async function load() {
    if (state) return state;
    try {
      state = JSON.parse(await readFile(file, 'utf8'));
      if (state.version !== 2) throw new Error('Unsupported data version');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = await migrate();
      needsPersist = true;
    }
    return state;
  }
  async function migrate() {
    const db = emptyState();
    let shares = {};
    try { shares = JSON.parse(await readFile(path.join(dataDir, '_shares.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let files = [];
    try { files = await readdir(dataDir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const name of files.filter(n => /^[a-zA-Z0-9_-]+\.json$/.test(n) && !n.startsWith('_'))) {
      const id = name.slice(0, -5), profile = JSON.parse(await readFile(path.join(dataDir, name), 'utf8'));
      if (!Array.isArray(profile.expenses)) continue;
      const settings = validateSettings(profile.settings);
      const legacyMembers = settings.consumers;
      db.ledgers[id] = { settings: { ...settings, consumers: [] }, expenses: profile.expenses.map(entry => ({ ...entry, member: entry.member || legacyMembers.find(m => m.id === entry.consumer) || null })) };
      if (!id.startsWith('cir_')) db.users[id] = { id, name: 'Me', color: 'blue', avatar: 'cat', settings: { ...settings, consumers: [] }, activeCircleId: null };
    }
    for (const [id, p] of Object.entries(shares.userProfiles || {})) {
      db.users[id] = { id, name: p.name || 'Me', color: p.color || 'blue', avatar: p.avatar || 'cat', settings: db.users[id]?.settings || initialSettings(), activeCircleId: null };
    }
    for (const id of Object.keys(db.users)) {
      if (/^\d+$/.test(id)) db.identities[`telegram:${id}`] = id;
      db.ledgers[id] ||= { settings: initialSettings(), expenses: [] };
    }
    // Google subjects were previously stored without verification. Reauthentication
    // is mandatory; email aliases and old sessions never authorize a v2 request.
    for (const [key, id] of Object.entries(shares.accounts || {})) {
      if (/^(telegram:\d+|google:[a-zA-Z0-9_-]+)$/.test(key) && db.users[id]) db.identities[key] = id;
    }
    for (const c of Object.values(shares.circles || {})) {
      const members = [...new Set(c.members)].filter(id => db.users[id]);
      if (!members.length) continue;
      db.circles[c.id] = { ...c, members, admins: [members.includes(c.ownerId) ? c.ownerId : members[0]], invite: null };
      db.ledgers[c.ledgerId] ||= { settings: initialSettings(), expenses: [] };
    }
    const pairs = new Set();
    for (const [id, partner] of Object.entries(shares.pairPartners || {})) {
      if (!db.users[id] || !db.users[partner]) continue;
      const key = [id, partner].sort().join(':');
      if (pairs.has(key)) continue;
      pairs.add(key);
      const ledgerId = shares.ledgerOwners?.[id] || id;
      const circleId = `cir_${randomUUID()}`;
      const newLedger = `${circleId}_ledger`;
      db.ledgers[newLedger] = structuredClone(db.ledgers[ledgerId] || { settings: initialSettings(), expenses: [] });
      db.circles[circleId] = { id: circleId, name: 'Shared', members: [id, partner], admins: [id], ledgerId: newLedger, invite: null };
      db.users[id].activeCircleId = circleId; db.users[partner].activeCircleId = circleId;
    }
    for (const [id, circleId] of Object.entries(shares.activeCircles || {})) {
      if (db.circles[circleId]?.members.includes(id)) db.users[id].activeCircleId = circleId;
    }
    return db;
  }
  return {
    async run(callback) {
      const task = queue.catch(() => {}).then(async () => {
        const current = await load();
        const next = structuredClone(current);
        const result = await callback(next);
        // Read-only polls do not rewrite the database or increment its revision.
        if (needsPersist || JSON.stringify(current) !== JSON.stringify(next)) {
          next.revision = current.revision + 1;
          await mkdir(dataDir, { recursive: true });
          const temp = `${file}.${randomUUID()}.tmp`;
          await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
          await rename(temp, file); state = next; needsPersist = false;
        }
        return result;
      });
      queue = task;
      return task;
    },
  };
}
