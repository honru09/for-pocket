import { randomUUID } from 'node:crypto';
import { CURRENCIES, resolveLanguage } from './public/shared.mjs';
import { DEFAULT_DIGEST_TIMEZONE, localDateParts, safeDigestTimezone } from './digest.mjs';

export const MISSING_ENTRY_REMINDER_HOUR = 22;
const PRIVATE_CHAT_ID = /^[1-9]\d{0,19}$/;

function timestamp(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function revision(entry) {
  return Math.max(timestamp(entry?.updatedAt) ?? -Infinity, timestamp(entry?.deletedAt) ?? -Infinity,
    timestamp(entry?.createdAt) ?? timestamp(entry?.occurredAt) ?? -Infinity);
}

/** Match the payer before the author: old circles allowed recording for a partner. */
export function reminderEntryOwner(db, entry) {
  const payer = String(entry?.consumer || entry?.member?.id || '');
  if (payer.startsWith('u_') && db.users?.[payer.slice(2)]) return payer.slice(2);
  if (db.users?.[payer]) return payer;
  const author = String(entry?.createdBy || '');
  if (db.users?.[author]) return author;
  if (author.startsWith('u_') && db.users?.[author.slice(2)]) return author.slice(2);
  // The original personal source is trustworthy; merely being copied into a
  // personal ledger by an older sync implementation is not ownership proof.
  return db.users?.[entry?.ledgerId] ? entry.ledgerId : '';
}

/** Read each logical record once, including the latest deletion tombstone. */
export function reminderEntries(db) {
  const records = new Map();
  for (const ledger of Object.values(db.ledgers || {})) {
    for (const entry of Array.isArray(ledger?.expenses) ? ledger.expenses : []) {
      if (!entry?.id) continue;
      const previous = records.get(entry.id);
      if (!previous || revision(entry) > revision(previous)
        || (revision(entry) === revision(previous) && entry.deletedAt && !previous.deletedAt)) records.set(entry.id, entry);
    }
  }
  return [...records.values()];
}

export function hasRecordedToday(db, uid, { at = Date.now(), timezone = DEFAULT_DIGEST_TIMEZONE, entries = reminderEntries(db) } = {}) {
  const instant = timestamp(at);
  if (instant === null) return false;
  const today = localDateParts(instant, timezone).date;
  return entries.some(entry => {
    if (entry.deletedAt || reminderEntryOwner(db, entry) !== uid) return false;
    if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor <= 0 || !Object.hasOwn(CURRENCIES, entry.currency)) return false;
    const occurredAt = timestamp(entry.occurredAt) ?? timestamp(entry.createdAt);
    // Any saved financial record counts, including income or a transfer. This
    // is a gentle reminder to keep records, not a prompt to spend money.
    return occurredAt !== null && occurredAt <= instant && localDateParts(occurredAt, timezone).date === today;
  });
}

export function missingEntryReminderText(language = 'zh') {
  const lang = resolveLanguage(language, 'zh');
  if (lang === 'en') return "Today's page is still blank 👀 Got a minute? Send a voice note with what you spent and turn it into today's entries. Keep the little trail going, and see where the money wandered at month-end.";
  if (lang === 'uk') return 'За сьогодні ще жодного запису 👀 Є хвилинка? Надішли голосове про свої витрати — і записи за день готові. Наприкінці місяця розберемося, куди розбіглися гроші.';
  return '咳咳，今天的小账本还空着呢 👀 有空回想一下，发条语音就能把今天的账整理好。攒到月底，再一起翻翻钱都溜去哪儿啦。';
}

function recipientFor(db, uid) {
  const preference = db.telegram?.preferences?.[uid];
  const preferred = String(preference?.chatId || '').trim();
  const owner = db.identities?.[`telegram:${preferred}`];
  // A personal reminder must never reveal a user's recording habits in a group.
  if (PRIVATE_CHAT_ID.test(preferred) && (!preference.chatType || preference.chatType === 'private') && (!owner || owner === uid)) {
    return { chatId: preferred, language: resolveLanguage(preference.language || db.users?.[uid]?.settings?.language, 'zh') };
  }
  for (const [identity, linkedUid] of Object.entries(db.identities || {})) {
    if (linkedUid !== uid || !identity.startsWith('telegram:')) continue;
    const chatId = identity.slice(9);
    if (PRIVATE_CHAT_ID.test(chatId)) return { chatId, language: resolveLanguage(db.users?.[uid]?.settings?.language, 'zh') };
  }
  return null;
}

