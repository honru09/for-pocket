import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { validateInitData } from './auth.mjs';
import { createStore } from './store.mjs';
import { RequestError, fail, hash, ensureUser, issueSession, googleLogin, handleDomain } from './domain.mjs';
import { CURRENCIES, resolveLanguage } from './public/shared.mjs';
import { AiError, createExpenseParser, createExpenseSummarizer } from './ai.mjs';
import { summarizeExpenses } from './ai-summary.mjs';
import { createTelegramHandler } from './telegram-ai.mjs';
import { deriveTelegramWebhookSecret } from './telegram-config.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const release = { version, commit: process.env.APP_COMMIT || null, revision: process.env.K_REVISION || null };
export function createApp({ token = process.env.BOT_TOKEN || '', dataDir = path.resolve(root, process.env.DATA_DIR || 'data'), publicUrl = process.env.PUBLIC_URL || '', maxAgeSeconds = Number(process.env.AUTH_MAX_AGE_SECONDS || 86400), googleClientId = process.env.GOOGLE_CLIENT_ID || '', verifyGoogle, aiParser = createExpenseParser(), aiSummarizer = createExpenseSummarizer(), webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '', callTelegram, now = () => Date.now() } = {}) {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 60) throw new Error('Invalid AUTH_MAX_AGE_SECONDS');
  const resolvedWebhookSecret = token ? deriveTelegramWebhookSecret(token, webhookSecret) : '';
  const store = createStore(dataDir), google = new OAuth2Client(), attempts = new Map();
  const telegramHandler = createTelegramHandler({ store, token, publicUrl, now, limit, callTelegram,
    aiParser: { ...aiParser, summarize: (input, profile) => summarizeExpenses(input, profile, aiSummarizer, now()) } });
  function limit(key, max = 12) {
    const at = now(), item = attempts.get(key);
    if (item && item.until > at) { if (item.count >= max) fail('errorRateLimit', 429); item.count++; }
    else attempts.set(key, { count: 1, until: at + 60000 });
    if (attempts.size > 2000) for (const [k, v] of attempts) if (v.until <= at) attempts.delete(k);
  }
  function resolveAuth(db, req) {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    const session = bearer && db.sessions[hash(bearer)];
    const raw = req.headers['x-telegram-init-data'];
    if (raw) {
      const auth = resolveTelegram(db, raw, session, now());
      if (auth.sessionToken) req.telegramSessionToken = auth.sessionToken;
      return auth.uid;
    }
    if (!session || session.expiresAt <= now() || !db.users[session.userId]) fail('errorSignIn', 401);
    return session.userId;
  }
  function resolveTelegram(db, raw, session, at) {
    let user, fresh = true;
    try { user = validateInitData(raw, token, { maxAgeSeconds, now: at }); }
    catch (error) {
      // An expired payload is never an authentication grant. Its signature
      // can still identify which Telegram account a valid bearer belongs to;
      // this lets a refreshed page keep a matching 30-day session while
      // refusing to let that bearer override a different Telegram account.
      if (error.message !== 'Authentication expired') fail('errorAuth', 401);
      try { user = validateInitData(raw, token, { now: at, enforceFresh: false }); fresh = false; }
      catch { fail('errorAuth', 401); }
    }
    const identity = `telegram:${user.id}`;
    // v2 migrations may contain a numeric Telegram user without an explicit
    // identity index; the numeric record is still safe to match because
    // Telegram IDs are never reused as Google UUIDs.
    const knownUid = db.identities[identity] || (db.users[String(user.id)] ? String(user.id) : null);
    if (!fresh) {
      if (!session || session.expiresAt <= at || !db.users[session.userId] || !knownUid || knownUid !== session.userId) fail('errorAuth', 401);
      return { uid: session.userId };
    }
    const uid = ensureUser(db, identity, user);
    if (!db.users[uid].settings.languageManual) db.users[uid].settings.language = resolveLanguage(user.language_code || 'en');
    if (session && session.expiresAt > at && db.users[session.userId] && session.userId === uid) return { uid };
    return { uid, sessionToken: issueSession(db, uid, at) };
  }
  async function bodyOf(req, maxBytes = 32768) {
    if (!String(req.headers['content-type']).startsWith('application/json')) fail('errorJson', 415);
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > maxBytes) fail('errorTooLarge', 413); chunks.push(chunk); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('errorJson'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('errorJson');
    return body;
  }
  async function rawBody(req, maxBytes) {
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > maxBytes) fail('errorTooLarge', 413); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  function safeTokenEqual(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string' || !actual || !expected) return false;
    const a = Buffer.from(actual), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  async function aiInput(req, queryLedgerId = '') {
    const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].toLowerCase();
    const headerTimezone = String(req.headers['x-timezone'] || req.headers['x-ai-timezone'] || '').trim();
    if (contentType === 'application/json') {
      const body = await bodyOf(req, 12 * 1024 * 1024);
      const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 4000) : '';
      const timezone = String(body?.timezone || headerTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').slice(0, 80);
      const image = body?.image && typeof body.image === 'object' ? body.image : (body?.imageBase64 ? { data: body.imageBase64, mimeType: body.mimeType } : null);
      if (image) {
        if (typeof image.data !== 'string' || !/^image\/(jpeg|png|webp|gif)$/.test(String(image.mimeType || '').toLowerCase())) fail('errorAiInput', 400);
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) || image.data.length > 11 * 1024 * 1024) fail('errorAiInput', 400);
        const estimatedBytes = Math.floor(image.data.length * 3 / 4) - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0);
        if (estimatedBytes < 1 || estimatedBytes > 8 * 1024 * 1024) fail('errorTooLarge', 413);
      }
      if (!text && !image) fail('errorAiInput', 400);
      return { text, image: image ? { data: image.data, mimeType: String(image.mimeType).toLowerCase() } : null, timezone, enhanced: Boolean(image && body.enhanced === true), now: now(),
        ledgerId: typeof body?.ledgerId === 'string' ? body.ledgerId.trim() : String(queryLedgerId || '').trim(),
        telegramUserId: typeof body?.telegramUserId === 'string' || typeof body?.telegramUserId === 'number' ? String(body.telegramUserId).trim() : '' };
    }
    if (!/^image\/(jpeg|png|webp|gif)$/.test(contentType)) fail('errorAiInput', 415);
    const bytes = await rawBody(req, 8 * 1024 * 1024);
    if (!bytes.length) fail('errorAiInput', 400);
    const timezone = String(headerTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').slice(0, 80);
    return { text: '', image: { data: bytes.toString('base64'), mimeType: contentType }, timezone, now: now(), ledgerId: String(queryLedgerId || '').trim(),
      telegramUserId: String(req.headers['x-telegram-user-id'] || '').trim() };
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
      if (url.pathname === '/api/config' && req.method === 'GET') { send(res, 200, { ...release, mode: token || googleClientId ? 'remote' : 'local', googleClientId, telegramEnabled: Boolean(token), aiEnabled: Boolean(aiParser?.enabled) }); return; }
      if (url.pathname.startsWith('/api/')) {
        checkOrigin(req);
        if (url.pathname === '/api/telegram/webhook' && req.method === 'POST') {
          if (!token || !safeTokenEqual(req.headers['x-telegram-bot-api-secret-token'], resolvedWebhookSecret)) fail('errorAuth', 401);
          const update = await bodyOf(req, 65536);
          if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) fail('errorAiInput', 400);
          const handled = await telegramHandler.handle(update);
          if (handled?.retryable) { send(res, 503, { ok: false }); return; }
          send(res, 200, { ok: true }); return;
        }
        const aiRoute = url.pathname === '/api/ai/parse-expense' && req.method === 'POST';
        const telegramAiRoute = url.pathname === '/api/ai/telegram-parse' && req.method === 'POST';
        const body = aiRoute || telegramAiRoute ? null : ['POST', 'PUT'].includes(req.method) ? await bodyOf(req, url.pathname === '/api/expenses/import' ? 131072 : 32768) : {};
        if (aiRoute) {
          limit(`ai-ip:${req.socket.remoteAddress}`, 60);
          const uid = await store.run(db => resolveAuth(db, req));
          limit(`ai-user:${uid}`, 12);
          const input = await aiInput(req, url.searchParams.get('ledgerId'));
          const context = await store.run(db => {
            const profile = handleDomain(db, uid, '/profile', 'GET', {}, { now: now(), limit, ledgerQuery: null });
            if (input.ledgerId && input.ledgerId !== profile.ledgerId) fail('errorLedgerChanged', 409);
            return { profile };
          });
          const parsed = await aiParser.parse(input, context.profile.settings);
          await store.run(db => { const p = handleDomain(db, uid, '/profile', 'GET', {}, { now: now(), limit }); if (p.ledgerId !== context.profile.ledgerId) fail('errorLedgerChanged', 409); });
          const items = Array.isArray(parsed) ? parsed : parsed?.items && Array.isArray(parsed.items) ? parsed.items : [parsed];
          const response = { items, ...(req.telegramSessionToken ? { sessionToken: req.telegramSessionToken } : {}) };
          send(res, 200, response); return;
        }
        if (telegramAiRoute) {
          if (!safeTokenEqual(req.headers['x-bot-token'], token)) fail('errorAuth', 401);
          limit(`ai-bot:${req.socket.remoteAddress}`, 30);
          const input = await aiInput(req, url.searchParams.get('ledgerId'));
          const rawId = String(input.telegramUserId || '').trim();
          if (!/^\d{1,20}$/.test(rawId) || BigInt(rawId) <= 0n) fail('errorAiInput', 400);
          const context = await store.run(db => {
            const uid = ensureUser(db, `telegram:${rawId}`, { first_name: `Telegram ${rawId}`, language_code: 'en' });
            const profile = handleDomain(db, uid, '/profile', 'GET', {}, { now: now(), limit, ledgerQuery: null });
            return { uid, profile };
          });
          const parsed = await aiParser.parse(input, context.profile.settings);
          const items = Array.isArray(parsed) ? parsed : parsed?.items && Array.isArray(parsed.items) ? parsed.items : [parsed];
          send(res, 200, { userId: `u_${context.uid}`, telegramUserId: rawId, items, saved: false }); return;
        }
        if (url.pathname === '/api/ai/summary' && req.method === 'POST') {
          if (body.period !== undefined && !['week', 'month'].includes(body.period)) fail('errorAiInput');
          if (body.currency !== undefined && (typeof body.currency !== 'string' || !Object.hasOwn(CURRENCIES, body.currency))) fail('errorAiInput');
          if (body.question !== undefined && (typeof body.question !== 'string' || body.question.length > 500)) fail('errorAiInput');
          if (body.ledgerId !== undefined && typeof body.ledgerId !== 'string') fail('errorAiInput');
          if (body.timezone !== undefined) {
            if (typeof body.timezone !== 'string' || !body.timezone || body.timezone.length > 80) fail('errorAiInput');
            try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }).format(); } catch { fail('errorAiInput'); }
          }
          const context = await store.run(db => {
            const uid = resolveAuth(db, req);
            const profile = handleDomain(db, uid, '/profile', 'GET', {}, { now: now(), limit });
            if (body.ledgerId && body.ledgerId !== profile.ledgerId) fail('errorLedgerChanged', 409);
            return { uid, profile };
          });
          limit(`ai-summary:${context.uid}`, 6);
          const result = await summarizeExpenses(body, context.profile, aiSummarizer, now());
          await store.run(db => { const p = handleDomain(db, context.uid, '/profile', 'GET', {}, { now: now(), limit }); if (p.ledgerId !== context.profile.ledgerId) fail('errorLedgerChanged', 409); });
          send(res, 200, { ...result, ...(req.telegramSessionToken ? { sessionToken: req.telegramSessionToken } : {}) }); return;
        }
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
          const route = url.pathname.slice(4);
          // Logout is deliberately idempotent and does not authenticate via
          // Telegram initData, so a stale payload cannot mint a replacement
          // session while revoking the supplied bearer.
          if (route === '/auth/logout' && req.method === 'POST') {
            const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
            if (bearer) delete db.sessions[hash(bearer)];
            return { ok: true };
          }
          if (route === '/auth/telegram' && req.method === 'POST') {
            const raw = req.headers['x-telegram-init-data']; if (!raw) fail('errorAuth', 401);
            const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
            const session = bearer && db.sessions[hash(bearer)];
            const auth = resolveTelegram(db, raw, session, now());
            const profile = handleDomain(db, auth.uid, '/profile', 'GET', {}, { now: now(), limit, ledgerQuery: null });
            return { profile, ...(auth.sessionToken ? { sessionToken: auth.sessionToken } : {}) };
          }
          if (googlePayload) return googleLogin(db, { ...googlePayload, locale: resolveLanguage(body.language || googlePayload.locale || 'en') }, { link: body.link === true, uid: body.link === true ? resolveAuth(db, req) : null, now: now() });
          const uid = resolveAuth(db, req);
          return handleDomain(db, uid, route, req.method, body, { now: now(), limit, ledgerQuery: url.searchParams.get('ledgerId') });
        });
        // Return a shallow response envelope after the store commit. Never
        // mutate an object returned from store.run: domain entries can still
        // reference the committed database state.
        const response = req.telegramSessionToken && result && typeof result === 'object' && !Array.isArray(result)
          ? { ...result, sessionToken: req.telegramSessionToken }
          : result;
        send(res, 200, response); return;
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
      if (!req.complete) req.resume();
      const validation = !(error instanceof RequestError) && (['errorEntryTime', 'errorSplit'].includes(error.message) || /^(请|分类|收入分类|角色|记录|备注|时区)/.test(error.message));
      if (!res.headersSent) send(res, error.status || (validation ? 400 : 500), { error: error instanceof RequestError || error instanceof AiError || validation ? error.message : 'errorSave' }); else res.end();
      if (!(error instanceof RequestError) && !(error instanceof AiError) && !validation) console.error('Request failed:', error.name, error.code || 'internal');
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787), host = process.env.HOST || (process.env.RENDER || process.env.K_SERVICE || process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  const app = createApp(); app.listen(port, host, () => console.log(`for. ready at http://${host}:${port}`));
  process.on('SIGINT', () => app.close(() => process.exit(0)));
  process.on('SIGTERM', () => app.close(() => process.exit(0)));
}
