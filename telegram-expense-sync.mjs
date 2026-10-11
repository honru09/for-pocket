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
  const circle = Object.values(db.circles || {}).find(item => item?.ledgerId === ledgerId);
  return circle?.members?.length ? circle.members : db.users?.[ledgerId] ? [ledgerId] : [];
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
  if (lang === 'en') return `${payer || 'Someone'} spent ${amount}${category ? ` · ${category}` : ''}${entry?.note ? ` · ${String(entry.note).slice(0, 80)}` : ''}`;
  if (lang === 'uk') return `${payer || 'Хтось'} витратив ${amount}${category ? ` · ${category}` : ''}${entry?.note ? ` · ${String(entry.note).slice(0, 80)}` : ''}`;
  return `${payer || '有人'} 花了 ${amount}${category ? ` · ${category}` : ''}${entry?.note ? ` · ${String(entry.note).slice(0, 80)}` : ''}`;
}

/**
 * Sends quiet companion messages and keeps only Telegram message references in
 * db.telegram, so the web ledger never exposes chat IDs to the browser.
 */
export function createTelegramExpenseSync({ store, token = '', callTelegram, now = () => Date.now() } = {}) {
  if (!store || typeof store.run !== 'function') throw new TypeError('Expense sync requires a store');
  const telegram = callTelegramFactory(token, callTelegram);

  async function notify(entry, { excludeChatId = '' } = {}) {
    if (!telegram || !entry?.id || entry.deletedAt) return { sent: 0, skipped: true };
    const snapshot = await store.run(db => {
      const state = ensureSyncState(db);
      const key = `${entry.ledgerId}:${entry.id}`;
      const existing = Array.isArray(state.expenseMessages[key]) ? state.expenseMessages[key] : [];
      const ledger = db.ledgers?.[entry.ledgerId];
      const actual = ledger?.expenses?.find(item => item.id === entry.id);
      if (!actual || actual.deletedAt) return { key, done: true, recipients: [] };
      const covered = new Set(existing.map(item => String(item.chatId)));
      const recipients = knownChats(db, entry.ledgerId).filter(item => !covered.has(String(item.chatId)));
      return { key, done: Boolean(existing.length && !recipients.length), recipients, actual: structuredClone(actual) };
    });
    if (snapshot.done) return { sent: 0, skipped: true };
    let sent = 0;
    for (const recipient of snapshot.recipients) {
      if (excludeChatId && String(recipient.chatId) === String(excludeChatId)) continue;
      try {
        const result = await telegram('sendMessage', { chat_id: recipient.chatId, text: expenseNotificationText(snapshot.actual, recipient.language), disable_notification: true });
        const messageId = Number(result?.message_id);
        if (!Number.isSafeInteger(messageId) || messageId <= 0) continue;
        await store.run(db => {
          const state = ensureSyncState(db);
          const list = state.expenseMessages[snapshot.key] ||= [];
          if (!list.some(item => String(item.chatId) === String(recipient.chatId))) list.push({ chatId: String(recipient.chatId), messageId, sentAt: Number(typeof now === 'function' ? now() : now) || Date.now() });
        });
        sent++;
      } catch {}
    }
    return { sent, skipped: false };
  }

  async function sync(entry, action = 'edit') {
    if (!telegram || !entry?.id || !entry?.ledgerId) return { synced: 0 };
    const key = `${entry.ledgerId}:${entry.id}`;
    const bindings = await store.run(db => structuredClone(ensureSyncState(db).expenseMessages[key] || []));
    let synced = 0;
    for (const binding of bindings) {
      try {
        if (action === 'delete') await telegram('deleteMessage', { chat_id: binding.chatId, message_id: binding.messageId });
        else {
          const language = await store.run(db => {
            const uid = db.identities?.[`telegram:${binding.chatId}`];
            return resolveLanguage(db.telegram?.preferences?.[uid]?.language || db.users?.[uid]?.settings?.language, 'zh');
          });
          await telegram('editMessageText', { chat_id: binding.chatId, message_id: binding.messageId, text: expenseNotificationText(entry, language) });
        }
        synced++;
      } catch {}
    }
    if (action === 'delete') await store.run(db => { const state = ensureSyncState(db); delete state.expenseMessages[key]; });
    return { synced };
  }

  return { notify, sync };
}
