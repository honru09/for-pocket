import http from 'node:http';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_TEXT, IMPORT_MIME_TYPES, IMAGE_MIME_TYPES, extractImportText } from './import-files.mjs';
import { OAuth2Client } from 'google-auth-library';
import { validateInitData } from './auth.mjs';
import { createStore } from './store.mjs';
import { createLocationResolver } from './location.mjs';
import { normalizeLocation, currencyForCountry } from './public/location.mjs';
import { updateCirclePresence } from './circle-presence.mjs';
import { RequestError, fail, hash, ensureUser, issueSession, googleLogin, handleDomain } from './domain.mjs';
import { CURRENCIES, MAX_CUSTOM_AVATAR_LENGTH, resolveLanguage } from './public/shared.mjs';
import { AiError, createExpenseParser, createExpenseSummarizer, createExpenseChat } from './ai.mjs';
import { summarizeExpenses } from './ai-summary.mjs';
import { createTelegramHandler } from './telegram-ai.mjs';
import { deriveTelegramWebhookSecret, ensureTelegramWebhook } from './telegram-config.mjs';
import { createDigestService } from './digest.mjs';
import { createTelegramExpenseSync } from './telegram-expense-sync.mjs';
import { createMissingEntryReminderService } from './missing-entry-reminder.mjs';
import { createReactionNotificationService, createCloudTasksReactionQueue } from './reaction-notifications.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const release = { version, commit: process.env.APP_COMMIT || null, revision: process.env.K_REVISION || null };

function decodeBase64File(data, mimeType) {
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) fail('errorAiInput', 400);
  const estimatedBytes = Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (estimatedBytes < 1 || estimatedBytes > MAX_IMPORT_FILE_BYTES) fail('errorTooLarge', 413);
  return { data, mimeType, bytes: Buffer.from(data, 'base64') };
}

