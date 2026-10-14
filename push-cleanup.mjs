import { randomUUID } from 'node:crypto';
import { DEFAULT_DIGEST_TIMEZONE, localDateParts, safeDigestTimezone } from './digest.mjs';

const SOURCES = Object.freeze(['digestDeliveries', 'missingEntryReminders']);
const TERMINAL = new Set(['deleted', 'expired']);
const DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;
const CLAIM_MS = 2 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;

function timestamp(value) {
  if (value instanceof Date) value = value.getTime();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) value = Date.parse(value);
  return typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
}

function messageAddress(record) {
  const chatId = String(record?.chatId ?? '').trim();
  const rawId = record?.messageId;
  const messageId = typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : rawId;
  if (!/^-?[1-9]\d{0,19}$/.test(chatId) || !Number.isSafeInteger(messageId) || messageId <= 0) return null;
  const sentAt = timestamp(record.sentAt);
  if (sentAt === null || sentAt <= 0) return null;
  return { chatId, messageId, sentAt };
}

function validTimezone(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: value.trim() }).format(0); return value.trim(); } catch { return null; }
}

function deliveryTimezone(db, record, chatId) {
  // New deliveries keep the recipient's timezone at delivery. Old checkpoints
  // can still be cleaned up without guessing a date from their storage key.
  const stored = validTimezone(record.timezone);
  if (stored) return stored;
  let uid = db.users?.[record.uid] ? record.uid : db.identities?.[`telegram:${chatId}`];
  if (!db.users?.[uid]) {
    const candidates = Object.entries(db.telegram?.preferences || {}).filter(([, item]) => String(item?.chatId ?? '').trim() === chatId);
    if (candidates.length === 1) uid = candidates[0][0];
  }
  const recipient = validTimezone(db.users?.[uid]?.settings?.timezone);
  if (recipient) return recipient;
  const ledgerId = record.ledgerId || /^(.*):\d{4}-\d{2}-\d{2}:(?:morning|noon|evening)$/.exec(String(record.digestKey || ''))?.[1];
  return safeDigestTimezone(db.ledgers?.[ledgerId]?.settings?.timezone, DEFAULT_DIGEST_TIMEZONE);
}

function alreadyMissing(error) {
  return Number(error?.telegramCode ?? error?.error_code) === 400
    && /message to delete not found|message_id_invalid/i.test(String(error?.telegramDescription || error?.description || error?.message || ''));
}

function retryDelay(error, attempts) {
  const seconds = Number(error?.retryAfter ?? error?.parameters?.retry_after);
  const backoff = Math.min(60 * 60 * 1000, RETRY_MS * 2 ** Math.min(2, attempts - 1));
  return Math.max(backoff, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, DELETE_WINDOW_MS) : 0);
}

function telegramCaller(token, custom) {
  if (custom) return custom;
  if (!token) return null;
  return async (method, parameters) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters), signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw Object.assign(new Error('Telegram push cleanup failed'), {
      telegramCode: payload?.error_code || response.status,
      telegramDescription: payload?.description,
      retryAfter: payload?.parameters?.retry_after,
    });
    return payload.result;
  };
}

/** Delete only sent scheduled pushes, after their recipient's local midnight. */
export function createPushCleanupService({ store, token = '', callTelegram, now = () => Date.now() } = {}) {
  if (!store || typeof store.run !== 'function') throw new TypeError('Push cleanup requires a store');
  const telegram = telegramCaller(token, callTelegram);

  async function tick({ at = now() } = {}) {
    at = timestamp(at);
    if (at === null) throw new TypeError('Invalid push cleanup time');
    const results = [];
    if (!telegram) return { ok: true, at: new Date(at).toISOString(), results, deleted: 0, expired: 0, failed: 0, skipped: 0, disabled: true };
    // Do not scan message history, expense notifications, chat replies or
    // reaction bursts. Only these two delivery registries grant deletion.
    const candidates = await store.run(db => SOURCES.flatMap(source => Object.entries(db.cron?.[source] || {})
      .filter(([, item]) => item?.status === 'sent' && !TERMINAL.has(item.cleanup?.status))
      .map(([key]) => ({ source, key }))));

    for (const candidate of candidates) {
      const claim = await store.run(db => {
        const record = db.cron?.[candidate.source]?.[candidate.key];
        if (record?.status !== 'sent' || TERMINAL.has(record.cleanup?.status)) return { skipped: true, reason: 'finished' };
        const address = messageAddress(record);
        if (!address) return { skipped: true, reason: 'missing-delivery-proof' };
        if (address.sentAt > at) return { skipped: true, reason: 'future-delivery' };
        const timezone = deliveryTimezone(db, record, address.chatId);
        if (localDateParts(address.sentAt, timezone).date >= localDateParts(at, timezone).date) return { skipped: true, reason: 'same-local-date' };
        const previous = record.cleanup;
        if (previous?.status === 'deleting' && Number(previous.leaseUntil) > at) return { skipped: true, reason: 'processing' };
        if (at - address.sentAt >= DELETE_WINDOW_MS) {
          record.cleanup = { status: 'expired', expiredAt: at, timezone, attempts: previous?.attempts || 0 };
          return { expired: true, timezone };
        }
        if (previous?.status === 'failed' && Number(previous.retryAt) > at) return { skipped: true, reason: 'retry-later' };
        const claimToken = randomUUID();
        const attempts = (Number.isSafeInteger(previous?.attempts) && previous.attempts > 0 ? previous.attempts : 0) + 1;
        record.cleanup = { status: 'deleting', token: claimToken, timezone, attempts, claimedAt: at, leaseUntil: at + CLAIM_MS };
        return { token: claimToken, timezone, attempts, ...address };
      });
      const result = { ...candidate, timezone: claim.timezone };
      if (claim.skipped) { results.push({ ...result, skipped: true, reason: claim.reason }); continue; }
      if (claim.expired) { results.push({ ...result, expired: true }); continue; }
      const finish = patch => store.run(db => {
        const record = db.cron?.[candidate.source]?.[candidate.key];
        if (record?.cleanup?.token === claim.token) {
          // Preserve the original `sent` state: deleting a push must never
          // make a digest/reminder eligible to be sent a second time.
          Object.assign(record.cleanup, patch, { leaseUntil: 0 });
          delete record.cleanup.token;
        }
      });
      let accepted = false;
      try {
        await store.flush?.();
        try {
          const deleted = await telegram('deleteMessage', { chat_id: claim.chatId, message_id: claim.messageId });
          if (deleted !== true) throw new Error('Telegram did not confirm deletion');
          accepted = true;
        } catch (error) {
          // A previous attempt can succeed just before a restart or lost
          // response. Telegram's specific missing-message error is terminal.
          if (!alreadyMissing(error)) throw error;
          accepted = true;
        }
        await finish({ status: 'deleted', deletedAt: at });
        await store.flush?.();
        results.push({ ...result, deleted: true });
      } catch (error) {
        if (!accepted) await finish({ status: 'failed', failedAt: at, retryAt: at + retryDelay(error, claim.attempts) });
        // Never retain Telegram descriptions, request URLs or bot secrets.
        results.push({ ...result, failed: true });
      }
    }
    await store.flush?.();
    return { ok: !results.some(item => item.failed), at: new Date(at).toISOString(), results,
      deleted: results.filter(item => item.deleted).length, expired: results.filter(item => item.expired).length,
      failed: results.filter(item => item.failed).length, skipped: results.filter(item => item.skipped).length };
  }

  return { tick };
}
