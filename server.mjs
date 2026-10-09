import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateInitData } from './auth.mjs';
import { initialSettings, resolveLanguage, validateSettings, validateExpense, dateKey, CONSUMER_COLORS, DEFAULT_CONSUMERS } from './public/shared.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, 'dist');
const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
class RequestError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export async function configureTelegramMenuButton(token, url) {
  if (!token || !url) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        menu_button: {
          type: 'web_app',
          text: 'Pocket',
          web_app: { url },
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await res.json();
    if (result.ok) {
      console.log('Telegram Chat Menu Button configured successfully for', url);
    } else {
      console.warn('Telegram setChatMenuButton response:', result.description);
    }
  } catch (err) {
    console.warn('Telegram setChatMenuButton failed:', err.message);
  }
}

export function createApp({ token = process.env.BOT_TOKEN || '', dataDir = path.resolve(root, process.env.DATA_DIR || 'data'), publicUrl = process.env.PUBLIC_URL || '', maxAgeSeconds = Number(process.env.AUTH_MAX_AGE_SECONDS || 86400) } = {}) {
  const queues = new Map();
  const canonicalOrigin = publicUrl && token ? new URL(publicUrl).origin : null;
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 60) throw new Error('AUTH_MAX_AGE_SECONDS must be an integer >= 60');
  const fileFor = userId => path.join(dataDir, `${userId}.json`);
  const sharesFile = path.join(dataDir, '_shares.json');

  async function readShares() {
    try {
      const data = JSON.parse(await readFile(sharesFile, 'utf8'));
      return {
        userShareCodes: data.userShareCodes || {},
        codeToUser: data.codeToUser || {},
        ledgerOwners: data.ledgerOwners || {},
        pairPartners: data.pairPartners || {},
        userProfiles: data.userProfiles || {},
      };
    } catch (err) {
      if (err.code === 'ENOENT') return { userShareCodes: {}, codeToUser: {}, ledgerOwners: {}, pairPartners: {}, userProfiles: {} };
      throw err;
    }
  }

  async function mutateShares(callback) {
    const previous = queues.get('_shares') || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const shares = await readShares();
      const result = callback(shares);
      await mkdir(dataDir, { recursive: true });
      const temporary = `${sharesFile}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(shares), { mode: 0o600 });
      await rename(temporary, sharesFile);
      return result;
    });
    queues.set('_shares', current);
    try { return await current; }
    finally { if (queues.get('_shares') === current) queues.delete('_shares'); }
  }

  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function generateShareCode(existing) {
    let code;
    do {
      code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (existing[code]);
    return code;
  }

  async function ensureUserShare(userId, userObj = {}) {
    return mutateShares(shares => {
      if (!shares.userShareCodes[userId]) {
        const code = generateShareCode(shares.codeToUser);
        shares.userShareCodes[userId] = code;
        shares.codeToUser[code] = userId;
      }
      if (!shares.userProfiles[userId]) {
        const name = (userObj.first_name || userObj.username || (userId === '101' ? 'Xingrun' : '我')).trim();
        shares.userProfiles[userId] = {
          name: name.slice(0, 24),
          color: userId === '101' ? 'blue' : 'milk',
          avatar: userObj.photo_url || (userId === '101' ? 'cat' : 'bunny'),
        };
      }
      return shares;
    });
  }

  async function readProfile(userId, defaultLang = 'zh') {
    try {
      const data = JSON.parse(await readFile(fileFor(userId), 'utf8'));
      data.settings = validateSettings(data.settings);
      if (!Array.isArray(data.expenses)) throw new Error('Invalid stored profile');
      return data;
    } catch (err) {
      if (err.code === 'ENOENT') return { settings: initialSettings(defaultLang), expenses: [] };
      throw err;
    }
  }

  function visible(data, userId, shares) {
    if (!userId) return { settings: data.settings, expenses: data.expenses.filter(e => !e.deletedAt) };
    const partnerId = shares?.pairPartners?.[userId];
    const partnerProfile = partnerId ? shares?.userProfiles?.[partnerId] : null;
    const myProfile = shares?.userProfiles?.[userId] || { name: '我', color: 'blue', avatar: 'cat' };

    const consumers = structuredClone(data.settings.consumers || DEFAULT_CONSUMERS);
    if (partnerId) {
      const myId = `u_${userId}`;
      const partnerMemberId = `u_${partnerId}`;
      let myMember = consumers.find(c => c.id === myId);
      if (!myMember) {
        myMember = { id: myId, name: myProfile.name, color: myProfile.color, avatar: myProfile.avatar };
        consumers.unshift(myMember);
      } else {
        myMember.name = myProfile.name;
        myMember.color = myProfile.color;
        myMember.avatar = myProfile.avatar;
      }

      let partnerMember = consumers.find(c => c.id === partnerMemberId);
      if (!partnerMember) {
        partnerMember = { id: partnerMemberId, name: partnerProfile?.name || 'Ta', color: partnerProfile?.color || 'milk', avatar: partnerProfile?.avatar || 'bunny' };
        consumers.splice(1, 0, partnerMember);
      } else if (partnerProfile) {
        partnerMember.name = partnerProfile.name;
        partnerMember.color = partnerProfile.color;
        partnerMember.avatar = partnerProfile.avatar;
      }
    }

    return {
      settings: { ...data.settings, consumers },
      expenses: data.expenses.filter(e => !e.deletedAt),
      share: {
        code: shares?.userShareCodes?.[userId] || '',
        isPaired: Boolean(partnerId),
        partner: partnerProfile ? { id: `u_${partnerId}`, name: partnerProfile.name, avatar: partnerProfile.avatar, color: partnerProfile.color } : null,
      },
      user: {
        id: `u_${userId}`,
        name: myProfile.name,
        avatar: myProfile.avatar,
        color: myProfile.color,
      },
    };
  }

  async function transaction(userId, callback) {
    const previous = queues.get(userId) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const profile = await readProfile(userId);
      const result = callback(profile);
      await mkdir(dataDir, { recursive: true });
      const destination = fileFor(userId);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(profile), { mode: 0o600 });
      await rename(temporary, destination);
      return result;
    });
    queues.set(userId, current);
    try { return await current; }
    finally { if (queues.get(userId) === current) queues.delete(userId); }
  }
  async function bodyOf(req) {
    if (!String(req.headers['content-type']).startsWith('application/json')) throw new RequestError('请使用 JSON 格式。', 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) throw new RequestError('请求太大。', 413);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new RequestError('JSON 格式有误。'); }
  }
  function send(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(payload));
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/config' && req.method === 'GET') { send(res, 200, { mode: token ? 'telegram' : 'local' }); return; }
      if (url.pathname.startsWith('/api/')) {
        if (!token) throw new RequestError('本机预览无需服务端账本。', 503);
        let user;
        try { user = validateInitData(req.headers['x-telegram-init-data'], token, { maxAgeSeconds }); }
        catch { throw new RequestError('请从 Telegram bot 重新打开。', 401); }
        const id = String(user.id);
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
          const origin = req.headers.origin;
          const isAllowed = (() => {
            if (origin === 'null') return true;
            try {
              const url = new URL(origin);
              if (url.hostname === 'web.telegram.org' || url.hostname.endsWith('.telegram.org')) return true;
              if (canonicalOrigin && url.origin === canonicalOrigin) return true;
              const forwardedHost = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
              const host = req.headers.host || '';
              const allowedHosts = new Set([
                forwardedHost.split(':')[0],
                host.split(':')[0],
                'localhost',
                '127.0.0.1',
              ].filter(Boolean));
              return allowedHosts.has(url.hostname);
            } catch {
              return false;
            }
          })();
          if (!isAllowed) throw new RequestError('请求来源不匹配。', 403);
        }
        if (url.pathname === '/api/profile' && req.method === 'GET') {
          const shares = await ensureUserShare(id, user);
          const ledgerId = shares.ledgerOwners[id] || id;
          await queues.get(ledgerId)?.catch(() => {});
          const autoLang = resolveLanguage(user?.language_code, 'zh');
          const profile = await readProfile(ledgerId, autoLang);
          if (!profile.settings.languageManual && profile.settings.language !== autoLang) {
            profile.settings.language = autoLang;
            await transaction(ledgerId, p => { p.settings.language = autoLang; return p; });
          }
          send(res, 200, visible(profile, id, shares)); return;
        }
        if (url.pathname === '/api/settings' && req.method === 'PUT') {
          let settings;
          try { settings = validateSettings(await bodyOf(req)); }
          catch (err) { throw err instanceof RequestError ? err : new RequestError(err.message); }
          const shares = await ensureUserShare(id, user);
          const ledgerId = shares.ledgerOwners[id] || id;
          send(res, 200, visible(await transaction(ledgerId, profile => {
            profile.settings = { ...settings, languageManual: true };
            return profile;
          }), id, shares)); return;
        }
        if (url.pathname === '/api/pair' && req.method === 'POST') {
          const body = await bodyOf(req);
          const code = String(body?.code || '').trim().toUpperCase();
          if (!code || code.length !== 6) throw new RequestError('请输入有效的 6 位共享码。', 400);
          const shares = await ensureUserShare(id, user);
          const targetUserId = shares.codeToUser[code];
          if (!targetUserId) throw new RequestError('未找到该共享码对应的账本。', 404);
          if (targetUserId === id) throw new RequestError('不能连接自己的共享码。', 400);

          const partnerId = targetUserId;
          const targetLedgerId = shares.ledgerOwners[targetUserId] || targetUserId;
          const currentCallerLedgerId = shares.ledgerOwners[id] || id;

          const callerData = await readProfile(currentCallerLedgerId);
          await transaction(targetLedgerId, targetData => {
            if (currentCallerLedgerId !== targetLedgerId) {
              for (const item of callerData.expenses) {
                if (!targetData.expenses.some(e => e.id === item.id)) {
                  targetData.expenses.push(item);
                }
              }
            }
            const myMemberId = `u_${id}`;
            const partnerMemberId = `u_${partnerId}`;
            if (!targetData.settings.consumers.some(c => c.id === myMemberId)) {
              targetData.settings.consumers.push({
                id: myMemberId,
                name: shares.userProfiles[id]?.name || '我',
                color: shares.userProfiles[id]?.color || 'milk',
                avatar: shares.userProfiles[id]?.avatar || 'bunny',
              });
            }
            if (!targetData.settings.consumers.some(c => c.id === partnerMemberId)) {
              targetData.settings.consumers.push({
                id: partnerMemberId,
                name: shares.userProfiles[partnerId]?.name || 'Ta',
                color: shares.userProfiles[partnerId]?.color || 'blue',
                avatar: shares.userProfiles[partnerId]?.avatar || 'cat',
              });
            }
            return targetData;
          });

          const updatedShares = await mutateShares(s => {
            s.ledgerOwners[id] = targetLedgerId;
            s.ledgerOwners[partnerId] = targetLedgerId;
            s.pairPartners[id] = partnerId;
            s.pairPartners[partnerId] = id;
            return s;
          });

          const merged = await readProfile(targetLedgerId);
          send(res, 200, visible(merged, id, updatedShares)); return;
        }
        if (url.pathname === '/api/unpair' && req.method === 'POST') {
          const shares = await ensureUserShare(id, user);
          const partnerId = shares.pairPartners[id];
          const sharedLedgerId = shares.ledgerOwners[id] || id;

          if (partnerId) {
            const currentData = await readProfile(sharedLedgerId);
            await transaction(id, myData => {
              myData.settings = structuredClone(currentData.settings);
              myData.expenses = structuredClone(currentData.expenses);
              return myData;
            });

            const updatedShares = await mutateShares(s => {
              delete s.ledgerOwners[id];
              delete s.pairPartners[id];
              delete s.pairPartners[partnerId];
              return s;
            });

            const myProfile = await readProfile(id);
            send(res, 200, visible(myProfile, id, updatedShares)); return;
          }

          const myProfile = await readProfile(id);
          send(res, 200, visible(myProfile, id, shares)); return;
        }
        if (url.pathname === '/api/user-profile' && req.method === 'PUT') {
          const body = await bodyOf(req);
          const name = typeof body?.name === 'string' ? body.name.trim() : '';
          if (!name || Array.from(name).length > 24) throw new RequestError('角色名称需为 1–24 个字。', 400);
          const color = CONSUMER_COLORS.includes(body?.color) ? body.color : 'blue';
          const avatar = typeof body?.avatar === 'string' && body.avatar ? body.avatar : 'cat';

          const updatedShares = await mutateShares(s => {
            s.userProfiles[id] = { name, color, avatar };
            return s;
          });

          const ledgerId = updatedShares.ledgerOwners[id] || id;
          const profile = await transaction(ledgerId, data => {
            const member = data.settings.consumers.find(c => c.id === `u_${id}`);
            if (member) {
              member.name = name;
              member.color = color;
              member.avatar = avatar;
            } else {
              data.settings.consumers.push({ id: `u_${id}`, name, color, avatar });
            }
            return data;
          });
          send(res, 200, visible(profile, id, updatedShares)); return;
        }
        if (url.pathname === '/api/expenses' && req.method === 'POST') {
          const payload = await bodyOf(req);
          const shares = await ensureUserShare(id, user);
          const ledgerId = shares.ledgerOwners[id] || id;
          const entry = await transaction(ledgerId, profile => {
            const myMemberId = `u_${id}`;
            if (!profile.settings.consumers.some(c => c.id === myMemberId)) {
              profile.settings.consumers.push({
                id: myMemberId,
                name: shares.userProfiles[id]?.name || '我',
                color: shares.userProfiles[id]?.color || 'blue',
                avatar: shares.userProfiles[id]?.avatar || 'cat',
              });
            }
            const partnerId = shares.pairPartners[id];
            if (partnerId) {
              const partnerMemberId = `u_${partnerId}`;
              if (!profile.settings.consumers.some(c => c.id === partnerMemberId)) {
                profile.settings.consumers.push({
                  id: partnerMemberId,
                  name: shares.userProfiles[partnerId]?.name || 'Ta',
                  color: shares.userProfiles[partnerId]?.color || 'milk',
                  avatar: shares.userProfiles[partnerId]?.avatar || 'bunny',
                });
              }
            }
            const existing = profile.expenses.find(e => e.id === payload?.id);
            if (existing) {
              if (existing.deletedAt) throw new RequestError('这笔记录已移除，请重新输入。', 409);
              return existing;
            }
            let valid;
            try { valid = validateExpense(payload, profile.settings); }
            catch (err) { throw new RequestError(err.message); }
            if (profile.expenses.length >= 10000) throw new RequestError('账本已达 10000 笔容量，请备份后扩展存储。', 409);
            const now = new Date();
            const record = { ...valid, createdAt: now.toISOString(), dayKey: dateKey(now, valid.timezone) };
            profile.expenses.push(record); return record;
          });
          send(res, 200, entry); return;
        }
        const recordRoute = /^\/api\/expenses\/([a-zA-Z0-9_-]{8,64})(\/restore)?$/.exec(url.pathname);
        if (recordRoute && ((req.method === 'DELETE' && !recordRoute[2]) || (req.method === 'POST' && recordRoute[2]))) {
          const shares = await ensureUserShare(id, user);
          const ledgerId = shares.ledgerOwners[id] || id;
          send(res, 200, await transaction(ledgerId, profile => {
            const entry = profile.expenses.find(e => e.id === recordRoute[1]);
            if (!entry) throw new RequestError('找不到这笔记录。', 404);
            if (req.method === 'DELETE') entry.deletedAt = new Date().toISOString();
            else delete entry.deletedAt;
            return entry;
          })); return;
        }
        throw new RequestError('接口不存在。', 404);
      }
      if (['/health', '/healthz'].includes(url.pathname) && req.method === 'GET') { send(res, 200, { ok: true }); return; }
      const isIndex = url.pathname === '/' || url.pathname === '/index.html';
      const assetName = /^\/assets\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname)?.[1];
      const contentType = isIndex ? 'text/html' : assetName && contentTypes[path.extname(assetName)];
      if (contentType && ['GET', 'HEAD'].includes(req.method)) {
        let content;
        try { content = await readFile(isIndex ? path.join(distDir, 'index.html') : path.join(distDir, 'assets', assetName)); }
        catch (error) { if (error.code === 'ENOENT') throw new RequestError('页面不存在。', 404); throw error; }
        res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8`, 'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
        res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      send(res, 404, { error: '页面不存在。' });
    } catch (err) {
      if (!(err instanceof RequestError)) console.error('Request failed:', err.name, err.code || 'internal');
      if (!res.headersSent) send(res, err.status || 500, { error: err instanceof RequestError ? err.message : '暂时没有保存成功，请稍后重试。' });
      else res.end();
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  const app = createApp();
  app.listen(port, host, () => {
    console.log(`for. is ready at http://${host}:${port} (${process.env.BOT_TOKEN ? 'Telegram authentication enabled' : 'local preview'})`);
    if (process.env.BOT_TOKEN) {
      configureTelegramMenuButton(process.env.BOT_TOKEN, process.env.PUBLIC_URL || 'https://for-pocket.onrender.com');
    }
  });
  process.on('SIGINT', () => app.close(() => process.exit(0)));
  process.on('SIGTERM', () => app.close(() => process.exit(0)));
}