function telegramCaller(token, custom) {
  if (custom) return custom;
  if (!token) return null;
  return async (method, params) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error('Telegram reminder delivery failed');
    return payload.result;
  };
}

/** One private nudge per user/local date, independent of the selected circle. */
export function createMissingEntryReminderService({ store, token = '', callTelegram, now = () => Date.now(), defaultTimezone = DEFAULT_DIGEST_TIMEZONE, leaseMs = 120000 } = {}) {
  if (!store || typeof store.run !== 'function') throw new TypeError('Reminder service requires a store');
  const telegram = telegramCaller(token, callTelegram);

  async function tick({ at = now() } = {}) {
    at = timestamp(at);
    if (at === null) throw new TypeError('Invalid reminder time');
    if (!telegram) return { ok: true, at: new Date(at).toISOString(), results: [], sent: 0, failed: 0, skipped: 0, disabled: true };
    const contexts = await store.run(db => Object.entries(db.users || {}).map(([uid, user]) => {
      const timezone = safeDigestTimezone(user?.settings?.timezone, defaultTimezone);
      const local = localDateParts(at, timezone);
      const key = `${uid}:${local.date}`;
      const previous = db.cron?.missingEntryReminders?.[key];
      // First delivery is at 22:00; retry a failed/expired claim until local
      // midnight. Never send yesterday's reminder after a timezone/day change.
      const retry = local.hour >= MISSING_ENTRY_REMINDER_HOUR && ['failed', 'sending'].includes(previous?.status);
      return local.hour === MISSING_ENTRY_REMINDER_HOUR || retry ? { uid, timezone, localDate: local.date, key } : null;
    }).filter(Boolean));

    const results = [];
    for (const context of contexts) {
      const claim = await store.run(db => {
        if (!db.users?.[context.uid]) return { skipped: true, reason: 'user-missing' };
        const recipient = recipientFor(db, context.uid);
        if (!recipient) return { skipped: true, reason: 'no-private-chat' };
        const claims = db.cron?.missingEntryReminders || {};
        const previous = claims[context.key];
        if (previous?.status === 'sent') return { skipped: true, reason: 'already-sent' };
        if (previous?.status === 'sending' && Number(previous.leaseUntil) > at) return { skipped: true, reason: 'processing' };
        if (hasRecordedToday(db, context.uid, { at, timezone: context.timezone })) return { skipped: true, reason: 'already-recorded' };
        const claimToken = randomUUID();
        db.cron ||= {};
        db.cron.missingEntryReminders ||= {};
        db.cron.missingEntryReminders[context.key] = { status: 'sending', token: claimToken, uid: context.uid, localDate: context.localDate,
          timezone: context.timezone, chatId: recipient.chatId, claimedAt: at, leaseUntil: at + leaseMs, attempts: Number(previous?.attempts || 0) + 1 };
        return { token: claimToken, recipient };
      });
      const result = { uid: context.uid, localDate: context.localDate, timezone: context.timezone };
      if (claim.skipped) { results.push({ ...result, skipped: true, reason: claim.reason }); continue; }
      const finish = patch => store.run(db => {
        const record = db.cron?.missingEntryReminders?.[context.key];
        if (record?.token === claim.token) Object.assign(record, patch, { leaseUntil: 0 });
      });
      let accepted = false;
      try {
        await store.flush?.();
        const response = await telegram('sendMessage', { chat_id: claim.recipient.chatId, text: missingEntryReminderText(claim.recipient.language) });
        const messageId = Number(response?.message_id);
        if (!Number.isSafeInteger(messageId) || messageId <= 0) throw new Error('Telegram returned no message id');
        accepted = true;
        await finish({ status: 'sent', sentAt: at, messageId });
        await store.flush?.();
        results.push({ ...result, sent: true });
      } catch {
        // Do not persist Telegram error bodies or tokens. The scheduler can
        // retry a failed recipient without re-sending successful reminders.
        if (!accepted) await finish({ status: 'failed', failedAt: at });
        results.push({ ...result, failed: true });
      }
    }
    return { ok: !results.some(item => item.failed), at: new Date(at).toISOString(), results,
      sent: results.filter(item => item.sent).length, failed: results.filter(item => item.failed).length, skipped: results.filter(item => item.skipped).length };
  }

  return { tick };
}
