import { randomUUID } from 'node:crypto';
import {
  CURRENCIES,
  DEFAULT_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  resolveLanguage,
  validateExpense,
} from './public/shared.mjs';
import { ensureUser, handleDomain, RequestError, visible } from './domain.mjs';
import { botLanguage, botText } from './bot-i18n.mjs';
import { categoryLabel } from './public/i18n.mjs';
import { extractImportText } from './import-files.mjs';
import { normalizeLocation, currencyForCountry, locationLabel } from './public/location.mjs';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_FILE_BYTES = MAX_IMAGE_BYTES;
const MAX_AUDIO_BYTES = MAX_IMPORT_FILE_BYTES;
const MAX_AUDIO_SECONDS = 60;
const MAX_IMPORT_TEXT = 12000;
const MAX_TEXT = MAX_IMPORT_TEXT;
const DRAFT_TTL = 15 * 60 * 1000;
const LOCATION_TTL = 10 * 60 * 1000;
const LOCATION_RESOLVE_TIMEOUT = 2500;
const UPDATE_TTL = 24 * 60 * 60 * 1000;
const UPDATE_LEASE = 3 * 60 * 1000;
const MAX_RETRY_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_ITEMS = 50;
const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Tokyo';
const TELEGRAM_ID = /^\d{1,20}$/;
const DEFAULT_AUTO_CONFIRM = /^(1|true|yes|on)$/i.test(String(process.env.TELEGRAM_AI_AUTO_CONFIRM || ''));
class DeliveryBlockedError extends Error {
  constructor(cause) { super('Telegram delivery blocked by persistence failure', { cause }); }
}

const atMillis = value => {
  const result = typeof value === 'function' ? value() : value;
  if (result instanceof Date) return result.getTime();
  const numeric = Number(result);
  return Number.isFinite(numeric) ? numeric : Date.now();
};

function messageAnchor(message, fallback) {
  // Telegram dates are Unix seconds. Use the sending day for relative speech
  // even when webhook delivery or a download crosses midnight. Draft leases
  // and persistence timestamps continue to use the processing clock.
  const seconds = message?.date;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return fallback;
  const timestamp = seconds * 1000;
  const date = new Date(timestamp);
  if (!Number.isSafeInteger(timestamp) || !Number.isFinite(date.getTime())
    || date.getUTCFullYear() < 1970 || date.getUTCFullYear() > 2100) return fallback;
  return timestamp;
}

function validTimezone(value, fallback = DEFAULT_TIMEZONE) {
  for (const candidate of [value, fallback, 'UTC']) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      new Intl.DateTimeFormat('en', { timeZone: candidate }).format();
      return candidate.trim().slice(0, 80);
    } catch {}
  }
  return 'UTC';
}

function amountText(amountMinor, currency) {
  const item = CURRENCIES[currency] || CURRENCIES.JPY;
  const digits = item.digits;
  const value = Number(amountMinor) / (10 ** digits);
  return `${item.symbol}${value.toFixed(digits)}`;
}

function safeString(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeOccurredAt(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1970 || date.getUTCFullYear() > 2100) return null;
  return date.toISOString();
}

function amountMinorFromItem(item, currency) {
  const digits = CURRENCIES[currency]?.digits ?? 0;
  const maximum = 10 ** (8 + digits) - 1;
  const known = Number(item?.amountMinor);
  if (Number.isSafeInteger(known) && known > 0 && known <= maximum) return known;
  const amount = Number(item?.amount);
  const minor = Math.round(amount * (10 ** digits));
  return Number.isSafeInteger(minor) && minor > 0 && minor <= maximum ? minor : 0;
}

function normaliseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  return raw && typeof raw === 'object' ? [raw] : [];
}

function firstText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_TEXT);
}

function contentLanguage(value, fallback = 'zh') {
  const text = String(value || '').replace(/^\/[a-z]+(?:@[^\s]+)?\s*/i, '');
  if (/[\u0400-\u04ff]/u.test(text)) return 'uk';
  if (/[\u3400-\u9fff]/u.test(text)) return 'zh';
  if (/[a-z]/i.test(text)) return 'en';
  return botLanguage(fallback);
}

function locationAmount(value, currency) {
  let text = String(value || '').normalize('NFKC').trim();
  if (!/^[\d.,\s]+$/u.test(text) || !/\d/u.test(text) || text.length > 32) return null;
  // Accept common thousands separators and a decimal comma without treating
  // "850,50" as 85,050. Ambiguous/malformed amounts stay editable by the user.
  if (/\s/u.test(text)) {
    if (!/^\d{1,3}(?:\s\d{3})+(?:[.,]\d{1,2})?$/u.test(text)) return null;
    text = text.replace(/\s/gu, '');
  }
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(text)) text = text.replace(/,/g, '');
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d+(?:,\d{1,2})?$/.test(text)) text = text.replace(',', '.');
  else if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const digits = CURRENCIES[currency]?.digits ?? 0;
  const fraction = text.split('.')[1] || '';
  if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) return null;
  const amount = Number(text), amountMinor = Math.round(amount * 10 ** digits);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > 10 ** (8 + digits) - 1) return null;
  return { text: String(amount), amountMinor, currency };
}

function locationFromMessage(message) {
  const venue = message?.venue;
  const coordinates = venue?.location || message?.location;
  if (!coordinates || typeof coordinates.latitude !== 'number' || typeof coordinates.longitude !== 'number'
    || !Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude)
    || Math.abs(coordinates.latitude) > 90 || Math.abs(coordinates.longitude) > 180) return null;
  return normalizeLocation({ lat: coordinates.latitude, lng: coordinates.longitude,
    ...(venue ? { name: venue.title, address: venue.address } : {}) });
}

function parsedLanguage(parsed, fallback) {
  const candidate = parsed?.detectedLanguage || normaliseItems(parsed).find(item => item?.detectedLanguage)?.detectedLanguage;
  return ['zh', 'en', 'uk'].includes(candidate) ? candidate : fallback;
}

const IMPORT_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/csv', 'text/plain',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/aac', 'audio/flac',
]);
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const AUDIO_MIME_TYPES = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/aac', 'audio/flac']);
const EXTENSION_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function importMime(document) {
  const mime = String(document?.mime_type || '').toLowerCase().split(';', 1)[0];
  if (IMPORT_MIME_TYPES.has(mime)) return mime;
  // Do not trust a filename extension when Telegram supplied a conflicting
  // MIME type (for example SVG content renamed to .png).
  if (mime) return '';
  const name = String(document?.file_name || '').toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return EXTENSION_MIME[extension] || '';
}

function importKind(mime) {
  if (IMAGE_MIME_TYPES.has(mime)) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/csv' || mime === 'text/plain') return 'text';
  if (AUDIO_MIME_TYPES.has(mime)) return 'audio';
  if (mime.includes('spreadsheet') || mime === 'application/vnd.ms-excel') return 'spreadsheet';
  if (mime.includes('word')) return 'word';
  return '';
}

function audioFromMessage(message) {
  const source = message?.voice || message?.audio;
  if (!source?.file_id) return null;
  const mimeType = String(source.mime_type || (message.voice ? 'audio/ogg' : '')).toLowerCase().split(';', 1)[0];
  if (!AUDIO_MIME_TYPES.has(mimeType)) return { fileId: source.file_id, mimeType: '', fileSize: Number(source.file_size) || 0, duration: Number(source.duration) || 0, name: '', kind: '' };
  return {
    fileId: source.file_id,
    mimeType,
    fileSize: Number(source.file_size) || 0,
    duration: Number(source.duration) || 0,
    name: safeString(source.file_name, 160) || (message.voice ? 'telegram-voice.ogg' : 'telegram-audio'),
    kind: 'audio',
  };
}

