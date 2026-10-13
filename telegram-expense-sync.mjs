import { CURRENCIES, resolveLanguage } from './public/shared.mjs';

const TELEGRAM_ID = /^-?\d{1,20}$/;

function safeChat(value) {
  const text = String(value ?? '').trim();
  return TELEGRAM_ID.test(text) ? text : '';
}

function callTelegramFactory(token, custom) {
  if (custom) return custom;
  if (!token) return null;
  return async (method, parameters) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parameters), signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(`Telegram ${method} failed`);
    return payload.result;
  };
}

function ensureSyncState(db) {
  db.telegram ||= {};
  db.telegram.expenseMessages ||= {};
  db.telegram.preferences ||= {};
  return db.telegram;
}

function memberIds(db, ledgerId) {
  // A personal ledger must never fan out a notification.  Only a ledger that
  // is currently owned by a circle has a defined set of recipients.  Keeping
  // this boundary here also protects callers that accidentally pass a stale
  // or user owned entry into the sync helper.
  const circle = Object.values(db.circles || {}).find(item => item?.ledgerId === ledgerId);
  if (!circle?.members?.length) return [];
  return [...new Set(circle.members)].filter(id => db.users?.[id]);
}

function knownChats(db, ledgerId) {
  const ids = new Set(memberIds(db, ledgerId));
  const result = new Map();
  for (const uid of ids) {
    const preference = db.telegram?.preferences?.[uid];
    const chatId = safeChat(preference?.chatId);
    if (chatId) result.set(chatId, { chatId, uid, language: resolveLanguage(preference?.language || db.users?.[uid]?.settings?.language, 'zh') });
  }
  return [...result.values()];
}

function amountText(entry) {
  const currency = CURRENCIES[entry?.currency] || CURRENCIES.JPY;
  const digits = currency.digits;
  return `${currency.symbol}${(Number(entry?.amountMinor || 0) / 10 ** digits).toFixed(digits)} ${entry?.currency || 'JPY'}`;
}

export function expenseNotificationText(entry, language = 'zh') {
  const lang = resolveLanguage(language, 'zh');
  const payer = entry?.member?.name || entry?.consumer || '';
  const category = entry?.category?.label || entry?.categoryId || '';
  const amount = amountText(entry);
  const suffix = `${category ? ` · ${category}` : ''}${entry?.note ? ` · ${String(entry.note).slice(0, 80)}` : ''}`;
  const kind = entry?.type === 'income' ? 'income' : entry?.recordKind;
  if (lang === 'en') {
    if (kind === 'income') return `${payer || 'Someone'} received ${amount}${suffix}`;
    if (kind === 'transfer' || kind === 'reimbursement') return `${payer || 'Someone'} recorded a ${kind} of ${amount}${suffix}`;
    return `${payer || 'Someone'} spent ${amount}${suffix}`;
  }
  if (lang === 'uk') {
    if (kind === 'income') return `${payer || 'Хтось'} отримав ${amount}${suffix}`;
    if (kind === 'transfer' || kind === 'reimbursement') return `${payer || 'Хтось'} записав: ${kind === 'transfer' ? 'переказ' : 'відшкодування'} ${amount}${suffix}`;
    return `${payer || 'Хтось'} витратив ${amount}${suffix}`;
  }
  if (kind === 'income') return `${payer || '有人'} 收到 ${amount}${suffix}`;
  if (kind === 'transfer' || kind === 'reimbursement') return `${payer || '有人'} 记了${kind === 'transfer' ? '一笔转账' : '一笔代付/报销'} ${amount}${suffix}`;
  return `${payer || '有人'} 花了 ${amount}${suffix}`;
}

/**
 * Sends quiet companion messages and keeps only Telegram message references in
 * db.telegram, so the web ledger never exposes chat IDs to the browser.
 */
