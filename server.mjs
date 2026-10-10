import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { validateInitData } from './auth.mjs';
import { createStore } from './store.mjs';
import { RequestError, fail, hash, ensureUser, googleLogin, handleDomain } from './domain.mjs';
import { resolveLanguage } from './public/shared.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const release = { version, commit: process.env.RENDER_GIT_COMMIT || process.env.APP_COMMIT || null };
export function createApp({ token = process.env.BOT_TOKEN || '', dataDir = path.resolve(root, process.env.DATA_DIR || 'data'), publicUrl = process.env.PUBLIC_URL || '', maxAgeSeconds = Number(process.env.AUTH_MAX_AGE_SECONDS || 86400), googleClientId = process.env.GOOGLE_CLIENT_ID || '', verifyGoogle, now = () => Date.now() } = {}) {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 60) throw new Error('Invalid AUTH_MAX_AGE_SECONDS');
  const store = createStore(dataDir), google = new OAuth2Client(), attempts = new Map();
  function limit(key, max = 12) {
    const at = now(), item = attempts.get(key);
    if (item && item.until > at) { if (item.count >= max) fail('errorRateLimit', 429); item.count++; }
    else attempts.set(key, { count: 1, until: at + 60000 });
    if (attempts.size > 2000) for (const [k, v] of attempts) if (v.until <= at) attempts.delete(k);
  }
  function resolveAuth(db, req) {
    const raw = req.headers['x-telegram-init-data'];
    if (raw) {
      let user; try { user = validateInitData(raw, token, { maxAgeSeconds, now: now() }); } catch { fail('errorAuth', 401); }
      const uid = ensureUser(db, `telegram:${user.id}`, user);
      if (!db.users[uid].settings.languageManual) db.users[uid].settings.language = resolveLanguage(user.language_code || 'en');
      return uid;
    }
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1], session = bearer && db.sessions[hash(bearer)];
    if (!session || session.expiresAt <= now() || !db.users[session.userId]) fail('errorSignIn', 401);
    return session.userId;
  }
  async function bodyOf(req) {
    if (!String(req.headers['content-type']).startsWith('application/json')) fail('errorJson', 415);
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 32768) fail('errorTooLarge', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('errorJson'); }
  }
  function send(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); }
  function checkOrigin(req) {
    if (['GET', 'HEAD'].includes(req.method) || !req.headers.origin) return;
    const allowed = new Set([`http://${req.headers.host}`, `https://${req.headers.host}`, 'https://web.telegram.org']);
    if (publicUrl) allowed.add(new URL(publicUrl).origin);
    if (req.headers.origin === 'null' && req.headers['x-telegram-init-data']) return;
    if (!allowed.has(req.headers.origin)) fail('errorOrigin', 403);
  }
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/config' && req.method === 'GET') { send(res, 200, { ...release, mode: token || googleClientId ? 'remote' : 'local', googleClientId, telegramEnabled: Boolean(token) }); return; }
      if (url.pathname.startsWith('/api/')) {
        checkOrigin(req);
        const body = ['POST', 'PUT'].includes(req.method) ? await bodyOf(req) : {};
        let googlePayload;
        if (url.pathname === '/api/auth/google' && req.method === 'POST') {
          limit(`google:${req.socket.remoteAddress}`, 30);
          if (!googleClientId || typeof body.credential !== 'string') fail('errorGoogleUnavailable', 401);
          try {
            googlePayload = verifyGoogle ? await verifyGoogle(body.credential, googleClientId) : (await google.verifyIdToken({ idToken: body.credential, audience: googleClientId })).getPayload();
            if (typeof googlePayload?.sub !== 'string' || !googlePayload.sub || googlePayload.sub.length > 255 || googlePayload.aud !== googleClientId || !['accounts.google.com', 'https://accounts.google.com'].includes(googlePayload.iss) || !Number.isFinite(googlePayload.exp) || googlePayload.exp * 1000 <= now()) throw new Error('Invalid claims');
          } catch { fail('errorGoogleCredential', 401); }
        }
        const result = await store.run(db => {
          if (googlePayload) return googleLogin(db, { ...googlePayload, locale: resolveLanguage(body.language || googlePayload.locale || 'en') }, { link: body.link === true, uid: body.link === true ? resolveAuth(db, req) : null, now: now() });
          const uid = resolveAuth(db, req), route = url.pathname.slice(4);
          if (route === '/auth/logout' && req.method === 'POST') { const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]; if (bearer) delete db.sessions[hash(bearer)]; return { ok: true }; }
          return handleDomain(db, uid, route, req.method, body, { now: now(), limit, ledgerQuery: url.searchParams.get('ledgerId') });
        });
        send(res, 200, result); return;
      }
      if (['/health', '/healthz'].includes(url.pathname)) { send(res, 200, { ok: true, ...release }); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
      const isIndex = ['/', '/index.html'].includes(url.pathname), asset = /^\/assets\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname)?.[1];
      const publicName = ['/logo.png', '/logo.jpg', '/apple-touch-icon.png', '/apple-touch-icon-180x180.png', '/manifest.webmanifest'].includes(url.pathname) && path.basename(url.pathname);
      if (['GET', 'HEAD'].includes(req.method) && (isIndex || asset || publicName)) {
        const file = isIndex ? path.join(root, 'dist/index.html') : asset ? path.join(root, 'dist/assets', asset) : path.join(root, 'public', publicName);
        let content; try { content = await readFile(file); } catch (error) { if (error.code === 'ENOENT') fail('errorNotFound', 404); throw error; }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': asset ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
        res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      fail('errorNotFound', 404);
    } catch (error) {
      const validation = !(error instanceof RequestError) && (error.message === 'errorEntryTime' || /^(请|分类|收入分类|角色|记录|备注|时区)/.test(error.message));
      if (!res.headersSent) send(res, error.status || (validation ? 400 : 500), { error: error instanceof RequestError || validation ? error.message : 'errorSave' }); else res.end();
      if (!(error instanceof RequestError) && !validation) console.error('Request failed:', error.name, error.code || 'internal');
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787), host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  const app = createApp(); app.listen(port, host, () => console.log(`for. ready at http://${host}:${port}`));
  process.on('SIGINT', () => app.close(() => process.exit(0)));
  process.on('SIGTERM', () => app.close(() => process.exit(0)));
}
