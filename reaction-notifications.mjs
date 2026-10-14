import { createHash, randomUUID } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { resolveLanguage } from './public/shared.mjs';

export const REACTION_BURST_GAP_MS = 3000;
export const REACTION_NOTIFICATION_DELAY_MS = REACTION_BURST_GAP_MS + 10000;
const TTL = 7 * 86400000, LEASE_MS = 60000, RETRY_MS = 10000, TELEGRAM_DELETE_WINDOW_MS = 48 * 3600000;
const terminal = value => ['sent', 'skipped', 'deleting', 'deleted', 'expired'].includes(value?.status);
const needsDeletion = value => Boolean(value?.readAt && value?.chatId && Number(value?.messageId) > 0 && !value?.deletedAt && !value?.deleteExpiredAt && !['deleted', 'expired'].includes(value?.status));
const clock = now => Number(typeof now === 'function' ? now() : now);
const findBurst = (db, circleId, burstId) => db.circles?.[circleId]?.reactionBursts?.find(item => item.id === burstId);

/** Acknowledgements mean the app displayed the reaction, not a Telegram read receipt. */
export function reconcileReactionReadState(circle, burst, at) {
  if (!burst) return false;
  const seen = (circle.reactions || []).filter(item => (item.burstId || item.id) === burst.id && item.to === burst.to && item.seenAt);
  // Keep the count when old, already-seen inbox items are evicted at capacity.
  burst.seenCount = Math.min(Number(burst.count) || 0, Math.max(Number(burst.seenCount) || 0, seen.length));
  const state = burst.notification ||= { status: 'pending' };
  if (burst.count > 0 && burst.seenCount >= burst.count) {
    state.readAt ||= seen.reduce((latest, item) => Math.max(latest, Number(item.seenAt) || 0), 0) || at;
    state.readCount = burst.count;
    return true;
  }
  delete state.readAt;
  delete state.readCount;
  return false;
}

export function reactionNotificationText({ name = '', emoji = '', count = 1 } = {}, language = 'zh') {
  const lang = resolveLanguage(language, 'zh');
  const sender = String(name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 48) || ({ zh: '圈子里的朋友', en: 'A friend', uk: 'друга' }[lang]);
  const suffix = count >= 2 ? ` ×${Math.trunc(count)}` : '';
  if (lang === 'en') return `${sender} sent you ${emoji}${suffix}`;
  if (lang === 'uk') return `Від ${sender} тобі ${emoji}${suffix}`;
  return `${sender}给你发了 ${emoji}${suffix}`;
}

function recipientChat(db, uid) {
  // A reaction is private to the chosen member. Never use a shared/group chat
  // captured by another bot workflow, and never guess a chat from a user id.
  const preference = db.telegram?.preferences?.[uid];
  const preferred = String(preference?.chatId || '').trim();
  const owner = db.identities?.[`telegram:${preferred}`];
  if (/^[1-9]\d{0,19}$/.test(preferred) && (!preference.chatType || preference.chatType === 'private') && (!owner || owner === uid)) {
    return { chatId: preferred, language: resolveLanguage(preference.language || db.users?.[uid]?.settings?.language, 'zh') };
  }
  const verifiedIdentity = Object.entries(db.identities || {}).find(([identity, owner]) => owner === uid && /^telegram:[1-9]\d{0,19}$/.test(identity))?.[0];
  if (!verifiedIdentity) return null;
  // A stale/group preference supplies neither the destination nor its language.
  // The identity index is the sole fallback for this member's private chat.
  return { chatId: verifiedIdentity.slice(9), language: resolveLanguage(db.users?.[uid]?.settings?.language, 'zh') };
}

function telegramCaller(token, custom) {
  if (custom) return custom;
  if (!token) return null;
  return async (method, parameters) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parameters), signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw Object.assign(new Error('telegram-reaction-send-failed'), {
      telegramDescription: String(payload?.description || ''), telegramCode: Number(payload?.error_code || response.status),
    });
    return payload.result;
  };
}

/**
 * Durable outbox. Call afterReaction after the domain transaction, deliver from
 * /api/cron/reactions, and tick from the existing cron/request repair path.
 * Timers improve local delivery, but Cloud Tasks is the production clock: Cloud
 * Run can freeze JavaScript timers as soon as the initiating response ends.
 */