function escapeTelegramText(value) {
  // Preview messages use plain text. Strip controls that can make a Telegram
  // client render an unexpectedly large or visually noisy message.
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitTelegramText(text, maximum = 3800) {
  const pages = [];
  let page = '';
  for (const line of String(text).split('\n')) {
    let remaining = line;
    if (page && page.length + remaining.length + 1 > maximum) { pages.push(page); page = ''; }
    while (remaining.length > maximum) {
      let end = maximum;
      if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
      pages.push(remaining.slice(0, end)); remaining = remaining.slice(end);
    }
    page += (page ? '\n' : '') + remaining;
  }
  if (page) pages.push(page);
  return pages;
}

function getTelegramId(user) {
  const value = String(user?.id ?? '').trim();
  return TELEGRAM_ID.test(value) && BigInt(value) > 0n ? value : null;
}

function userInfo(user) {
  return {
    first_name: safeString(user?.first_name, 24),
    last_name: safeString(user?.last_name, 24),
    username: safeString(user?.username, 64),
    language_code: safeString(user?.language_code, 16),
  };
}

function makeInternalTelegramCall(token) {
  if (!token) return null;
  return async (method, parameters = {}) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
      signal: AbortSignal.timeout(60000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(`Telegram ${method} failed`);
    return result.result;
  };
}

function chooseCategory(item, type, settings) {
  const pool = type === 'income'
    ? (settings.incomeCategories?.length ? settings.incomeCategories : DEFAULT_INCOME_CATEGORIES)
    : (settings.categories?.length ? settings.categories : DEFAULT_CATEGORIES);
  const id = safeString(item?.categoryId, 64);
  const label = safeString(item?.categoryLabel, 80).toLocaleLowerCase();
  return pool.find(category => category.id === id)
    || pool.find(category => label && String(category.label).toLocaleLowerCase() === label)
    || pool[0];
}

function defaultConsumer(profile, uid) {
  const consumers = profile?.settings?.consumers;
  return consumers?.find(member => member.id === `u_${uid}`)?.id || consumers?.[0]?.id || `u_${uid}`;
}

function ensureTelegramState(db) {
  if (!db.telegram || typeof db.telegram !== 'object') db.telegram = {};
  if (!db.telegram.updates || typeof db.telegram.updates !== 'object') db.telegram.updates = {};
  if (!db.telegram.drafts || typeof db.telegram.drafts !== 'object') db.telegram.drafts = {};
  if (!db.telegram.preferences || typeof db.telegram.preferences !== 'object') db.telegram.preferences = {};
  if (!db.telegram.locations || typeof db.telegram.locations !== 'object') db.telegram.locations = {};
  return db.telegram;
}

function pruneTelegramState(state, at, maxDrafts) {
  const updateAt = item => Number(typeof item === 'object' ? item?.at : item);
  for (const [id, item] of Object.entries(state.updates)) {
    const timestamp = updateAt(item);
    if (!Number.isFinite(timestamp) || at - timestamp > UPDATE_TTL) delete state.updates[id];
    else if (item?.locationEntry?.expiresAt <= at) delete item.locationEntry;
  }
  for (const [id, draft] of Object.entries(state.drafts)) {
    if (!draft || draft.expiresAt <= at) delete state.drafts[id];
  }
  for (const [id, location] of Object.entries(state.locations)) {
    if (!location || !Number.isFinite(location.expiresAt) || location.expiresAt <= at) delete state.locations[id];
  }
  const locations = Object.entries(state.locations);
  if (locations.length > 256) {
    locations.sort((a, b) => Number(a[1]?.createdAt || 0) - Number(b[1]?.createdAt || 0));
    for (const [id] of locations.slice(0, locations.length - 256)) delete state.locations[id];
  }
  const entries = Object.entries(state.drafts);
  if (entries.length > maxDrafts) {
    entries.sort((a, b) => Number(a[1]?.createdAt || 0) - Number(b[1]?.createdAt || 0));
    for (const [id] of entries.slice(0, entries.length - maxDrafts)) delete state.drafts[id];
  }
  const updates = Object.entries(state.updates);
  if (updates.length > 1024) {
    updates.sort((a, b) => updateAt(a[1]) - updateAt(b[1]));
    for (const [id] of updates.slice(0, updates.length - 1024)) delete state.updates[id];
  }
}

function summaryQuestion(text) {
  const value = String(text || '').toLocaleLowerCase();
  if (/\d|[¥$₴]/.test(value)) return false;
  return /(多少|汇总|[月周]报|小结|总结|谁.*(?:付|花|多)|主要.*(?:开销|在哪)|summary|how much|who.*(?:paid|spent).*more|where.*spend|скільки|підсум|хто.*більше|які.*витрат)/i.test(value);
}

function periodForText(text) {
  return /(本周|这周|上周|week|тижд)/i.test(String(text || '')) ? 'week' : 'month';
}

/**
 * Telegram update handler shared by polling and the Cloud Run webhook.
 *
 * `store` is the same transactional store used by the web server. `aiParser`
 * exposes parse(input, settings), and may optionally expose
 * summarize({ question, period, timezone }, profile). `callTelegram` is an
 * injectable `(method, parameters) => Promise<result>` used by tests and by
 * the polling entry point; when omitted, the Bot API is called with `token`.
 */
export function createTelegramHandler({
  store,
  aiParser,
  token = '',
  publicUrl = '',
  now = () => Date.now(),
  limit,
  callTelegram,
  beforeDeliver,
  downloadFile,
  resolveLocation,
  locationResolveTimeout = LOCATION_RESOLVE_TIMEOUT,
  timezone = DEFAULT_TIMEZONE,
  maxDrafts = 32,
  autoConfirm = DEFAULT_AUTO_CONFIRM,
} = {}) {
  if (!store || typeof store.run !== 'function') throw new TypeError('Telegram handler requires a store');
  const telegram = callTelegram || makeInternalTelegramCall(token);
  const botCall = async (method, parameters = {}) => {
    if (!telegram) throw new Error('Telegram is not configured');
    // This hook runs outside store.run callbacks. Safe deployments persist
    // drafts/reply checkpoints before any visible Bot API side effect.
    if (typeof beforeDeliver === 'function' && ['sendMessage', 'editMessageText', 'editMessageReplyMarkup'].includes(method)) {
      try { await beforeDeliver(method, parameters); }
      catch (error) { throw new DeliveryBlockedError(error); }
    }
    return telegram(method, parameters);
  };
  const inflight = new Map(), imageCache = new Map(), locationLookups = new Map();
  let cachedImageBytes = 0;

  function deleteCachedImage(id) {
    const item = imageCache.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    cachedImageBytes -= item.bytes;
    imageCache.delete(id);
  }

  function getCachedImage(id) {
    const item = imageCache.get(id);
    if (item?.expiresAt <= atMillis(now)) { deleteCachedImage(id); return null; }
    return item || null;
  }

  function cacheImage(context, chatId, input) {
    for (const [id] of imageCache) getCachedImage(id);
    const attachment = input.image || input.file;
    const bytes = Buffer.byteLength(attachment?.data || '', 'base64');
    while (imageCache.size && (cachedImageBytes + bytes > MAX_RETRY_CACHE_BYTES || imageCache.size >= 8)) {
      deleteCachedImage(imageCache.keys().next().value);
    }
    const id = randomUUID();
    const timer = setTimeout(() => deleteCachedImage(id), DRAFT_TTL);
    timer.unref?.();
    imageCache.set(id, { input, uid: context.uid, telegramId: context.telegramId, chatId: String(chatId), ledgerId: context.profile.ledgerId,
      expiresAt: atMillis(now) + DRAFT_TTL, bytes, timer, used: false, draftId: null });
    cachedImageBytes += bytes;
    return id;
  }

  const retryMarkup = (retryId, language) => retryId && getCachedImage(retryId)
    ? { reply_markup: { inline_keyboard: [[{ text: botText(language, 'enhance'), callback_data: `fp:retry:${retryId}` }]] } }
    : {};

  const invokeLimit = (key, max) => {
    if (typeof limit === 'function') return limit(key, max);
    return undefined;
  };

  async function acquireUpdate(updateId) {
    const key = String(updateId);
    const at = atMillis(now), lease = randomUUID();
    return store.run(db => {
      const state = ensureTelegramState(db);
      pruneTelegramState(state, at, maxDrafts);
      const previous = state.updates[key];
      if (typeof previous === 'number' || previous?.status === 'done') return { duplicate: true };
      if (previous?.status === 'processing' && previous.leaseUntil > at) return { busy: true };
      state.updates[key] = { ...previous, at: previous?.at ?? at, status: 'processing', lease, leaseUntil: at + UPDATE_LEASE };
      pruneTelegramState(state, at, maxDrafts);
      return { key, lease, action: previous?.action || null, locationEntry: previous?.locationEntry || null };
    });
  }

  async function updateOperation(operation, patch) {
    if (!operation?.key) return;
    await store.run(db => {
      const item = ensureTelegramState(db).updates[operation.key];
      if (item?.lease === operation.lease) Object.assign(item, patch);
    });
  }

  async function contextFor(user, operation) {
    const telegramId = getTelegramId(user);
    if (!telegramId) return null;
    const at = atMillis(now);
    const info = userInfo(user);
    return store.run(db => {
      const uid = ensureUser(db, `telegram:${telegramId}`, info);
      const profile = visible(db, uid);
      const fallback = resolveLanguage(user?.language_code || 'zh', 'zh');
      const preference = ensureTelegramState(db).preferences[uid];
      const mode = preference?.mode === 'auto' ? true : preference?.mode === 'manual' ? false : Boolean(autoConfirm);
      return { uid, telegramId, profile, language: botLanguage(user?.language_code || profile.settings.language, fallback), autoConfirm: mode, at, operation };
    });
  }

  async function sendMessage(chatId, text, extra = {}) {
    return botCall('sendMessage', { chat_id: chatId, text, ...extra });
  }

  async function editMessage(chatId, messageId, text, extra = {}) {
    if (chatId === undefined || messageId === undefined) return sendMessage(chatId, text, extra);
    try {
      return await botCall('editMessageText', { chat_id: chatId, message_id: messageId, text, ...extra });
    } catch (error) {
      if (error instanceof DeliveryBlockedError) throw error;
      // Editing can fail when a user presses a stale button. A small follow-up
      // keeps the ledger action visible without exposing the Bot API error.
      return sendMessage(chatId, text, extra);
    }
  }

  async function deliverReply(operation, action) {
    await updateOperation(operation, { action });
    if (action.type === 'edit') await editMessage(action.chatId, action.messageId, action.text, action.extra || {});
    else await sendMessage(action.chatId, action.text, action.extra || {});
    return action.result;
  }

  const reply = (context, chatId, key, result, extra = {}) => deliverReply(context.operation,
    { type: 'reply', chatId, text: botText(context.language, key), extra, result });

  const locationSessionKey = (context, chatId) => `${context.uid}:${String(chatId)}`;

  async function clearPendingLocation(context, chatId) {
    await store.run(db => {
      const locations = ensureTelegramState(db).locations, key = locationSessionKey(context, chatId);
      // Webhook deliveries can arrive out of order. An older unrelated
      // message must not erase the venue shared by a newer update.
      if (locations[key]?.sourceUpdate > Number(context.operation?.key)) return;
      delete locations[key];
    });
  }

  async function resolvePendingLocation(context, key, id) {
    if (locationLookups.has(id)) return locationLookups.get(id);
    const work = (async () => {
      const pending = await store.run(db => {
        const current = ensureTelegramState(db).locations[key];
        if (current?.id !== id || current.uid !== context.uid || current.telegramId !== context.telegramId
          || current.expiresAt <= atMillis(now) || visible(db, context.uid).ledgerId !== current.ledgerId) return null;
        return structuredClone(current);
      });
      if (!pending) return null;
      if (pending.status !== 'resolving') return pending.location;
      let resolved;
      if (typeof resolveLocation === 'function') {
        let timer;
        try {
          resolved = await Promise.race([
            Promise.resolve().then(() => resolveLocation({ ...pending.location,
              ...(pending.accuracy !== undefined ? { accuracy: pending.accuracy } : {}) }, { language: pending.language })),
            new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.max(1, Math.min(5000, Number(locationResolveTimeout) || LOCATION_RESOLVE_TIMEOUT))); }),
          ]);
        } catch {} finally { clearTimeout(timer); }
      }
      // Preserve the explicitly shared venue and coordinates. The lookup can
      // add its country/area, never substitute a neighboring merchant.
      const enriched = normalizeLocation({ ...normalizeLocation(resolved), ...pending.location });
      return store.run(db => {
        const state = ensureTelegramState(db), current = state.locations[key];
        if (current?.id !== id) return null;
        if (current.expiresAt <= atMillis(now) || visible(db, context.uid).ledgerId !== current.ledgerId) {
          delete state.locations[key]; return null;
        }
        current.location = enriched;
        current.status = 'ready';
        delete current.accuracy;
        return enriched;
      });
    })();
    locationLookups.set(id, work);
    try { return await work; }
    finally { if (locationLookups.get(id) === work) locationLookups.delete(id); }
  }

  async function rememberLocation(context, message) {
    const chatId = message.chat.id, key = locationSessionKey(context, chatId);
    const location = locationFromMessage(message);
    if (!location) {
      await clearPendingLocation(context, chatId);
      return reply(context, chatId, 'locationUnavailable', { ok: false, reason: 'invalid-location' });
    }
    invokeLimit(`telegram-location:${context.telegramId}`, 12);
    const id = randomUUID(), at = atMillis(now);
    const accuracy = (message.venue?.location || message.location)?.horizontal_accuracy;
    const accepted = await store.run(db => {
      const state = ensureTelegramState(db);
      if (visible(db, context.uid).ledgerId !== context.profile.ledgerId) return 'ledger-changed';
      const sourceUpdate = Number(context.operation.key);
      if (state.locations[key]?.sourceUpdate > sourceUpdate) return 'superseded';
      // Reserve before lookup. A slow older reverse-geocoding response must
      // never replace a newer location (or an already consumed amount).
      state.locations[key] = { id, uid: context.uid, telegramId: context.telegramId, chatId: String(chatId),
        ledgerId: context.profile.ledgerId, location, language: context.language, sourceUpdate, status: 'resolving',
        ...(typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy } : {}),
        createdAt: at, expiresAt: at + LOCATION_TTL };
      const preference = state.preferences[context.uid];
      const editing = state.drafts[preference?.editingDraftId];
      if (editing?.status === 'editing') editing.status = 'pending';
      if (preference) { delete preference.editingDraftId; delete preference.editingChatId; }
      pruneTelegramState(state, at, maxDrafts);
      return 'saved';
    });
    if (accepted === 'ledger-changed') return reply(context, chatId, 'ledgerChanged', { ok: false, reason: 'ledger-changed' });
    if (accepted === 'superseded') return { ok: true, kind: 'location-superseded' };
    const enriched = await resolvePendingLocation(context, key, id);
    if (!enriched) return { ok: true, kind: 'location-superseded' };
    const name = escapeTelegramText(locationLabel(enriched)) || botText(context.language, 'locationHere');
    return deliverReply(context.operation, { type: 'reply', chatId,
      text: botText(context.language, 'locationReceived', { name }),
      result: { ok: true, kind: 'location', expiresAt: at + LOCATION_TTL } });
  }

  async function takePendingLocation(context, message) {
    const key = locationSessionKey(context, message.chat.id);
    const resolvingId = await store.run(db => {
      const pending = ensureTelegramState(db).locations[key];
      return pending?.status === 'resolving' && pending.sourceUpdate < Number(context.operation.key) ? pending.id : null;
    });
    // A quickly typed amount waits for the same bounded lookup, outside the
    // store transaction. After a restart, the resolving session is resumed.
    // This keeps a foreign decimal amount from being checked as JPY first.
    if (resolvingId) await resolvePendingLocation(context, key, resolvingId);
    return store.run(db => {
      const state = ensureTelegramState(db);
      const checkpoint = state.updates[context.operation?.key];
      const pending = checkpoint?.locationEntry || state.locations[key];
      if (!pending) return null;
      if (pending.sourceUpdate >= Number(context.operation.key)) return null;
      if (pending.uid !== context.uid || pending.telegramId !== context.telegramId || pending.chatId !== String(message.chat.id)
        || pending.expiresAt <= atMillis(now) || pending.ledgerId !== visible(db, context.uid).ledgerId) {
        delete state.locations[key];
        if (checkpoint) delete checkpoint.locationEntry;
        return { stale: true };
      }
      const recommended = currencyForCountry(pending.location?.countryCode);
      const currency = Object.hasOwn(CURRENCIES, recommended) ? recommended : context.profile.settings.currency || 'JPY';
      const amount = locationAmount(message.text, currency);
      if (!amount) return { invalid: true, currency };
      const entry = { ...pending, ...amount };
      delete state.locations[key];
      // The location is consumed once across concurrent messages, while a
      // delivery/persistence retry of this same update retains its context.
      if (checkpoint?.lease === context.operation?.lease) checkpoint.locationEntry = entry;
      return entry;
    });
  }

  async function downloadTelegramFile(fileId, maximum = MAX_IMAGE_BYTES) {
    if (typeof downloadFile === 'function') {
      const result = await downloadFile(fileId, maximum);
      const bytes = Buffer.isBuffer(result) ? result : Buffer.from(result?.data || result || '');
      if (!bytes.length) throw new Error('fileDownloadFailed');
      if (bytes.length > maximum) throw new Error('errorImportFileTooLarge');
      return bytes;
    }
    const file = await botCall('getFile', { file_id: fileId });
    const filePath = file?.file_path || file?.result?.file_path;
    if (!filePath || !token || !/^[a-zA-Z0-9_./-]+$/.test(filePath) || filePath.includes('..')) throw new Error('fileDownloadFailed');
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(60000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('fileDownloadFailed');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maximum) throw new Error('errorImportFileTooLarge');
    const chunks = [];
    let total = 0;
    const reader = response.body.getReader();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximum) {
        try { await reader.cancel(); } catch {}
        throw new Error('errorImportFileTooLarge');
      }
      chunks.push(Buffer.from(next.value));
    }
    if (!total) throw new Error('fileDownloadFailed');
    return Buffer.concat(chunks);
  }

  async function prepareImportAttachment(bytes, fileInfo, caption = '') {
    const mimeType = String(fileInfo?.mimeType || '').toLowerCase();
    const kind = importKind(mimeType);
    if (!kind || bytes.length > MAX_IMPORT_FILE_BYTES) throw new Error('errorImportFileTooLarge');
    const name = safeString(fileInfo?.name, 160);
    if (kind === 'text' || kind === 'spreadsheet' || kind === 'word') {
      const extracted = await extractImportText(bytes, mimeType);
      const combined = [caption, extracted.text].filter(Boolean).join('\n\n');
      return { text: combined.slice(0, MAX_IMPORT_TEXT), image: null, file: null,
        truncated: extracted.truncated || combined.length > MAX_IMPORT_TEXT };
    }
    const data = bytes.toString('base64');
    const file = { data, mimeType, name };
    return { text: caption, image: kind === 'image' ? file : null, file: kind === 'image' ? null : file };
  }

  function importFromMessage(message) {
    const photo = Array.isArray(message?.photo) && message.photo.length ? message.photo.at(-1) : null;
    if (photo?.file_id) return { fileId: photo.file_id, mimeType: 'image/jpeg', fileSize: Number(photo.file_size) || 0, name: 'telegram-photo.jpg', kind: 'image' };
    const document = message?.document;
    if (!document?.file_id) return null;
    const mimeType = importMime(document);
    return mimeType ? { fileId: document.file_id, mimeType, fileSize: Number(document.file_size) || 0, name: safeString(document.file_name, 160), kind: importKind(mimeType) } : { fileId: document.file_id, mimeType: '', fileSize: Number(document.file_size) || 0, name: safeString(document.file_name, 160), kind: '' };
  }

  function toDraftItem(item, profile, uid, sourceTimezone, language = profile.settings.language, locationContext) {
    const type = item?.type === 'income' ? 'income' : 'expense';
    const currency = Object.hasOwn(CURRENCIES, item?.currency) ? item.currency : (profile.settings.currency || 'JPY');
    const category = chooseCategory(item, type, profile.settings);
    const amountMinor = amountMinorFromItem(item, currency);
    if (!category || !amountMinor) return null;
    const itemTimezone = validTimezone(item?.timezone, sourceTimezone);
    const merchant = safeString(item?.merchant, 120);
    let note = safeString(item?.note, 160);
    if (!note && merchant) note = merchant.slice(0, 160);
    const members = profile.settings.consumers || [];
    const allowedMembers = new Set(members.map(member => member.id));
    const consumer = allowedMembers.has(item?.consumer) ? item.consumer : defaultConsumer(profile, uid);
    const splitParticipants = Array.isArray(item?.splitParticipants)
      ? [...new Set(item.splitParticipants.filter(id => allowedMembers.has(id)))] : [];
    const splitMode = type === 'expense' && item?.splitMode === 'equal' && splitParticipants.length ? 'equal' : 'none';
    const recordKind = ['purchase', 'transfer', 'reimbursement', 'refund', 'gift', 'other'].includes(item?.recordKind)
      ? item.recordKind : 'purchase';
    const expense = {
        id: randomUUID(),
        type,
        amountMinor,
        currency,
        occurredAt: safeOccurredAt(item?.occurredAt),
        categoryId: category.id,
        consumer,
        note,
        timezone: itemTimezone,
        splitMode,
        splitParticipants: splitMode === 'equal' ? splitParticipants : [],
        recordKind,
        ...(normalizeLocation(locationContext) ? { location: normalizeLocation(locationContext) } : {}),
      };
    try { validateExpense(expense, profile.settings); } catch { return null; }
    return {
      expense,
      label: categoryLabel(category, language),
      merchant,
      payerName: members.find(member => member.id === consumer)?.name || '',
      splitNames: splitMode === 'equal' ? members.filter(member => splitParticipants.includes(member.id)).map(member => member.name) : [],
      confidence: Number.isFinite(Number(item?.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : null,
      needsReview: item?.needsReview === true || ['transfer', 'reimbursement'].includes(recordKind),
      recordKind,
      reviewReason: safeString(item?.reviewReason, 160),
    };
  }

  function previewText(draft, language) {
    const lines = [botText(language, 'previewTitle')];
    const items = draft.items || [];
    for (const [index, item] of items.entries()) {
      const expense = item.expense;
      const kind = expense.type === 'income' ? botText(language, 'previewIncome') : botText(language, 'previewExpense');
      const amount = amountText(expense.amountMinor, expense.currency);
      const category = escapeTelegramText(item.label || expense.categoryId);
      const merchant = item.merchant ? ` · ${escapeTelegramText(item.merchant)}` : '';
      const locale = { zh: 'zh-CN', en: 'en-US', uk: 'uk-UA' }[language] || 'en-US';
      const time = expense.occurredAt ? new Date(expense.occurredAt).toLocaleString(locale, { timeZone: expense.timezone, dateStyle: 'short', timeStyle: 'short' }) : botText(language, 'timeMissing');
      lines.push(`${index + 1}. ${kind} ${expense.currency} ${amount} · ${category}${merchant}\n   ${botText(language, 'previewTime')}: ${time}`);
      if (item.payerName) lines.push(`   ${botText(language, 'previewPayer')}: ${escapeTelegramText(item.payerName)}`);
      if (item.splitNames?.length) lines.push(`   ${botText(language, 'previewSplit')}: ${item.splitNames.map(escapeTelegramText).join(' / ')}`);
      if (expense.note && expense.note !== item.merchant) lines.push(`   ${botText(language, 'previewNote')}: ${escapeTelegramText(expense.note)}`);
      if (locationLabel(expense.location)) lines.push(`   📍 ${escapeTelegramText(locationLabel(expense.location))}`);
      if (item.needsReview) lines.push(`   ${botText(language, 'reviewNeeded')}${item.reviewReason ? `: ${escapeTelegramText(item.reviewReason)}` : ''}`);
    }
    lines.push('', botText(language, 'previewHint'));
    if (draft.needsTime) lines.push(botText(language, 'timeMissingHint'));
    if (draft.inputTruncated) lines.push(botText(language, 'inputTruncated'));
    return lines.join('\n');
  }

  async function saveDraft(context, chatId, parsed, { retryId = null, replaceDraftId = null, inputTruncated = false, locationContext } = {}) {
    const sourceTimezone = validTimezone(parsed?.timezone, timezone);
    const raw = normaliseItems(parsed);
    if (!raw.length || raw.length > MAX_PREVIEW_ITEMS) return null;
    const items = raw.map(item => toDraftItem(item, context.profile, context.uid, sourceTimezone, context.language, locationContext));
    if (items.some(item => !item)) return null;
    const id = randomUUID();
    const at = atMillis(now);
    const draft = {
      id,
      uid: context.uid,
      telegramId: context.telegramId,
      chatId: String(chatId),
      ledgerId: context.profile.ledgerId,
      language: context.language,
      createdAt: at,
      expiresAt: at + DRAFT_TTL,
      status: 'pending',
      needsTime: items.some(item => !item.expense.occurredAt),
      needsReview: inputTruncated || items.some(item => item.needsReview),
      inputTruncated,
      items,
      retryId,
      previewSent: 0,
      previewComplete: false,
    };
    const saved = await store.run(db => {
      const state = ensureTelegramState(db);
      pruneTelegramState(state, at, maxDrafts);
      if (replaceDraftId && (state.drafts[replaceDraftId]?.uid !== context.uid || state.drafts[replaceDraftId]?.status !== 'refining')) return false;
      state.drafts[id] = draft;
      if (replaceDraftId && state.drafts[replaceDraftId]?.uid === context.uid) state.drafts[replaceDraftId].status = 'replaced';
      const operation = context.operation;
      if (state.updates[operation?.key]?.lease === operation?.lease) {
        state.updates[operation.key].action = { type: 'draft', draftId: id };
        delete state.updates[operation.key].locationEntry;
      }
      pruneTelegramState(state, at, maxDrafts);
      return true;
    });
    return saved ? draft : null;
  }

  async function deliverDraft(draft) {
    const language = draft.language;
    const pages = splitTelegramText(previewText(draft, language));
    for (let index = draft.previewSent || 0; index < pages.length; index++) {
      const last = index === pages.length - 1;
      const inline_keyboard = [[
        { text: botText(language, draft.needsTime ? 'confirmNow' : 'confirm'), callback_data: `fp:${draft.needsTime ? 'now' : 'confirm'}:${draft.id}` },
        { text: botText(language, 'edit'), callback_data: `fp:edit:${draft.id}` },
        { text: botText(language, 'cancel'), callback_data: `fp:cancel:${draft.id}` },
      ]];
      if (draft.retryId && getCachedImage(draft.retryId)) inline_keyboard.push([{ text: botText(language, 'enhance'), callback_data: `fp:retry:${draft.retryId}` }]);
      await sendMessage(draft.chatId, pages[index], last ? { reply_markup: { inline_keyboard } } : {});
      await store.run(db => {
        const stored = ensureTelegramState(db).drafts[draft.id];
        if (stored) { stored.previewSent = index + 1; stored.previewComplete = last; }
      });
    }
    return { ok: true, kind: 'draft', draftId: draft.id, count: draft.items.length };
  }

  async function parseMessage(context, message, attachment, { enhanced = false, replaceDraftId = null, previousRecords = null, locationEntry = null, locationContext = null } = {}) {
    if (!aiParser || typeof aiParser.parse !== 'function') {
      return reply(context, message.chat.id, 'unavailable', { ok: false, reason: 'unavailable' });
    }
    const image = attachment?.image || null;
    const file = attachment?.file || null;
    const isAudio = AUDIO_MIME_TYPES.has(file?.mimeType);
    const text = locationEntry?.text || firstText(attachment?.text !== undefined ? attachment.text : (message.text || message.caption || ''));
    const location = normalizeLocation(locationEntry?.location || locationContext);
    const defaultCurrency = locationEntry?.currency || (location ? currencyForCountry(location.countryCode) : null) || (isAudio ? 'JPY' : null);
    if (!text && !image && !file) {
      return reply(context, message.chat.id, 'noInput', { ok: false, reason: 'no-input' });
    }
    invokeLimit(`telegram-ai:${context.telegramId}`, 12);
    const input = { text, image, file, timezone: validTimezone(timezone), telegramUserId: context.telegramId, enhanced, now: messageAnchor(message, context.at),
      language: context.language, defaultConsumer: defaultConsumer(context.profile, context.uid),
      ...(previousRecords ? { previousRecords } : {}), ...(defaultCurrency ? { defaultCurrency } : {}),
      ...(location ? { locationContext: location } : {}) };
    const retryId = (image || file) && !isAudio && !enhanced ? cacheImage(context, message.chat.id, input) : null;
    let parsed;
    try {
      parsed = await aiParser.parse(input, { ...context.profile.settings, language: context.language,
        ...(defaultCurrency ? { currency: defaultCurrency } : {}), currentConsumer: context.profile.user.id });
      if (!locationEntry) context.language = parsedLanguage(parsed, context.language);
    } catch (error) {
      const key = enhanced ? 'enhanceFailed' : AUDIO_MIME_TYPES.has(file?.mimeType) ? 'audioNoResult' : error?.message === 'errorAiResult' ? 'noResult' : 'unavailable';
      return reply(context, message.chat.id, key, { ok: false, reason: key }, retryMarkup(retryId, context.language));
    }
    if (locationEntry && normaliseItems(parsed).length) {
      // A numeric reply contains one exact amount. The model supplies category
      // and merchant suggestions, never a replacement amount, date or currency.
      parsed = { timezone: validTimezone(timezone), items: [{ ...normaliseItems(parsed)[0],
        amountMinor: locationEntry.amountMinor, currency: locationEntry.currency, type: 'expense',
        occurredAt: new Date(messageAnchor(message, context.at)).toISOString(),
        merchant: location.name || normaliseItems(parsed)[0]?.merchant || '',
      }] };
    }
    const draft = await saveDraft(context, message.chat.id, parsed, { retryId, replaceDraftId, inputTruncated: attachment?.truncated === true, locationContext: location });
    if (!draft) {
      return reply(context, message.chat.id, enhanced ? 'enhanceFailed' : AUDIO_MIME_TYPES.has(file?.mimeType) ? 'audioNoResult' : 'noResult', { ok: false, reason: 'no-result' }, retryMarkup(retryId, context.language));
    }
    if (retryId) { const cached = getCachedImage(retryId); if (cached) { cached.draftId = draft.id; cached.input.language = context.language; } }
    if (context.autoConfirm && !draft.needsReview && !replaceDraftId && !location) return autoConfirmDraft(context, draft);
    return deliverDraft(draft);
  }

  async function autoConfirmDraft(context, draft) {
    if (draft.needsReview) return deliverDraft(draft);
    const at = atMillis(now);
    let outcome;
    try {
      outcome = await store.run(db => {
        const state = ensureTelegramState(db);
        const stored = state.drafts[draft.id];
        if (!stored || stored.uid !== context.uid || stored.status !== 'pending') return { kind: 'already', count: stored?.savedIds?.length || 0 };
        const profile = visible(db, context.uid);
        const savedIds = [];
        for (const item of stored.items || []) {
          const expense = { ...item.expense, ...(!item.expense.occurredAt ? { occurredAt: new Date(at).toISOString() } : {}), ledgerId: stored.ledgerId };
          const result = handleDomain(db, context.uid, '/expenses', 'POST', expense, { now: at, limit, ledgerQuery: null });
          savedIds.push(result.id);
        }
        stored.status = 'confirmed';
        stored.savedIds = savedIds;
        stored.confirmedAt = at;
        stored.ledgerId = profile.ledgerId;
        stored.previewSent = 0;
        stored.previewComplete = true;
        return { kind: 'confirmed', count: savedIds.length, retryId: stored.retryId };
      });
    } catch (error) {
      outcome = { kind: error instanceof RequestError ? error.message : 'failed' };
    }
    if (outcome.retryId) deleteCachedImage(outcome.retryId);
    const key = outcome.kind === 'confirmed' ? 'confirmed' : outcome.kind === 'already' ? 'alreadyConfirmed' : outcome.kind === 'errorLedgerChanged' ? 'ledgerChanged' : 'failed';
    return deliverReply(context.operation, { type: 'reply', chatId: draft.chatId, text: botText(context.language, key, { n: outcome.count }), result: { ok: ['confirmed', 'already'].includes(outcome.kind), auto: true, ...outcome } });
  }

  async function startDraftEdit(context, query, draftId) {
    const chatId = query.message.chat.id;
    await clearPendingLocation(context, chatId);
    const outcome = await store.run(db => {
      const state = ensureTelegramState(db);
      const draft = state.drafts[draftId];
      if (!draft || draft.uid !== context.uid || draft.telegramId !== context.telegramId || draft.chatId !== String(chatId) || draft.expiresAt <= atMillis(now)) return { kind: 'missing' };
      if (draft.ledgerId !== context.profile.ledgerId) return { kind: 'ledger-changed', language: draft.language };
      if (!['pending', 'editing'].includes(draft.status)) return { kind: 'missing', language: draft.language };
      const previous = state.preferences[context.uid]?.editingDraftId;
      if (previous && previous !== draftId && state.drafts[previous]?.status === 'editing') {
        state.drafts[previous].status = 'pending';
      }
      draft.status = 'editing';
      state.preferences[context.uid] = { ...state.preferences[context.uid], editingDraftId: draftId, editingChatId: String(chatId) };
      return { kind: 'editing', language: draft.language };
    });
    context.language = outcome.language || context.language;
    return reply(context, chatId, outcome.kind === 'editing' ? 'editPrompt' : outcome.kind === 'ledger-changed' ? 'ledgerChanged' : 'expired', { ok: outcome.kind === 'editing', kind: outcome.kind });
  }

  async function pendingDraftEdit(context, chatId) {
    return store.run(db => {
      const state = ensureTelegramState(db);
      const preference = state.preferences[context.uid];
      if (!preference?.editingDraftId || preference.editingChatId !== String(chatId)) return null;
      const draft = state.drafts[preference.editingDraftId];
      if (!draft || draft.uid !== context.uid || draft.status !== 'editing' || draft.expiresAt <= atMillis(now)) {
        delete preference.editingDraftId; delete preference.editingChatId; return null;
      }
      if (draft.ledgerId !== context.profile.ledgerId) return { id: draft.id, stale: true };
      draft.status = 'refining';
      const previousRecords = draft.items.map(({ expense, merchant, label }) => ({
        amount: expense.amountMinor / (10 ** CURRENCIES[expense.currency].digits),
        currency: expense.currency, type: expense.type, categoryId: expense.categoryId,
        categoryLabel: label, consumer: expense.consumer, note: expense.note, merchant,
        occurredAt: expense.occurredAt, timezone: expense.timezone,
        splitMode: expense.splitMode, splitParticipants: [...expense.splitParticipants], recordKind: expense.recordKind,
        ...(expense.location ? { location: expense.location } : {}),
      }));
      return { id: draft.id, language: draft.language, previousRecords,
        locationContext: draft.items.length === 1 ? normalizeLocation(draft.items[0]?.expense?.location) : undefined };
    });
  }

  async function completeDraftEdit(context, originalId) {
    await store.run(db => {
      const state = ensureTelegramState(db);
      const draft = state.drafts[originalId];
      if (draft?.status === 'refining') draft.status = 'pending';
      const preference = state.preferences[context.uid];
      if (preference?.editingDraftId === originalId) { delete preference.editingDraftId; delete preference.editingChatId; }
    });
  }

  async function setConfirmationMode(context, chatId, mode) {
    await store.run(db => {
      const state = ensureTelegramState(db);
      state.preferences[context.uid] = { mode, updatedAt: atMillis(now) };
    });
    await sendMessage(chatId, botText(context.language, mode === 'auto' ? 'autoEnabled' : 'manualEnabled'));
    return { ok: true, kind: mode === 'auto' ? 'auto-enabled' : 'manual-enabled', mode };
  }

  async function summaryFor(context, message, text) {
    const period = periodForText(text);
    const currentTimezone = validTimezone(timezone);
    invokeLimit(`telegram-summary:${context.telegramId}`, 6);
    let output = null;
    try {
      if (typeof aiParser?.summarize === 'function') {
        const result = await aiParser.summarize({ question: firstText(text), period, timezone: currentTimezone }, {
          ...context.profile, settings: { ...context.profile.settings, language: context.language },
        });
        output = typeof result === 'string' ? result : result?.text;
      }
    } catch {}
    if (!output?.trim()) return reply(context, message.chat.id, 'summaryUnavailable', { ok: false, reason: 'summary-unavailable' });
    return deliverReply(context.operation, { type: 'reply', chatId: message.chat.id, text: output.trim().slice(0, 3900), result: { ok: true, kind: 'summary', ai: true } });
  }

  async function cancelDrafts(context, chatId) {
    const count = await store.run(db => {
      const state = ensureTelegramState(db);
      let changed = 0;
      for (const draft of Object.values(state.drafts)) {
        if (draft.uid === context.uid && ['pending', 'refining', 'editing'].includes(draft.status)) { draft.status = 'cancelled'; changed++; }
      }
      const preference = state.preferences[context.uid];
      if (preference) { delete preference.editingDraftId; delete preference.editingChatId; }
      for (const [id, location] of Object.entries(state.locations)) {
        if (location.uid === context.uid && !(location.sourceUpdate > Number(context.operation?.key))) delete state.locations[id];
      }
      return changed;
    });
    for (const [id, cached] of imageCache) if (cached.uid === context.uid) deleteCachedImage(id);
    await sendMessage(chatId, botText(context.language, 'cancelled'));
    return { ok: true, kind: 'cancel', count };
  }

  async function retryImage(context, query, retryId) {
    const cached = getCachedImage(retryId);
    const chatId = query.message.chat.id;
    if (!cached || cached.uid !== context.uid || cached.telegramId !== context.telegramId || cached.chatId !== String(chatId)) {
      return reply(context, chatId, 'retryExpired', { ok: false, reason: 'retry-expired' });
    }
    if (cached.used) return reply(context, chatId, 'enhancing', { ok: true, kind: 'already-retrying' });
    if (cached.ledgerId !== context.profile.ledgerId) return reply(context, chatId, 'ledgerChanged', { ok: false, reason: 'ledger-changed' });
    context.language = cached.input.language || context.language;
    cached.used = true;
    if (cached.draftId) {
      const available = await store.run(db => {
        const draft = ensureTelegramState(db).drafts[cached.draftId];
        if (!draft || draft.uid !== context.uid || draft.status !== 'pending') return false;
        draft.status = 'refining'; return true;
      });
      if (!available) {
        deleteCachedImage(retryId);
        return reply(context, chatId, 'expired', { ok: false, reason: 'retry-unavailable' });
      }
    }
    try {
      return await parseMessage(context, { chat: query.message.chat, text: cached.input.text }, {
        text: cached.input.text,
        image: cached.input.image || null,
        file: cached.input.file || null,
      }, { enhanced: true, replaceDraftId: cached.draftId });
    } finally {
      if (cached.draftId) await store.run(db => {
        const draft = ensureTelegramState(db).drafts[cached.draftId];
        if (draft?.status === 'refining') draft.status = 'pending';
      });
      deleteCachedImage(retryId);
    }
  }

  async function callbackUpdate(update, operation) {
    const query = update.callback_query;
    if (query?.message?.chat?.type !== 'private') return { ok: true, kind: 'ignored' };
    const from = query?.from;
    const context = await contextFor(from, operation);
    if (!context) return { ok: false, reason: 'invalid-user' };
    const match = /^fp:(confirm|now|cancel|retry|edit):([a-zA-Z0-9_-]{8,64})$/.exec(String(query.data || ''));
    if (!match) {
      try { await botCall('answerCallbackQuery', { callback_query_id: query.id }); } catch {}
      return { ok: false, reason: 'invalid-callback' };
    }
    try { await botCall('answerCallbackQuery', { callback_query_id: query.id }); } catch {}
    const action = match[1], draftId = match[2], at = atMillis(now);
    if (action === 'retry') return retryImage(context, query, draftId);
    if (action === 'edit') return startDraftEdit(context, query, draftId);
    let outcome;
    try {
      outcome = await store.run(db => {
        const state = ensureTelegramState(db);
        pruneTelegramState(state, at, maxDrafts);
        const draft = state.drafts[draftId];
        if (!draft || draft.uid !== context.uid || String(draft.chatId) !== String(query.message?.chat?.id ?? '')) return { kind: 'missing' };
        context.language = draft.language || context.language;
        if (draft.expiresAt <= at || draft.status === 'expired') { draft.status = 'expired'; return { kind: 'expired' }; }
        if (action === 'cancel') {
          if (draft.status === 'confirmed') return { kind: 'already' };
          draft.status = 'cancelled'; return { kind: 'cancelled' };
        }
        if (draft.status === 'confirmed') return { kind: 'already', count: draft.savedIds?.length || draft.items.length };
        if (draft.status === 'editing') return { kind: 'editing' };
        if (draft.status === 'refining') return { kind: 'refining' };
        if (draft.status !== 'pending') return { kind: 'cancelled' };
        if (!draft.previewComplete) return { kind: 'preview-incomplete' };
        if (draft.needsTime && action !== 'now') return { kind: 'needs-time' };
        const profile = visible(db, context.uid);
        const savedIds = [];
        for (const item of draft.items || []) {
          const expense = { ...item.expense, ...(action === 'now' && !item.expense.occurredAt ? { occurredAt: new Date(at).toISOString() } : {}), ledgerId: draft.ledgerId };
          const result = handleDomain(db, context.uid, '/expenses', 'POST', expense, { now: at, limit, ledgerQuery: null });
          savedIds.push(result.id);
        }
        draft.status = 'confirmed';
        draft.savedIds = savedIds;
        draft.confirmedAt = at;
        draft.ledgerId = profile.ledgerId;
        return { kind: 'confirmed', count: savedIds.length, retryId: draft.retryId };
      });
    } catch (error) {
      outcome = { kind: error instanceof RequestError ? error.message : 'failed' };
    }
    const language = context.language;
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    if (outcome.retryId) deleteCachedImage(outcome.retryId);
    if (['cancelled', 'already'].includes(outcome.kind)) for (const [id, cached] of imageCache) if (cached.draftId === draftId) deleteCachedImage(id);
    const key = ({ confirmed: 'confirmed', already: 'alreadyConfirmed', cancelled: 'cancelled', missing: 'expired', expired: 'expired',
      'needs-time': 'timeMissingHint', 'preview-incomplete': 'previewIncomplete', editing: 'editPrompt', refining: 'enhancing', errorLedgerChanged: 'ledgerChanged' })[outcome.kind] || 'failed';
    const result = { ok: ['confirmed', 'already', 'cancelled'].includes(outcome.kind), ...outcome };
    const keepButtons = ['needs-time', 'preview-incomplete', 'refining', 'editing'].includes(outcome.kind);
    return deliverReply(operation, { type: keepButtons || outcome.kind === 'missing' ? 'reply' : 'edit', chatId, messageId,
      text: botText(language, key, { n: outcome.count }), extra: keepButtons ? {} : { reply_markup: { inline_keyboard: [] } }, result });
  }

  async function messageUpdate(update, operation) {
    const message = update.message;
    if (!message?.chat || message.chat.type !== 'private') return { ok: true, kind: 'ignored' };
    const context = await contextFor(message.from, operation);
    if (!context) return { ok: false, reason: 'invalid-user' };
    context.language = contentLanguage(message.text || message.caption || '', context.language);
    const text = firstText(message.text || '');
    if (message.location || message.venue) return rememberLocation(context, message);
    const numericOnly = /^[\d.,\s]+$/u.test(String(message.text || '').normalize('NFKC').trim())
      && /\d/u.test(String(message.text || '').normalize('NFKC'))
      && !message.voice && !message.audio && !message.photo && !message.document;
    let locationEntry = null;
    if (numericOnly) {
      locationEntry = await takePendingLocation(context, message);
      if (locationEntry?.stale) return reply(context, message.chat.id, 'locationExpired', { ok: false, reason: 'location-expired' });
      if (locationEntry?.invalid) return reply(context, message.chat.id, 'locationAmountInvalid', { ok: false, reason: 'location-amount-invalid' });
      if (locationEntry?.language) context.language = locationEntry.language;
    } else await clearPendingLocation(context, message.chat.id);
    const command = /^\/(start|help|cancel|month|week|auto|manual)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/i.exec(text);
    if (command) {
      const name = command[1].toLowerCase();
      if (name === 'start') {
        await sendMessage(message.chat.id, botText(context.language, 'welcome'), publicUrl ? { reply_markup: { inline_keyboard: [[{ text: botText(context.language, 'open'), web_app: { url: publicUrl } }]] } } : {});
        return { ok: true, kind: 'start' };
      }
      if (name === 'help') { await sendMessage(message.chat.id, botText(context.language, 'help')); return { ok: true, kind: 'help' }; }
      if (name === 'cancel') return cancelDrafts(context, message.chat.id);
      if (name === 'auto') return setConfirmationMode(context, message.chat.id, 'auto');
      if (name === 'manual') return setConfirmationMode(context, message.chat.id, 'manual');
      return summaryFor(context, message, name === 'week' ? '/week' : '/month');
    }
    if (summaryQuestion(text)) return summaryFor(context, message, text);
    const audioInfo = audioFromMessage(message);
    const fileInfo = importFromMessage(message);
    if ((message.voice || message.audio) && !audioInfo?.kind) {
      await sendMessage(message.chat.id, botText(context.language, 'invalidAudio'));
      return { ok: false, reason: 'invalid-audio' };
    }
    if (message.document && !fileInfo?.kind) {
      await sendMessage(message.chat.id, botText(context.language, 'invalidPhoto'));
      return { ok: false, reason: 'invalid-image' };
    }
    if (!text && !fileInfo && !audioInfo) {
      await sendMessage(message.chat.id, botText(context.language, 'noInput'));
      return { ok: false, reason: 'no-input' };
    }
    let attachment = { text, image: null, file: null };
    if (audioInfo) {
      invokeLimit(`telegram-audio:${context.telegramId}`, 12);
      if (audioInfo.duration > MAX_AUDIO_SECONDS) {
        await sendMessage(message.chat.id, botText(context.language, 'audioTooLong'));
        return { ok: false, reason: 'audio-too-long' };
      }
      if (audioInfo.fileSize > MAX_AUDIO_BYTES) {
        await sendMessage(message.chat.id, botText(context.language, 'audioTooLarge'));
        return { ok: false, reason: 'audio-too-large' };
      }
      try {
        const bytes = await downloadTelegramFile(audioInfo.fileId, MAX_AUDIO_BYTES);
        attachment = await prepareImportAttachment(bytes, audioInfo, text || message.caption || '');
      } catch (error) {
        await sendMessage(message.chat.id, botText(context.language, 'audioReadFailed'));
        return { ok: false, reason: error?.message === 'errorImportFileTooLarge' ? 'audio-too-large' : 'audio-download' };
      }
    } else if (fileInfo) {
      invokeLimit(`telegram-image:${context.telegramId}`, 12);
      if (fileInfo.fileSize > MAX_IMPORT_FILE_BYTES) {
        await sendMessage(message.chat.id, botText(context.language, 'invalidPhoto'));
        return { ok: false, reason: fileInfo.kind === 'image' ? 'image-too-large' : 'file-too-large' };
      }
      try {
        const bytes = await downloadTelegramFile(fileInfo.fileId, MAX_IMPORT_FILE_BYTES);
        attachment = await prepareImportAttachment(bytes, fileInfo, text || message.caption || '');
      } catch (error) {
        await sendMessage(message.chat.id, botText(context.language, 'invalidPhoto'));
        return { ok: false, reason: error?.message === 'errorImportFileTooLarge' ? 'file-too-large' : 'file-download' };
      }
    }
    const editing = await pendingDraftEdit(context, message.chat.id);
    if (editing?.stale) {
      await completeDraftEdit(context, editing.id);
      return reply(context, message.chat.id, 'ledgerChanged', { ok: false, reason: 'ledger-changed' });
    }
    if (!editing) return parseMessage(context, message, attachment, { locationEntry });
    try {
      return await parseMessage(context, message, attachment, { replaceDraftId: editing.id, previousRecords: editing.previousRecords, locationContext: editing.locationContext });
    } finally {
      await completeDraftEdit(context, editing.id);
    }
  }

  async function processUpdate(update) {
    const operation = await acquireUpdate(update.update_id);
    if (operation.duplicate) return { ok: true, duplicate: true };
    if (operation.busy) return { ok: false, retryable: true, reason: 'processing' };
    try {
      let result;
      if (operation.action?.type === 'draft') {
        const draft = await store.run(db => structuredClone(ensureTelegramState(db).drafts[operation.action.draftId] || null));
        if (draft && draft.expiresAt > atMillis(now)) result = await deliverDraft(draft);
        else {
          const source = update.message || update.callback_query?.message;
          const context = await contextFor(update.message?.from || update.callback_query?.from, operation);
          result = context && source?.chat?.id ? await reply(context, source.chat.id, 'expired', { ok: false, reason: 'expired' }) : { ok: false, reason: 'expired' };
        }
      } else if (operation.action) {
        result = await deliverReply(operation, operation.action);
      } else if (update.callback_query) result = await callbackUpdate(update, operation);
      else if (update.message) result = await messageUpdate(update, operation);
      else result = { ok: true, kind: 'ignored' };
      await updateOperation(operation, { status: 'done', leaseUntil: 0, action: null, locationEntry: null });
      return result;
    } catch (error) {
      // Keep the durable draft/reply checkpoint so a delivery retry never
      // invokes the model or writes the same records a second time. Telegram
      // itself cannot make a timed-out sendMessage exactly-once, so any
      // repeated message still uses the same draft and expense IDs.
      await updateOperation(operation, { status: 'pending', leaseUntil: 0 });
      return { ok: false, retryable: true, reason: error?.status === 429 || error?.message === 'errorRateLimit' ? 'rate-limit' : 'handler-failed' };
    }
  }

  async function handle(update) {
    if (!update || typeof update !== 'object' || !Number.isSafeInteger(update.update_id) || update.update_id < 0) return { ok: true, kind: 'ignored' };
    const key = String(update.update_id);
    if (inflight.has(key)) {
      const result = await inflight.get(key);
      return result.retryable ? result : { ok: true, duplicate: true };
    }
    const promise = processUpdate(update);
    inflight.set(key, promise);
    try { return await promise; } finally { inflight.delete(key); }
  }

  return { handle, close: () => { for (const id of imageCache.keys()) deleteCachedImage(id); }, constants: { maxImageBytes: MAX_IMAGE_BYTES, maxImportFileBytes: MAX_IMPORT_FILE_BYTES, maxImportText: MAX_IMPORT_TEXT, maxAudioBytes: MAX_AUDIO_BYTES, maxAudioSeconds: MAX_AUDIO_SECONDS, draftTtl: DRAFT_TTL, locationTtl: LOCATION_TTL } };
}

export { MAX_IMAGE_BYTES, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_TEXT, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, DRAFT_TTL, LOCATION_TTL };
