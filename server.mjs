import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateInitData } from './auth.mjs';
import { initialSettings, resolveLanguage, validateSettings, validateExpense, dateKey, CONSUMER_COLORS, DEFAULT_CONSUMERS } from './public/shared.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, 'dist');
const contentTypes = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};
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
        accounts: data.accounts || {},
        sessions: data.sessions || {},
        linkCodes: data.linkCodes || {},
        friends: data.friends || {},
        circles: data.circles || {},
        activeCircles: data.activeCircles || {},
      };
    } catch (err) {
      if (err.code === 'ENOENT') return {
        userShareCodes: {},
        codeToUser: {},
        ledgerOwners: {},
        pairPartners: {},
        userProfiles: {},
        accounts: {},
        sessions: {},
        linkCodes: {},
        friends: {},
        circles: {},
        activeCircles: {},
      };
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
        const name = (userObj.first_name || userObj.name || userObj.username || (userId === '101' ? 'Xingrun' : '我')).trim();
        shares.userProfiles[userId] = {
          name: name.slice(0, 24),
          color: userId === '101' ? 'blue' : 'milk',
          avatar: userObj.photo_url || userObj.avatar || (userId === '101' ? 'cat' : 'bunny'),
          tgUsername: userObj.username ? `@${userObj.username}` : null,
          googleEmail: userObj.googleEmail || null,
        };
      } else {
        if (userObj.username && !shares.userProfiles[userId].tgUsername) {
          shares.userProfiles[userId].tgUsername = `@${userObj.username}`;
        }
        if (userObj.googleEmail && !shares.userProfiles[userId].googleEmail) {
          shares.userProfiles[userId].googleEmail = userObj.googleEmail;
        }
      }
      shares.friends[userId] = shares.friends[userId] || [];
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

  function getEffectiveLedgerId(userId, shares) {
    const activeCircleId = shares?.activeCircles?.[userId];
    const circle = activeCircleId ? shares?.circles?.[activeCircleId] : null;
    if (circle) return circle.ledgerId;
    return shares?.ledgerOwners?.[userId] || userId;
  }

  function visible(data, userId, shares) {
    if (!userId) return { settings: data.settings, expenses: data.expenses.filter(e => !e.deletedAt) };
    const myProfile = shares?.userProfiles?.[userId] || { name: '我', color: 'blue', avatar: 'cat' };
    const activeCircleId = shares?.activeCircles?.[userId];
    const circle = activeCircleId ? shares?.circles?.[activeCircleId] : null;

    let consumers = [];
    if (circle) {
      consumers = circle.members.map(mid => {
        const p = shares?.userProfiles?.[mid] || { name: '好友', color: 'mint', avatar: 'chick' };
        return { id: `u_${mid}`, name: p.name, color: p.color, avatar: p.avatar };
      });
    } else {
      const partnerId = shares?.pairPartners?.[userId];
      const partnerProfile = partnerId ? shares?.userProfiles?.[partnerId] : null;
      consumers = structuredClone(data.settings.consumers || DEFAULT_CONSUMERS);

      const myId = `u_${userId}`;
      let myMember = consumers.find(c => c.id === myId);
      if (!myMember) {
        myMember = { id: myId, name: myProfile.name, color: myProfile.color, avatar: myProfile.avatar };
        consumers.unshift(myMember);
      } else {
        myMember.name = myProfile.name;
        myMember.color = myProfile.color;
        myMember.avatar = myProfile.avatar;
      }

      if (partnerId) {
        const partnerMemberId = `u_${partnerId}`;
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
    }

    const partnerId = shares?.pairPartners?.[userId];
    const partnerProfile = partnerId ? shares?.userProfiles?.[partnerId] : null;

    const myFriendsList = (shares?.friends?.[userId] || []).map(fid => {
      const p = shares?.userProfiles?.[fid] || { name: '好友', avatar: 'cat', color: 'mint' };
      return {
        id: `u_${fid}`,
        userId: fid,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        friendCode: shares?.userShareCodes?.[fid] || '',
        tgUsername: p.tgUsername || null,
        googleEmail: p.googleEmail || null,
      };
    });

    const userCircles = Object.values(shares?.circles || {}).filter(c => c.members.includes(userId)).map(c => ({
      id: c.id,
      name: c.name,
      ownerId: `u_${c.ownerId}`,
      isOwner: c.ownerId === userId,
      memberCount: c.members.length,
      members: c.members.map(mid => {
        const p = shares?.userProfiles?.[mid] || { name: '成员', avatar: 'cat', color: 'blue' };
        return { id: `u_${mid}`, userId: mid, name: p.name, avatar: p.avatar, color: p.color };
      }),
    }));

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
        friendCode: shares?.userShareCodes?.[userId] || '',
        tgUsername: myProfile.tgUsername || null,
        googleEmail: myProfile.googleEmail || null,
      },
      account: {
        hasTelegram: Boolean(myProfile.tgUsername),
        tgUsername: myProfile.tgUsername || null,
        hasGoogle: Boolean(myProfile.googleEmail),
        googleEmail: myProfile.googleEmail || null,
      },
      social: {
        friendCode: shares?.userShareCodes?.[userId] || '',
        myFriendCode: shares?.userShareCodes?.[userId] || '',
        friends: myFriendsList,
        circles: userCircles,
        activeCircleId: activeCircleId || null,
        activeCircle: circle ? {
          id: circle.id,
          name: circle.name,
          ownerId: `u_${circle.ownerId}`,
          isOwner: circle.ownerId === userId,
          members: circle.members.map(mid => {
            const p = shares?.userProfiles?.[mid] || { name: '成员', avatar: 'cat', color: 'blue' };
            return { id: `u_${mid}`, userId: mid, name: p.name, avatar: p.avatar, color: p.color };
          }),
        } : null,
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
      if (size > 32768) throw new RequestError('请求太大。', 413);
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new RequestError('JSON 格式有误。'); }
  }

  async function resolveAuth(req) {
    const initData = req.headers['x-telegram-init-data'];
    if (initData && token) {
      let tgUser;
      try { tgUser = validateInitData(initData, token, { maxAgeSeconds }); }
      catch { throw new RequestError('请从 Telegram bot 重新打开。', 401); }
      const tgId = String(tgUser.id);
      const shares = await readShares();
      const mappedId = shares.accounts?.[`telegram:${tgId}`] || tgId;
      await ensureUserShare(mappedId, tgUser);
      return { id: mappedId, userObj: tgUser, authType: 'telegram' };
    }

    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      const sessionToken = authHeader.slice(7).trim();
      const shares = await readShares();
      const session = shares.sessions?.[sessionToken];
      if (session && session.expiresAt > Date.now()) {
        const userId = session.userId;
        const profile = shares.userProfiles?.[userId] || { name: '我' };
        return { id: userId, userObj: profile, authType: session.authType || 'google', sessionToken };
      }
      throw new RequestError('登录会话已过期，请重新登录。', 401);
    }

    throw new RequestError('请先登录。', 401);
  }
  function send(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(payload));
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/config' && req.method === 'GET') {
        send(res, 200, {
          mode: token ? 'telegram' : 'local',
          googleClientId: process.env.GOOGLE_CLIENT_ID || '',
        });
        return;
      }

      if (url.pathname === '/api/auth/google' && req.method === 'POST') {
        const body = await bodyOf(req);
        let googleUser = null;
        if (body?.credential) {
          try {
            const parts = body.credential.split('.');
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            googleUser = {
              sub: payload.sub,
              email: payload.email,
              name: payload.name || payload.email.split('@')[0],
              avatar: payload.picture || 'cat',
            };
          } catch {
            throw new RequestError('Google 凭证格式无效。', 400);
          }
        } else if (body?.email && body?.sub) {
          googleUser = {
            sub: String(body.sub),
            email: String(body.email),
            name: String(body.name || body.email.split('@')[0]),
            avatar: String(body.avatar || 'cat'),
          };
        } else {
          throw new RequestError('缺少 Google 凭据。', 400);
        }

        const sessionToken = 'ses_' + randomUUID().replace(/-/g, '');
        let targetUserId = null;
        const updatedShares = await mutateShares(s => {
          s.accounts = s.accounts || {};
          s.sessions = s.sessions || {};
          s.userProfiles = s.userProfiles || {};
          s.userShareCodes = s.userShareCodes || {};
          s.codeToUser = s.codeToUser || {};
          s.friends = s.friends || {};

          let uid = s.accounts[`google:${googleUser.sub}`] || s.accounts[`google:${googleUser.email}`];
          if (!uid) {
            uid = 'g_' + googleUser.sub.slice(0, 10);
            s.accounts[`google:${googleUser.sub}`] = uid;
            s.accounts[`google:${googleUser.email}`] = uid;
          }
          targetUserId = uid;

          if (!s.userShareCodes[uid]) {
            const code = generateShareCode(s.codeToUser);
            s.userShareCodes[uid] = code;
            s.codeToUser[code] = uid;
          }
          if (!s.userProfiles[uid]) {
            s.userProfiles[uid] = {
              name: googleUser.name.slice(0, 24),
              avatar: googleUser.avatar,
              color: 'blue',
              googleEmail: googleUser.email,
              tgUsername: null,
            };
          } else {
            s.userProfiles[uid].googleEmail = googleUser.email;
          }
          s.friends[uid] = s.friends[uid] || [];

          s.sessions[sessionToken] = {
            userId: uid,
            authType: 'google',
            createdAt: Date.now(),
            expiresAt: Date.now() + 30 * 86400 * 1000,
          };
          return s;
        });

        const effectiveLedger = getEffectiveLedgerId(targetUserId, updatedShares);
        const profile = await readProfile(effectiveLedger);
        send(res, 200, {
          sessionToken,
          profile: visible(profile, targetUserId, updatedShares),
        });
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        const auth = await resolveAuth(req);
        const id = auth.id;

        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
          const origin = req.headers.origin;
          const isAllowed = (() => {
            if (origin === 'null') return true;
            try {
              const u = new URL(origin);
              if (u.hostname === 'web.telegram.org' || u.hostname.endsWith('.telegram.org')) return true;
              if (canonicalOrigin && u.origin === canonicalOrigin) return true;
              const forwardedHost = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
              const host = req.headers.host || '';
              const allowedHosts = new Set([
                forwardedHost.split(':')[0],
                host.split(':')[0],
                'localhost',
                '127.0.0.1',
              ].filter(Boolean));
              return allowedHosts.has(u.hostname);
            } catch {
              return false;
            }
          })();
          if (!isAllowed) throw new RequestError('请求来源不匹配。', 403);
        }

        if (url.pathname === '/api/auth/link-code' && req.method === 'POST') {
          let code;
          await mutateShares(s => {
            s.linkCodes = s.linkCodes || {};
            code = generateShareCode(s.linkCodes);
            s.linkCodes[code] = { userId: id, expiresAt: Date.now() + 15 * 60 * 1000 };
            return s;
          });
          send(res, 200, { code });
          return;
        }

        if (url.pathname === '/api/auth/link-verify' && req.method === 'POST') {
          const body = await bodyOf(req);
          const inputCode = String(body?.code || '').trim().toUpperCase();
          if (inputCode.length !== 6) throw new RequestError('连携码需为 6 位。', 400);

          let targetUserId = null;
          const updatedShares = await mutateShares(s => {
            s.linkCodes = s.linkCodes || {};
            const entry = s.linkCodes[inputCode];
            if (!entry || entry.expiresAt < Date.now()) throw new RequestError('连携码无效或已过期。', 404);
            targetUserId = entry.userId;
            if (targetUserId === id) return s;

            for (const [key, mappedId] of Object.entries(s.accounts || {})) {
              if (mappedId === id) s.accounts[key] = targetUserId;
            }
            if (s.userProfiles[id]?.googleEmail) {
              s.accounts[`google:${s.userProfiles[id].googleEmail}`] = targetUserId;
              s.userProfiles[targetUserId].googleEmail = s.userProfiles[id].googleEmail;
            }
            if (s.userProfiles[id]?.tgUsername) {
              s.userProfiles[targetUserId].tgUsername = s.userProfiles[id].tgUsername;
            }
            for (const ses of Object.values(s.sessions || {})) {
              if (ses.userId === id) ses.userId = targetUserId;
            }
            const currentFriends = s.friends[id] || [];
            s.friends[targetUserId] = Array.from(new Set([...(s.friends[targetUserId] || []), ...currentFriends]));
            delete s.linkCodes[inputCode];
            return s;
          });

          if (targetUserId && targetUserId !== id) {
            const currentData = await readProfile(id);
            if (currentData.expenses.length > 0) {
              await transaction(targetUserId, targetProfile => {
                const existingIds = new Set(targetProfile.expenses.map(e => e.id));
                for (const exp of currentData.expenses) {
                  if (!existingIds.has(exp.id)) targetProfile.expenses.push(exp);
                }
                return targetProfile;
              });
            }
          }

          const effectiveLedger = getEffectiveLedgerId(targetUserId || id, updatedShares);
          const finalProfile = await readProfile(effectiveLedger);
          send(res, 200, { ok: true, profile: visible(finalProfile, targetUserId || id, updatedShares) });
          return;
        }

        if (url.pathname === '/api/profile' && req.method === 'GET') {
          const shares = await ensureUserShare(id, auth.userObj);
          const ledgerId = getEffectiveLedgerId(id, shares);
          await queues.get(ledgerId)?.catch(() => {});
          const autoLang = resolveLanguage(auth.userObj?.language_code, 'zh');
          const profile = await readProfile(ledgerId, autoLang);
          if (!profile.settings.languageManual && profile.settings.language !== autoLang) {
            profile.settings.language = autoLang;
            await transaction(ledgerId, p => { p.settings.language = autoLang; return p; });
          }
          send(res, 200, visible(profile, id, shares));
          return;
        }

        if (url.pathname === '/api/settings' && req.method === 'PUT') {
          let settings;
          try { settings = validateSettings(await bodyOf(req)); }
          catch (err) { throw err instanceof RequestError ? err : new RequestError(err.message); }
          const shares = await ensureUserShare(id, auth.userObj);
          const ledgerId = getEffectiveLedgerId(id, shares);
          send(res, 200, visible(await transaction(ledgerId, profile => {
            profile.settings = { ...settings, languageManual: true };
            return profile;
          }), id, shares));
          return;
        }

        if (url.pathname === '/api/pair' && req.method === 'POST') {
          const body = await bodyOf(req);
          const code = String(body?.code || '').trim().toUpperCase();
          if (!code || code.length !== 6) throw new RequestError('请输入有效的 6 位共享码。', 400);
          const shares = await ensureUserShare(id, auth.userObj);
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
          send(res, 200, visible(merged, id, updatedShares));
          return;
        }

        if (url.pathname === '/api/unpair' && req.method === 'POST') {
          const shares = await ensureUserShare(id, auth.userObj);
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
            send(res, 200, visible(myProfile, id, updatedShares));
            return;
          }

          const myProfile = await readProfile(id);
          send(res, 200, visible(myProfile, id, shares));
          return;
        }

        if (url.pathname === '/api/user-profile' && req.method === 'PUT') {
          const body = await bodyOf(req);
          const name = typeof body?.name === 'string' ? body.name.trim() : '';
          if (!name || Array.from(name).length > 24) throw new RequestError('角色名称需为 1–24 个字。', 400);
          const color = CONSUMER_COLORS.includes(body?.color) ? body.color : 'blue';
          const avatar = typeof body?.avatar === 'string' && body.avatar ? body.avatar : 'cat';

          const updatedShares = await mutateShares(s => {
            s.userProfiles[id] = s.userProfiles[id] || {};
            s.userProfiles[id].name = name;
            s.userProfiles[id].color = color;
            s.userProfiles[id].avatar = avatar;
            return s;
          });

          const ledgerId = getEffectiveLedgerId(id, updatedShares);
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
          send(res, 200, visible(profile, id, updatedShares));
          return;
        }

        if (url.pathname === '/api/friends/add' && req.method === 'POST') {
          const body = await bodyOf(req);
          const code = String(body?.friendCode || '').trim().toUpperCase();
          if (code.length !== 6) throw new RequestError('请输入有效的 6 位好友码。', 400);
          const shares = await ensureUserShare(id, auth.userObj);
          const friendUserId = shares.codeToUser[code];
          if (!friendUserId) throw new RequestError('未找到该好友码对应的用户。', 404);
          if (friendUserId === id) throw new RequestError('不能添加自己为好友。', 400);

          const updatedShares = await mutateShares(s => {
            s.friends = s.friends || {};
            s.friends[id] = s.friends[id] || [];
            s.friends[friendUserId] = s.friends[friendUserId] || [];
            if (!s.friends[id].includes(friendUserId)) s.friends[id].push(friendUserId);
            if (!s.friends[friendUserId].includes(id)) s.friends[friendUserId].push(id);
            return s;
          });

          const ledgerId = getEffectiveLedgerId(id, updatedShares);
          const profile = await readProfile(ledgerId);
          send(res, 200, visible(profile, id, updatedShares));
          return;
        }

        if (url.pathname === '/api/circles/create' && req.method === 'POST') {
          const body = await bodyOf(req);
          const circleName = String(body?.name || '').trim();
          if (!circleName || Array.from(circleName).length > 24) throw new RequestError('圈子名称需为 1–24 个字。', 400);
          const rawFriends = Array.isArray(body?.friendIds) ? body.friendIds : [];
          if (rawFriends.length > 3) throw new RequestError('好友圈成员最多 4 人（包含自己）。', 400);

          const shares = await ensureUserShare(id, auth.userObj);
          const myFriends = new Set(shares.friends?.[id] || []);
          const validFriendIds = [];
          for (const rawFid of rawFriends) {
            const fid = String(rawFid).replace(/^u_/, '');
            if (!myFriends.has(fid)) throw new RequestError('被邀请成员必须先成为您的好友。', 400);
            validFriendIds.push(fid);
          }

          const circleId = 'cir_' + randomUUID().slice(0, 8);
          const circleMembers = [id, ...validFriendIds];

          const updatedShares = await mutateShares(s => {
            s.circles = s.circles || {};
            s.activeCircles = s.activeCircles || {};
            s.circles[circleId] = {
              id: circleId,
              name: circleName,
              ownerId: id,
              members: circleMembers,
              ledgerId: circleId,
              createdAt: new Date().toISOString(),
            };
            s.activeCircles[id] = circleId;
            return s;
          });

          await transaction(circleId, cProfile => {
            cProfile.settings.consumers = circleMembers.map(mid => {
              const p = updatedShares.userProfiles[mid] || { name: '成员', color: 'blue', avatar: 'cat' };
              return { id: `u_${mid}`, name: p.name, color: p.color, avatar: p.avatar };
            });
            return cProfile;
          });

          const profile = await readProfile(circleId);
          send(res, 200, visible(profile, id, updatedShares));
          return;
        }

        if (url.pathname === '/api/circles/switch' && req.method === 'POST') {
          const body = await bodyOf(req);
          const targetCircleId = body?.circleId ? String(body.circleId) : null;

          const updatedShares = await mutateShares(s => {
            s.activeCircles = s.activeCircles || {};
            if (targetCircleId) {
              const c = s.circles?.[targetCircleId];
              if (!c || !c.members.includes(id)) throw new RequestError('您不是该好友圈成员。', 403);
              s.activeCircles[id] = targetCircleId;
            } else {
              delete s.activeCircles[id];
            }
            return s;
          });

          const ledgerId = getEffectiveLedgerId(id, updatedShares);
          const profile = await readProfile(ledgerId);
          send(res, 200, visible(profile, id, updatedShares));
          return;
        }

        if (url.pathname === '/api/circles/leave' && req.method === 'POST') {
          const body = await bodyOf(req);
          const circleId = String(body?.circleId || '');
          const updatedShares = await mutateShares(s => {
            const c = s.circles?.[circleId];
            if (c) {
              c.members = c.members.filter(m => m !== id);
              if (c.members.length === 0) delete s.circles[circleId];
            }
            if (s.activeCircles?.[id] === circleId) delete s.activeCircles[id];
            return s;
          });

          const ledgerId = getEffectiveLedgerId(id, updatedShares);
          const profile = await readProfile(ledgerId);
          send(res, 200, visible(profile, id, updatedShares));
          return;
        }

        if (url.pathname === '/api/expenses' && req.method === 'POST') {
          const payload = await bodyOf(req);
          const shares = await ensureUserShare(id, auth.userObj);
          const ledgerId = getEffectiveLedgerId(id, shares);

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
            profile.expenses.push(record);
            return record;
          });
          send(res, 200, entry);
          return;
        }

        const recordRoute = /^\/api\/expenses\/([a-zA-Z0-9_-]{8,64})(\/restore)?$/.exec(url.pathname);
        if (recordRoute && ((req.method === 'DELETE' && !recordRoute[2]) || (req.method === 'POST' && recordRoute[2]))) {
          const shares = await ensureUserShare(id, auth.userObj);
          const ledgerId = getEffectiveLedgerId(id, shares);
          send(res, 200, await transaction(ledgerId, profile => {
            const entry = profile.expenses.find(e => e.id === recordRoute[1]);
            if (!entry) throw new RequestError('找不到这笔记录。', 404);
            if (req.method === 'DELETE') entry.deletedAt = new Date().toISOString();
            else delete entry.deletedAt;
            return entry;
          }));
          return;
        }

        throw new RequestError('接口不存在。', 404);
      }

      if (['/health', '/healthz'].includes(url.pathname) && req.method === 'GET') { send(res, 200, { ok: true }); return; }

      const isIndex = url.pathname === '/' || url.pathname === '/index.html';
      const isPublic = ['/logo.png', '/logo.jpg', '/apple-touch-icon.png', '/apple-touch-icon-180x180.png', '/manifest.webmanifest'].includes(url.pathname);
      if (isPublic && ['GET', 'HEAD'].includes(req.method)) {
        const filePath = path.join(root, 'public', path.basename(url.pathname));
        try {
          const content = await readFile(filePath);
          const ext = path.extname(url.pathname);
          res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
          res.end(req.method === 'HEAD' ? undefined : content);
          return;
        } catch {}
      }

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
      if (!(err instanceof RequestError)) console.error('Request failed:', err.name, err.code || 'internal', err.message);
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