export function createApp({ token = process.env.BOT_TOKEN || '', dataDir = path.resolve(root, process.env.DATA_DIR || 'data'), publicUrl = process.env.PUBLIC_URL || '', maxAgeSeconds = Number(process.env.AUTH_MAX_AGE_SECONDS || 86400), googleClientId = process.env.GOOGLE_CLIENT_ID || '', verifyGoogle, resolveLocation, aiParser = createExpenseParser(), aiSummarizer = createExpenseSummarizer(), aiChat = createExpenseChat(), webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '', cronSecret = process.env.CRON_SECRET || '', callTelegram, now = () => Date.now(), asyncPersist = process.env.STORE_ASYNC_PERSIST === 'true' || !process.env.K_SERVICE, storeOptions, enqueueReactionTask, reactionOptions } = {}) {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 60) throw new Error('Invalid AUTH_MAX_AGE_SECONDS');
  const resolvedWebhookSecret = token ? deriveTelegramWebhookSecret(token, webhookSecret) : '';
  const store = createStore(dataDir, storeOptions), google = new OAuth2Client(), attempts = new Map();
  const ratesCache = new Map();
  // Scheduler authentication is intentionally independent from the Telegram
  // webhook secret. If CRON_SECRET is omitted, generate a per-process secret;
  // production deployments should set the env var so Scheduler can retain it
  // across Cloud Run revisions.
  const resolvedCronSecret = typeof cronSecret === 'string' && cronSecret ? cronSecret : randomBytes(32).toString('hex');
  const locationResolver = resolveLocation || createLocationResolver({ publicUrl });
  const expenseSync = createTelegramExpenseSync({ store, token, callTelegram, now });
  const telegramHandler = createTelegramHandler({ store, token, publicUrl, now, limit, callTelegram, resolveLocation: locationResolver,
    beforeDeliver: asyncPersist ? undefined : () => store.flush(),
    expenseSync,
    aiParser: { ...aiParser, summarize: (input, profile) => summarizeExpenses(input, profile, aiSummarizer, now()),
      chat: aiParser.chat || ((input, profile) => aiChat.chat({ ...input, profile })),
      classifyIntent: aiParser.classifyIntent || (aiChat.enabled ? input => aiChat.classifyIntent(input) : undefined) } });
  const digestService = createDigestService({ store, summarizer: aiSummarizer, token, callTelegram, now });
  const missingEntryReminders = createMissingEntryReminderService({ store, token, callTelegram, now });
  const reactionNotifications = createReactionNotificationService({ store, token, callTelegram, now,
    enqueueTask:enqueueReactionTask === undefined ? createCloudTasksReactionQueue({ publicUrl, cronSecret }) : enqueueReactionTask,
    ...reactionOptions });
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
      const originalText = typeof body?.text === 'string' ? body.text.trim() : '';
      const text = originalText.slice(0, MAX_IMPORT_TEXT);
      const timezone = String(body?.timezone || headerTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').slice(0, 80);
      const legacy = body?.image && typeof body.image === 'object' ? body.image : (body?.imageBase64 ? { data: body.imageBase64, mimeType: body.mimeType } : null);
      const file = body?.file && typeof body.file === 'object' ? body.file : legacy;
      let normalizedFile = null;
      if (file) {
        const mimeType = String(file.mimeType || '').toLowerCase();
        if (!IMPORT_MIME_TYPES.has(mimeType)) fail('errorFileType', 415);
        const decoded = decodeBase64File(file.data, mimeType);
        const extracted = IMAGE_MIME_TYPES.has(mimeType) || mimeType === 'application/pdf' ? { text: '', truncated: false } : await extractImportText(decoded.bytes, mimeType);
        const name = typeof file.name === 'string' ? file.name.slice(0, 160) : '';
        normalizedFile = { data: decoded.data, mimeType, ...(name ? { name } : {}) };
        if (extracted.text) {
          const source = [text, extracted.text].filter(Boolean).join('\n\n');
          const combined = source.slice(0, MAX_IMPORT_TEXT);
          return { text: combined, file: null, image: null, timezone, enhanced: false, now: now(),
            ledgerId: typeof body?.ledgerId === 'string' ? body.ledgerId.trim() : String(queryLedgerId || '').trim(),
            textTruncated: originalText.length > MAX_IMPORT_TEXT || extracted.truncated || source.length > MAX_IMPORT_TEXT,
            telegramUserId: typeof body?.telegramUserId === 'string' || typeof body?.telegramUserId === 'number' ? String(body.telegramUserId).trim() : '' };
        }
      }
      if (!text && !normalizedFile) fail('errorAiInput', 400);
      return { text, file: normalizedFile, image: normalizedFile && IMAGE_MIME_TYPES.has(normalizedFile.mimeType) ? normalizedFile : null, timezone, enhanced: Boolean(normalizedFile && body.enhanced === true), now: now(), textTruncated: originalText.length > MAX_IMPORT_TEXT,
        ...(!normalizedFile ? { locationContext: normalizeLocation(body.locationContext), currency: body.currency, categoryId: body.categoryId, type: body.type } : {}),
        ledgerId: typeof body?.ledgerId === 'string' ? body.ledgerId.trim() : String(queryLedgerId || '').trim(),
        telegramUserId: typeof body?.telegramUserId === 'string' || typeof body?.telegramUserId === 'number' ? String(body.telegramUserId).trim() : '' };
    }
    if (!IMPORT_MIME_TYPES.has(contentType)) fail('errorFileType', 415);
    const bytes = await rawBody(req, MAX_IMPORT_FILE_BYTES);
    if (!bytes.length) fail('errorAiInput', 400);
    const timezone = String(headerTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').slice(0, 80);
    const file = { data: bytes.toString('base64'), mimeType: contentType };
    const extracted = IMAGE_MIME_TYPES.has(contentType) || contentType === 'application/pdf' ? { text: '', truncated: false } : await extractImportText(bytes, contentType);
    return { text: extracted.text, file: extracted.text ? null : file, image: extracted.text || !IMAGE_MIME_TYPES.has(contentType) ? null : file, timezone, now: now(), textTruncated: extracted.truncated, ledgerId: String(queryLedgerId || '').trim(),
      telegramUserId: String(req.headers['x-telegram-user-id'] || '').trim() };
  }
  async function send(res, status, data) {
    // Request-based Cloud Run CPU can pause after the response. Unless the
    // operator explicitly enables background persistence, finish writes before
    // acknowledging success there. Local requests keep the debounced fast path.
    if (!asyncPersist && status < 400) await store.flush();
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
  }
  function checkOrigin(req) {
    if (['GET', 'HEAD'].includes(req.method) || !req.headers.origin) return;
    const allowed = new Set([`http://${req.headers.host}`, `https://${req.headers.host}`, 'https://web.telegram.org']);
    if (publicUrl) allowed.add(new URL(publicUrl).origin);
    if (req.headers.origin === 'null' && req.headers['x-telegram-init-data']) return;
    if (!allowed.has(req.headers.origin)) fail('errorOrigin', 403);
  }
  const app = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/config' && req.method === 'GET') { await send(res, 200, { ...release, mode: token || googleClientId ? 'remote' : 'local', googleClientId, telegramEnabled: Boolean(token), aiEnabled: Boolean(aiParser?.enabled || aiChat?.enabled || aiSummarizer?.enabled) }); return; }
      if (url.pathname === '/api/rates' && req.method === 'GET') {
        const base = String(url.searchParams.get('base') || 'JPY').toUpperCase();
        const symbols = [...new Set(String(url.searchParams.get('symbols') || 'JPY').split(',').map(item => item.trim().toUpperCase()).filter(item => Object.hasOwn(CURRENCIES, item)))].slice(0, 8);
        if (!Object.hasOwn(CURRENCIES, base) || !symbols.length) fail('errorAiInput', 400);
        const key = `${base}:${symbols.join(',')}`, cached = ratesCache.get(key);
        if (cached && cached.expiresAt > now()) { await send(res, 200, cached.value); return; }
        try {
          const response = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(symbols.join(','))}`, { signal: AbortSignal.timeout(4500) });
          if (!response.ok) throw new Error('rate upstream');
          const data = await response.json();
          const value = { base, rates: { [base]: 1, ...(data.rates || {}) }, date: data.date || new Date(now()).toISOString().slice(0, 10) };
          ratesCache.set(key, { value, expiresAt: now() + 3600000 });
          await send(res, 200, value); return;
        } catch { fail('errorNetwork', 503); }
      }
      if (url.pathname.startsWith('/api/')) {
        checkOrigin(req);
        if (['/api/telegram/webhook', '/api/telegram-webhook'].includes(url.pathname) && req.method === 'POST') {
          if (!token || !safeTokenEqual(req.headers['x-telegram-bot-api-secret-token'], resolvedWebhookSecret)) fail('errorAuth', 401);
          const update = await bodyOf(req, 65536);
          if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) fail('errorAiInput', 400);
          const handled = await telegramHandler.handle(update);
          if (handled?.retryable) { await send(res, 503, { ok: false }); return; }
          await send(res, 200, { ok: true }); return;
        }
        const cronDigestRoute = url.pathname === '/api/cron/digest' && req.method === 'POST';
        const cronTickRoute = url.pathname === '/api/cron/tick' && req.method === 'POST';
        const reactionDeliveryRoute = url.pathname === '/api/cron/reactions' && req.method === 'POST';
        if (cronDigestRoute || cronTickRoute || reactionDeliveryRoute) {
          if (!safeTokenEqual(req.headers['x-cron-secret'], resolvedCronSecret)) fail('errorAuth', 401);
          const cronBody = await bodyOf(req, 32768);
          if (reactionDeliveryRoute) {
            if (typeof cronBody.circleId !== 'string' || typeof cronBody.burstId !== 'string' || cronBody.circleId.length > 80 || cronBody.burstId.length > 80) fail('errorReaction',400);
            const result=await reactionNotifications.deliver({circleId:cronBody.circleId,burstId:cronBody.burstId,scheduledFor:cronBody.scheduledFor,at:now()});
            await store.flush();
            await send(res,result.failed ? 503 : 200,result); return;
          }
          if (cronDigestRoute) {
            if (typeof cronBody.slot !== 'string' || !['morning', 'noon', 'evening'].includes(cronBody.slot)) fail('errorAiInput', 400);
            const ledgerId = cronBody.ledgerId === undefined ? '' : String(cronBody.ledgerId || '').trim();
            const result = await digestService.processSlot(cronBody.slot, { ledgerId, at: now() });
            const status = result.results?.some(item => item?.deliveryFailed) ? 503 : 200;
            if (status >= 500) await store.flush();
            await send(res, status, result); return;
          }
          const at=now();
          const result = await digestService.tick({ at });
          result.reminders = await missingEntryReminders.tick({ at });
          result.reactions = await reactionNotifications.tick({ at });
          const status = result.reminders.failed || result.reactions.failed || result.results?.some(batch => batch?.results?.some(item => item?.deliveryFailed)) ? 503 : 200;
          if (status >= 500) await store.flush();
          await send(res, status, result); return;
        }
        const aiRoute = url.pathname === '/api/ai/parse-expense' && req.method === 'POST';
        const telegramAiRoute = url.pathname === '/api/ai/telegram-parse' && req.method === 'POST';
        const body = aiRoute || telegramAiRoute ? null : ['POST', 'PUT', 'PATCH'].includes(req.method)
          ? await bodyOf(req, url.pathname === '/api/expenses/import' ? 131072 : url.pathname === '/api/user-profile' ? MAX_CUSTOM_AVATAR_LENGTH + 8192 : 32768)
          : {};
        if (url.pathname === '/api/location/reverse' && req.method === 'POST') {
          limit(`location-ip:${req.socket.remoteAddress}`, 30);
          const context = token || googleClientId ? await store.run(db => {
            const uid = resolveAuth(db, req);
            const profile = handleDomain(db, uid, '/profile', 'GET', {}, { now: now(), limit });
            if (body.ledgerId && body.ledgerId !== profile.ledgerId) fail('errorLedgerChanged', 409);
            return { uid, ledgerId: profile.ledgerId, language: profile.settings.language };
          }) : { language: resolveLanguage(body.language) };
          if (context.uid) limit(`location-user:${context.uid}`, 12);
          const input = normalizeLocation(body.location);
          let location = input;
          if (input?.lat !== undefined) {
            try { location = normalizeLocation(await locationResolver({ ...input, accuracy: body.location?.accuracy }, { language: context.language })) || input; } catch {}
          }
          if (context.uid) await store.run(db => {
            const profile = handleDomain(db, context.uid, '/profile', 'GET', {}, { now: now(), limit });
            if (profile.ledgerId !== context.ledgerId) fail('errorLedgerChanged', 409);
            updateCirclePresence(db,context.uid,context.ledgerId,location,now());
          });
          await send(res, 200, { location: location || null, suggestedCurrency: currencyForCountry(location?.countryCode) || null });
          return;
        }
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
          const response = { items, ...(input.textTruncated ? { warnings: ['errorTextTooLong'] } : {}), ...(req.telegramSessionToken ? { sessionToken: req.telegramSessionToken } : {}) };
          await send(res, 200, response); return;
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
          await send(res, 200, { userId: `u_${context.uid}`, telegramUserId: rawId, items, saved: false }); return;
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
            // The visible ledger intentionally mirrors records across the
            // account's connected personal/circle files. Reports keep their
            // explicit ledger scope so a recap cannot accidentally mix a
            // different circle's private context into its prompt.
            const scoped = { ...profile, expenses: profile.expenses.filter(entry => !entry.ledgerId || entry.ledgerId === profile.ledgerId) };
            return { uid, profile: scoped };
          });
          limit(`ai-summary:${context.uid}`, 6);
          const result = await summarizeExpenses(body, context.profile, aiSummarizer, now());
          await store.run(db => { const p = handleDomain(db, context.uid, '/profile', 'GET', {}, { now: now(), limit }); if (p.ledgerId !== context.profile.ledgerId) fail('errorLedgerChanged', 409); });
          await send(res, 200, { ...result, ...(req.telegramSessionToken ? { sessionToken: req.telegramSessionToken } : {}) }); return;
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
        const route = url.pathname.slice(4);
        const result = await store.run(db => {
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
        // Telegram companion notifications are best-effort and never change
        // the web request result. References are kept in the server store so
        // later edits/deletes can update or remove the original message.
        if (route === '/circles/reactions' && req.method === 'POST') {
          await reactionNotifications.afterReaction(result);
        } else if (['/expenses', '/expenses/import'].includes(route) && req.method === 'POST') {
          const entries = Array.isArray(result?.entries) ? result.entries : [result];
          for (const entry of entries) { try { await expenseSync.notify(entry); } catch {} }
        } else if (/^\/expenses\/[a-zA-Z0-9_-]{8,64}$/.test(route) && ['PUT','PATCH'].includes(req.method)) {
          try { await expenseSync.sync(result, 'edit'); } catch {}
        } else if (/^\/expenses\/[a-zA-Z0-9_-]{8,64}$/.test(route) && req.method === 'DELETE') {
          try { await expenseSync.sync(result, 'delete'); } catch {}
        } else if (/^\/expenses\/[a-zA-Z0-9_-]{8,64}\/restore$/.test(route) && req.method === 'POST') {
          try { await expenseSync.notify(result); } catch {}
        }
        // Return a shallow response envelope after the store commit. Never
        // mutate an object returned from store.run: domain entries can still
        // reference the committed database state.
        const response = req.telegramSessionToken && result && typeof result === 'object' && !Array.isArray(result)
          ? { ...result, sessionToken: req.telegramSessionToken }
          : result;
        await send(res, 200, response); return;
      }
      if (['/health', '/healthz'].includes(url.pathname)) { await send(res, 200, { ok: true, ...release }); return; }
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
      const validation = !(error instanceof RequestError) && (['errorEntryTime', 'errorSplit', 'errorFileRead'].includes(error.message) || /^(请|分类|收入分类|角色|记录|备注|时区)/.test(error.message));
      if (!res.headersSent) await send(res, error.status || (validation ? 400 : 500), { error: error instanceof RequestError || error instanceof AiError || validation ? error.message : 'errorSave' }); else res.end();
      if (!(error instanceof RequestError) && !(error instanceof AiError) && !validation) console.error('Request failed:', error.name, error.code || 'internal');
    }
  });
  // Stop accepting requests and wait for every active response before flushing:
  // an in-flight login, model parse or webhook can still mutate the store.
  const closeServer = app.close.bind(app);
  app.on('listening', () => { void reactionNotifications.start().catch(() => {}); });
  let closing;
  app.close = callback => {
    if (!closing) {
      closing = new Promise((resolve, reject) => closeServer(error => error ? reject(error) : resolve()))
        .then(() => reactionNotifications.close()).then(() => store.close()).catch(error => {
        try { console.error('Store flush failed during shutdown:', error); } catch {}
        throw error;
      });
    }
    void closing.then(() => callback?.(), error => callback?.(error));
    return app;
  };
  app.flushStore = () => store.flush();
  // Exposed only on the in-process server object for tests and local
  // scheduler setup; it is never returned by an HTTP route.
  app.cronSecret = resolvedCronSecret;
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787), host = process.env.HOST || (process.env.RENDER || process.env.K_SERVICE || process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  const app = createApp(); app.listen(port, host, () => console.log(`for. ready at http://${host}:${port}`));
  if (process.env.BOT_TOKEN && process.env.PUBLIC_URL) {
    ensureTelegramWebhook({ token: process.env.BOT_TOKEN, publicUrl: process.env.PUBLIC_URL, webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
      webhookPath: '/api/telegram-webhook', legacyPaths: ['/api/telegram/webhook'] })
      .then(result => console.log(`Telegram webhook ${result.status}.`))
      .catch(error => console.error(`Telegram webhook setup skipped: ${error.message}`));
  }
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    app.close(error => process.exit(error ? 1 : 0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