export function createTelegramExpenseSync({ store, token = '', callTelegram, now = () => Date.now() } = {}) {
  if (!store || typeof store.run !== 'function') throw new TypeError('Expense sync requires a store');
  const telegram = callTelegramFactory(token, callTelegram);
  // Telegram has no idempotency key for sendMessage.  Serialize a recipient
  // locally and persist a short claim before sending so two web requests (or a
  // Telegram retry and a web request) cannot create duplicate companion cards.
  const inflight = new Map();
  const CLAIM_TTL = 2 * 60 * 1000;

  async function notify(entry, { excludeChatId = '', excludeUid = '' } = {}) {
    if (!telegram || !entry?.id || entry.deletedAt) return { sent: 0, skipped: true };
    const snapshot = await store.run(db => {
      const state = ensureSyncState(db);
      const key = `${entry.ledgerId}:${entry.id}`;
      const existing = Array.isArray(state.expenseMessages[key]) ? state.expenseMessages[key] : [];
      const ledger = db.ledgers?.[entry.ledgerId];
      const actual = ledger?.expenses?.find(item => item.id === entry.id);
      if (!actual || actual.deletedAt) return { key, done: true, recipients: [] };
      const covered = new Set(existing.filter(item => Number(item?.messageId) > 0 && !['failed', 'sending'].includes(item?.status)).map(item => String(item.chatId)));
      // A Telegram-authenticated request can identify the account that just
      // created the entry. Keep that account out of the companion fan-out even
      // when its chat is bound to the same circle. The chat-id exclusion is
      // retained for bot confirmations, where the sender chat is authoritative.
      const actorUid = String(excludeUid || '').trim();
      const recipients = knownChats(db, entry.ledgerId)
        .filter(item => !covered.has(String(item.chatId)))
        .filter(item => !actorUid || String(item.uid) !== actorUid);
      return { key, done: Boolean(existing.length && !recipients.length), recipients, actual: structuredClone(actual) };
    });
    if (snapshot.done) return { sent: 0, skipped: true };
    let sent = 0;
    for (const recipient of snapshot.recipients) {
      if (excludeChatId && String(recipient.chatId) === String(excludeChatId)) continue;
      const recipientKey = `${snapshot.key}:${recipient.chatId}`;
      const existingTask = inflight.get(recipientKey);
      if (existingTask) {
        // Another caller owns this send.  Wait for its result so a later
        // recipient in this call observes the persisted binding, but do not
        // report the other caller's successful delivery as our own send.
        await existingTask.catch(() => {});
        continue;
      }
      const task = sendToRecipient(snapshot, recipient);
      inflight.set(recipientKey, task);
      try { if (await task) sent++; } catch {} finally {
        if (inflight.get(recipientKey) === task) inflight.delete(recipientKey);
      }
    }
    return { sent, skipped: false };
  }

  async function sendToRecipient(snapshot, recipient) {
    const claimed = await store.run(db => {
      const state = ensureSyncState(db);
      const currentEntry = db.ledgers?.[snapshot.actual.ledgerId]?.expenses?.find(item => item.id === snapshot.actual.id);
      if (!currentEntry || currentEntry.deletedAt) return false;
      const list = state.expenseMessages[snapshot.key] ||= [];
      const current = list.find(item => String(item?.chatId) === String(recipient.chatId));
      const timestamp = Number(typeof now === 'function' ? now() : now) || Date.now();
      // Bindings written before status/lastText were introduced are known to
      // be successful because they already contain a Telegram message id.
      if (current && Number(current.messageId) > 0 && !['failed', 'sending'].includes(current.status)) return false;
      if (current?.status === 'sending' && Number(current.claimUntil) > timestamp) return false;
      const binding = current || { chatId: String(recipient.chatId) };
      Object.assign(binding, { status: 'sending', claimUntil: timestamp + CLAIM_TTL, attempts: Number(binding.attempts || 0) + 1, lastError: '' });
      if (!current) list.push(binding);
      return true;
    });
    if (!claimed) return false;
    try {
      const result = await telegram('sendMessage', { chat_id: recipient.chatId, text: expenseNotificationText(snapshot.actual, recipient.language), disable_notification: true });
      const messageId = Number(result?.message_id);
      if (!Number.isSafeInteger(messageId) || messageId <= 0) throw new Error('Telegram returned no message id');
      await store.run(db => {
        const list = ensureSyncState(db).expenseMessages[snapshot.key] || [];
        const binding = list.find(item => String(item?.chatId) === String(recipient.chatId));
        if (binding) Object.assign(binding, { status: 'sent', messageId, sentAt: Number(typeof now === 'function' ? now() : now) || Date.now(), claimUntil: 0, lastError: '', lastText: expenseNotificationText(snapshot.actual, recipient.language) });
      });
      return true;
    } catch (error) {
      // Keep the binding so the next invocation retries.  A failed send must
      // never make the system believe that this recipient is synchronized.
      await store.run(db => {
        const list = ensureSyncState(db).expenseMessages[snapshot.key] || [];
        const binding = list.find(item => String(item?.chatId) === String(recipient.chatId));
        if (binding) Object.assign(binding, { status: 'failed', claimUntil: 0, lastError: String(error?.message || 'telegram-send-failed').slice(0, 160) });
      }).catch(() => {});
      return false;
    }
  }

  async function sync(entry, action = 'edit') {
    if (!telegram || !entry?.id || !entry?.ledgerId) return { synced: 0 };
    const key = `${entry.ledgerId}:${entry.id}`;
    const bindings = await store.run(db => structuredClone(ensureSyncState(db).expenseMessages[key] || []));
    let synced = 0;
    for (const binding of bindings) {
      if (!Number.isSafeInteger(Number(binding?.messageId)) || Number(binding.messageId) <= 0) continue;
      let editText = '';
      if (action !== 'delete') {
        const language = await store.run(db => {
          const uid = db.identities?.[`telegram:${binding.chatId}`];
          return resolveLanguage(db.telegram?.preferences?.[uid]?.language || db.users?.[uid]?.settings?.language, 'zh');
        });
        editText = expenseNotificationText(entry, language);
        // A retry of the same edit only needs to revisit bindings whose prior
        // call failed.  A genuinely changed record produces a different text
        // and updates every recipient once.
        if (binding.status === 'sent' && binding.lastText === editText) continue;
      }
      try {
        if (action === 'delete') await telegram('deleteMessage', { chat_id: binding.chatId, message_id: binding.messageId });
        else await telegram('editMessageText', { chat_id: binding.chatId, message_id: binding.messageId, text: editText });
        synced++;
        await store.run(db => {
          const state = ensureSyncState(db), list = state.expenseMessages[key] || [];
          const current = list.find(item => String(item?.chatId) === String(binding.chatId) && Number(item?.messageId) === Number(binding.messageId));
          if (current) {
            if (action === 'delete') list.splice(list.indexOf(current), 1);
            else Object.assign(current, { status: 'sent', lastSyncedAt: Number(typeof now === 'function' ? now() : now) || Date.now(), lastError: '', lastText: editText });
          }
          if (!list.length) delete state.expenseMessages[key];
        });
      } catch (error) {
        // Retain failed bindings and their message ids for a later retry.  In
        // particular, never clear a delete/edit binding merely because the
        // Bot API was temporarily unavailable.
        await store.run(db => {
          const current = (ensureSyncState(db).expenseMessages[key] || []).find(item => String(item?.chatId) === String(binding.chatId) && Number(item?.messageId) === Number(binding.messageId));
          if (current) Object.assign(current, { status: 'failed', lastError: String(error?.message || `telegram-${action}-failed`).slice(0, 160), lastAttemptAt: Number(typeof now === 'function' ? now() : now) || Date.now() });
        }).catch(() => {});
      }
    }
    return { synced };
  }

  return { notify, sync, retry: sync };
}