export function createReactionNotificationService({ store, token = '', callTelegram, now = () => Date.now(), enqueueTask, localTimers = true } = {}) {
  if (!store || typeof store.run !== 'function') throw new TypeError('Reaction notifications require a store');
  const telegram = telegramCaller(token, callTelegram);
  const inflight = new Map(), scheduling = new Map(), deletions = new Map();
  let timer = null, closed = false;
  const flush = () => typeof store.flush === 'function' ? store.flush() : Promise.resolve();
  const keyFor = (circleId, burstId) => `${circleId}:${burstId}`;

  async function ensureScheduled(circleId, burstId, at = clock(now)) {
    if (typeof enqueueTask !== 'function' || closed) return false;
    const key = keyFor(circleId, burstId);
    if (scheduling.has(key)) return scheduling.get(key);
    const work = (async () => {
      const claimId = randomUUID();
      const task = await store.run(db => {
        const burst = findBurst(db, circleId, burstId);
        if (!burst || terminal(burst.notification) && !needsDeletion(burst.notification) || burst.lastAt <= at - TTL) return null;
        const state = burst.notification ||= { status: 'pending' };
        // One future task is enough: it will re-read the latest deadline and
        // requeue itself if the sender is still tapping. Do not enqueue per tap.
        if (Number(state.enqueuedFor) > at || Number(state.scheduleClaimUntil) > at) return null;
        Object.assign(state, { scheduleClaim: claimId, scheduleClaimUntil: at + LEASE_MS });
        return { circleId, burstId, scheduledFor: needsDeletion(state)
          ? Math.max(Number(state.deleteRetryAt) || at, Number(state.deleteClaimUntil) || 0, at)
          : Math.max(burst.dueAt, at) };
      });
      if (!task) return false;
      try {
        await flush();
        const result = await enqueueTask(task);
        await store.run(db => {
          const state = findBurst(db, circleId, burstId)?.notification;
          if (state?.scheduleClaim === claimId) Object.assign(state, { enqueuedFor: task.scheduledFor, taskName: String(result?.name || ''), scheduleClaimUntil: 0, scheduleError: '' });
        });
        await flush();
        return true;
      } catch {
        await store.run(db => {
          const state = findBurst(db, circleId, burstId)?.notification;
          if (state?.scheduleClaim === claimId) Object.assign(state, { scheduleClaimUntil: 0, scheduleError: 'task-enqueue-failed' });
        });
        await flush().catch(() => {});
        return false;
      }
    })();
    scheduling.set(key, work);
    try { return await work; } finally { if (scheduling.get(key) === work) scheduling.delete(key); }
  }

  async function sendOne(circleId, burstId, at) {
    if (!telegram) return { sent: 0, failed: 0, pending: 1 };
    const claimId = randomUUID();
    const snapshot = await store.run(db => {
      const circle = db.circles?.[circleId], burst = findBurst(db, circleId, burstId);
      if (!burst || terminal(burst.notification)) return null;
      const state = burst.notification ||= { status: 'pending' };
      if (Number(burst.dueAt) > at || state.status === 'sending' && Number(state.claimUntil) > at) return null;
      if (reconcileReactionReadState(circle, burst, at)) {
        Object.assign(state, { status: 'skipped', skippedAt: at, reason: 'already-read', claimUntil: 0 });
        return null;
      }
      const recipient = recipientChat(db, burst.to);
      if (burst.lastAt <= at - TTL || !circle.members?.includes(burst.from) || !circle.members?.includes(burst.to) || burst.from === burst.to || !db.users?.[burst.from] || !db.users?.[burst.to] || !recipient) {
        Object.assign(state, { status: 'skipped', skippedAt: at, reason: 'recipient-unavailable', claimUntil: 0 });
        return null;
      }
      Object.assign(state, { status: 'sending', claim: claimId, claimUntil: at + LEASE_MS, attempts: Number(state.attempts || 0) + 1 });
      return { recipient, text: reactionNotificationText({ name: db.users[burst.from].name, emoji: burst.emoji, count: burst.count }, recipient.language) };
    });
    if (!snapshot) return { sent: 0, failed: 0, pending: 0 };
    try {
      // Checkpoint before the external send to serialize task retries and
      // simultaneous request repair. Telegram has no sendMessage idempotency key.
      await flush();
      // An acknowledgement may arrive while the durable checkpoint is writing.
      // Suppress the send if it became read before the network call began.
      const stillUnread = await store.run(db => {
        const circle = db.circles?.[circleId], burst = findBurst(db, circleId, burstId);
        const state = burst?.notification;
        if (!burst || state?.claim !== claimId) return false;
        if (!reconcileReactionReadState(circle, burst, clock(now))) return true;
        Object.assign(state, { status: 'skipped', skippedAt: clock(now), reason: 'already-read', claimUntil: 0 });
        return false;
      });
      if (!stillUnread) { await flush(); return { sent: 0, failed: 0, pending: 0 }; }
      const response = await telegram('sendMessage', { chat_id: snapshot.recipient.chatId, text: snapshot.text, disable_notification: true });
      if (!Number.isSafeInteger(Number(response?.message_id)) || Number(response.message_id) <= 0) throw new Error('telegram-message-id-missing');
      await store.run(db => {
        const state = findBurst(db, circleId, burstId)?.notification;
        if (state?.claim === claimId) Object.assign(state, { status: 'sent', sentAt: clock(now), messageId: Number(response.message_id), chatId: snapshot.recipient.chatId, claimUntil: 0, error: '' });
      });
      await flush();
      // If the app displayed the burst during sendMessage, remove the accepted
      // message as soon as its id is known. The read flag survives that race.
      const removed = await deleteOne(circleId, burstId, clock(now));
      return { sent: 1, failed: removed.failed, pending: removed.pending, deleted: removed.deleted };
    } catch {
      await store.run(db => {
        const state = findBurst(db, circleId, burstId)?.notification;
        if (state?.claim === claimId && !terminal(state)) Object.assign(state, { status: 'failed', failedAt: clock(now), retryAt: clock(now) + RETRY_MS, claimUntil: 0, error: 'telegram-reaction-send-failed' });
      });
      await flush().catch(() => {});
      return { sent: 0, failed: 1, pending: 0 };
    }
  }

  async function deleteOne(circleId, burstId, at) {
    const key = keyFor(circleId, burstId);
    if (deletions.has(key)) { await deletions.get(key); return { deleted: 0, failed: 0, pending: 0 }; }
    const work = (async () => {
      if (!telegram) return { deleted: 0, failed: 0, pending: 1 };
      const claimId = randomUUID();
      const message = await store.run(db => {
        const circle = db.circles?.[circleId], burst = findBurst(db, circleId, burstId);
        if (!burst) return null;
        reconcileReactionReadState(circle, burst, at);
        const state = burst.notification;
        if (!needsDeletion(state)) return null;
        if (Number(state.sentAt) > 0 && at - Number(state.sentAt) >= TELEGRAM_DELETE_WINDOW_MS) {
          // Ordinary Telegram messages cannot be deleted through Bot API once
          // 48h old. Keep an honest terminal marker instead of retrying forever.
          Object.assign(state, { status: 'expired', deleteExpiredAt: at, deleteReason: 'telegram-48h-limit', deleteClaimUntil: 0, deleteRetryAt: 0 });
          return { expired: true };
        }
        if (Number(state.deleteRetryAt || 0) > at || Number(state.deleteClaimUntil || 0) > at) return { deferred: true };
        Object.assign(state, { status: 'deleting', deleteClaim: claimId, deleteClaimUntil: at + LEASE_MS, deleteAttempts: Number(state.deleteAttempts || 0) + 1 });
        return { chatId: state.chatId, messageId: state.messageId };
      });
      if (!message) return { deleted: 0, failed: 0, pending: 0 };
      if (message.expired) { await flush(); return { deleted: 0, failed: 0, pending: 0, expired: 1 }; }
      if (message.deferred) {
        await ensureScheduled(circleId, burstId, at);
        const state = typeof enqueueTask === 'function' ? await store.run(db => structuredClone(findBurst(db, circleId, burstId)?.notification || {})) : null;
        const failed = state && needsDeletion(state) && Number(state.enqueuedFor || 0) <= at && Number(state.scheduleClaimUntil || 0) <= at ? 1 : 0;
        return { deleted: 0, failed, pending: 1 };
      }
      try {
        await flush();
        try { await telegram('deleteMessage', { chat_id: message.chatId, message_id: message.messageId }); }
        catch (error) {
          // Idempotent after a lost response, a retry, or midnight cleanup.
          if (!/message (?:to delete )?not found/i.test(String(error?.telegramDescription || error?.description || error?.message || ''))) throw error;
        }
        await store.run(db => {
          const state = findBurst(db, circleId, burstId)?.notification;
          if (state?.deleteClaim === claimId) Object.assign(state, { status: 'deleted', deletedAt: clock(now), deleteReason: 'read', deleteClaimUntil: 0, deleteRetryAt: 0, deleteError: '' });
        });
        await flush();
        return { deleted: 1, failed: 0, pending: 0 };
      } catch (error) {
        const expired = await store.run(db => {
          const state = findBurst(db, circleId, burstId)?.notification;
          if (state?.deleteClaim !== claimId || state.deletedAt) return false;
          const unavailable = /message (?:can(?:not|'t)|cannot) be deleted/i.test(String(error?.telegramDescription || error?.description || error?.message || ''));
          if (unavailable) Object.assign(state, { status: 'expired', deleteExpiredAt: clock(now), deleteReason: 'telegram-delete-unavailable', deleteClaimUntil: 0, deleteRetryAt: 0 });
          else Object.assign(state, { status: 'sent', deleteClaimUntil: 0, deleteRetryAt: clock(now) + RETRY_MS, deleteError: 'telegram-reaction-delete-failed' });
          return unavailable;
        });
        await flush().catch(() => {});
        if (expired) return { deleted: 0, failed: 0, pending: 0, expired: 1 };
        await ensureScheduled(circleId, burstId, at);
        return { deleted: 0, failed: 1, pending: 1 };
      }
    })();
    deletions.set(key, work);
    try { return await work; } finally { if (deletions.get(key) === work) deletions.delete(key); }
  }

  async function processOne(circleId, burstId, at) {
    const key = keyFor(circleId, burstId);
    if (inflight.has(key)) { await inflight.get(key); return { sent: 0, failed: 0, pending: 0 }; }
    const work = (async () => {
      const burst = await store.run(db => structuredClone(findBurst(db, circleId, burstId) || null));
      if (!burst) return { sent: 0, failed: 0, pending: 0 };
      if (needsDeletion(burst.notification)) return { sent: 0, ...await deleteOne(circleId, burstId, at) };
      if (terminal(burst.notification)) return { sent: 0, failed: 0, pending: 0 };
      if (Number(burst.dueAt) > at) {
        await ensureScheduled(circleId, burstId, at);
        const state = typeof enqueueTask === 'function' ? await store.run(db => structuredClone(findBurst(db, circleId, burstId)?.notification || {})) : null;
        // Return a retryable worker result if replacing an early task failed.
        // A 2xx here would acknowledge the only durable wake-up prematurely.
        const failed = state && !terminal(state) && Number(state.enqueuedFor || 0) <= at && Number(state.scheduleClaimUntil || 0) <= at ? 1 : 0;
        return { sent: 0, failed, pending: 1 };
      }
      return sendOne(circleId, burstId, at);
    })();
    inflight.set(key, work);
    try { return await work; } finally { if (inflight.get(key) === work) inflight.delete(key); }
  }

  async function armTimer() {
    if (!localTimers || closed || !telegram) return;
    if (timer) clearTimeout(timer);
    timer = null;
    const at = clock(now);
    const next = await store.run(db => {
      const deadlines = Object.values(db.circles || {}).flatMap(circle => (circle.reactionBursts || []).filter(item => (!terminal(item.notification) || needsDeletion(item.notification)) && item.lastAt > at - TTL).map(item => needsDeletion(item.notification)
        ? Math.max(at, Number(item.notification?.deleteRetryAt || 0), Number(item.notification?.deleteClaimUntil || 0))
        : Math.max(Number(item.dueAt), Number(item.notification?.retryAt || 0), Number(item.notification?.claimUntil || 0))));
      return deadlines.length ? Math.min(...deadlines) : null;
    });
    if (next === null || closed) return;
    timer = setTimeout(() => { timer = null; void tick().catch(() => armTimer()); }, Math.min(2147483647, Math.max(20, next - clock(now))));
    timer.unref?.();
  }

  async function afterReaction({ circleId, burstId } = {}) {
    if (!circleId || !burstId || closed) return { scheduled: false };
    const scheduled = await ensureScheduled(circleId, burstId);
    await armTimer();
    return { scheduled };
  }

  async function afterAcknowledgement({ circleId, burstIds = [] } = {}) {
    const result = { deleted: 0, failed: 0, pending: 0 };
    if (!circleId || !Array.isArray(burstIds) || closed) return result;
    for (const burstId of new Set(burstIds)) {
      const removal = await deleteOne(circleId, burstId, clock(now));
      result.deleted += removal.deleted; result.failed += removal.failed; result.pending += removal.pending;
    }
    await armTimer();
    return result;
  }

  async function deliver({ circleId, burstId, scheduledFor, at = clock(now) } = {}) {
    if (!circleId || !burstId || closed) return { ok: true, sent: 0, failed: 0, pending: 0 };
    // A delayed/duplicated old task must not erase the marker of a newer task.
    if (Number.isFinite(Number(scheduledFor))) await store.run(db => {
      const state = findBurst(db, circleId, burstId)?.notification;
      if (state && Number(state.enqueuedFor) === Number(scheduledFor)) state.enqueuedFor = 0;
    });
    const result = await processOne(circleId, burstId, Number(at));
    await armTimer();
    return { ok: !result.failed, ...result };
  }

  async function tick({ at = clock(now) } = {}) {
    if (closed) return { ok: true, sent: 0, failed: 0, pending: 0 };
    const items = await store.run(db => Object.values(db.circles || {}).flatMap(circle => {
      for (const burst of circle.reactionBursts || []) reconcileReactionReadState(circle, burst, Number(at));
      return (circle.reactionBursts || []).filter(item => !terminal(item.notification) || needsDeletion(item.notification)).map(item => ({ circleId: circle.id, burstId: item.id }));
    }));
    const totals = { ok: true, sent: 0, failed: 0, pending: 0, deleted: 0 };
    for (const item of items) {
      const result = await processOne(item.circleId, item.burstId, Number(at));
      totals.sent += result.sent; totals.failed += result.failed; totals.pending += result.pending;
      totals.deleted += result.deleted || 0;
    }
    totals.ok = totals.failed === 0;
    await armTimer();
    return totals;
  }

  async function close() {
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    await Promise.allSettled([...inflight.values(), ...scheduling.values(), ...deletions.values()]);
  }

  return { afterReaction, afterAcknowledgement, deliver, tick, close, start: armTimer, cloudTasks: typeof enqueueTask === 'function' };
}

/** No new SDK dependency: the already-installed GoogleAuth signs REST calls. */
export function createCloudTasksReactionQueue({
  project = process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT_ID || '',
  location = process.env.REACTION_TASKS_LOCATION || 'asia-northeast1',
  queue = process.env.REACTION_TASKS_QUEUE || '',
  publicUrl = process.env.PUBLIC_URL || '',
  cronSecret = process.env.CRON_SECRET || '',
  serviceAccountEmail = process.env.REACTION_TASKS_SERVICE_ACCOUNT || '',
  auth,
} = {}) {
  if (!project || !queue || !publicUrl || !cronSecret) return null;
  if (![project, location, queue].every(value => /^[a-zA-Z0-9_-]+$/.test(value))) throw new TypeError('Invalid reaction task queue configuration');
  const base = new URL(publicUrl);
  if (base.protocol !== 'https:' || base.username || base.password) throw new TypeError('Reaction task callback requires an HTTPS public URL');
  const callback = new URL('/api/cron/reactions', base).href;
  const parent = `projects/${project}/locations/${location}/queues/${queue}`;
  const google = auth || new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  let client;
  return async ({ circleId, burstId, scheduledFor }) => {
    if (typeof circleId !== 'string' || typeof burstId !== 'string' || !Number.isSafeInteger(scheduledFor)) throw new TypeError('Invalid reaction task');
    const payload = { circleId, burstId, scheduledFor };
    const taskId = `reaction-${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
    const task = {
      name: `${parent}/tasks/${taskId}`,
      scheduleTime: new Date(scheduledFor).toISOString(),
      dispatchDeadline: '60s',
      httpRequest: { httpMethod: 'POST', url: callback, headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': cronSecret }, body: Buffer.from(JSON.stringify(payload)).toString('base64') },
    };
    if (serviceAccountEmail) task.httpRequest.oidcToken = { serviceAccountEmail, audience: base.origin };
    client ||= await google.getClient();
    try { return (await client.request({ url: `https://cloudtasks.googleapis.com/v2/${parent}/tasks`, method: 'POST', data: { task }, timeout: 10000 })).data; }
    catch (error) {
      // Named tasks are deduplicated by Cloud Tasks, including short-lived
      // tombstones after completion. The existing task owns the delivery.
      if (Number(error?.response?.status || error?.code) === 409) return { name: task.name, duplicate: true };
      throw new Error('reaction-task-enqueue-failed');
    }
  };
}
