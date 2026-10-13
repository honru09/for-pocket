import { randomUUID } from 'node:crypto';
import { CURRENCIES, isBudgetEntry, resolveLanguage } from './public/shared.mjs';

/**
 * The three small life updates sent by the scheduler.  All boundaries are
 * local wall-clock boundaries; converting them once here keeps DST and
 * cross-country ledgers from leaking into each other's reports.
 */
export const DIGEST_SLOTS = Object.freeze({
  morning: { hour: 10, focus: 'last night and the early morning' },
  noon: { hour: 13, focus: 'the lunch rush' },
  evening: { hour: 20, focus: 'the whole day' },
});
export const DEFAULT_DIGEST_TIMEZONE = 'Asia/Tokyo';

const SLOT_NAMES = new Set(Object.keys(DIGEST_SLOTS));
const LANGUAGE_NAMES = { zh: 'Simplified Chinese', en: 'English', uk: 'Ukrainian' };

function asDate(value) {
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  if (Number.isFinite(timestamp)) return new Date(timestamp);
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function asTimestamp(value) {
  const direct = value instanceof Date ? value.getTime() : Number(value);
  if (Number.isFinite(direct)) return direct;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function safeDigestTimezone(value, fallback = DEFAULT_DIGEST_TIMEZONE) {
  const candidates = [value, fallback, DEFAULT_DIGEST_TIMEZONE, 'UTC'];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      new Intl.DateTimeFormat('en', { timeZone: candidate }).format();
      return candidate.trim();
    } catch {}
  }
  return 'UTC';
}

export function localDateParts(value, timezone = DEFAULT_DIGEST_TIMEZONE) {
  const date = asDate(value) || new Date();
  const zone = safeDigestTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
  };
}

function shiftLocalDay(day, offset) {
  const value = new Date(`${day}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

// Pick the first occurrence of an overlapping wall time. For a clock gap,
// move forward by the gap, matching calendar-time "compatible" behavior.
// Sampling surrounding offsets also handles zones whose transition is at
// midnight: a day can start at 01:00 without losing its first recorded hour.
function boundary(day, hour, timezone) {
  const target = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`);
  if (!Number.isFinite(target)) return NaN;
  const wall = instant => {
    const parts = localDateParts(instant, timezone);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  };
  const offsets = new Set();
  for (let delta = -72; delta <= 72; delta += 6) {
    const instant = target + delta * 3600000;
    offsets.add(wall(instant) - instant);
  }
  const candidates = [...offsets].map(offset => target - offset);
  const exact = candidates.filter(instant => wall(instant) === target).sort((a, b) => a - b);
  if (exact.length) return exact[0];
  const following = candidates.map(instant => ({ instant, delta: wall(instant) - target }))
    .filter(item => item.delta > 0).sort((a, b) => a.delta - b.delta || a.instant - b.instant);
  return following[0]?.instant ?? NaN;
}

/** Return the half-open UTC window represented by one local digest slot. */
export function getDigestWindow(slot, now = Date.now(), timezone = DEFAULT_DIGEST_TIMEZONE) {
  if (!SLOT_NAMES.has(slot)) throw new TypeError('Invalid digest slot');
  const zone = safeDigestTimezone(timezone);
  const local = localDateParts(now, zone);
  const today = local.date;
  const yesterday = shiftLocalDay(today, -1);
  let startDay = today, startHour = 0, endDay = today, endHour = DIGEST_SLOTS[slot].hour;
  if (slot === 'morning') { startDay = yesterday; startHour = 0; }
  if (slot === 'noon') { startHour = 10; }
  if (slot === 'evening') { startHour = 0; }
  const startMs = boundary(startDay, startHour, zone);
  const endMs = boundary(endDay, endHour, zone);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error('Invalid digest window');
  return {
    slot, timezone: zone, localDate: today,
    start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(),
    startMs, endMs, label: DIGEST_SLOTS[slot].focus,
  };
}

function memberMaps(db, ledgerId) {
  const circle = Object.values(db.circles || {}).find(item => item?.ledgerId === ledgerId);
  const ids = [...new Set(circle?.members?.length ? circle.members : (db.users?.[ledgerId] ? [ledgerId] : []))].filter(uid => db.users?.[uid]);
  const names = new Map();
  for (const uid of ids) {
    const user = db.users?.[uid];
    if (user?.name) names.set(`u_${uid}`, user.name);
    names.set(uid, user?.name || uid);
  }
  return { circle, ids, names };
}

function settingsTimezone(db, ledgerId, memberIds, fallback) {
  const ledger = db.ledgers?.[ledgerId];
  const candidates = [ledger?.settings?.timezone];
  for (const uid of memberIds) candidates.push(db.users?.[uid]?.settings?.timezone);
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try { new Intl.DateTimeFormat('en', { timeZone: candidate.trim() }).format(); return candidate.trim(); } catch {}
  }
  return safeDigestTimezone(fallback);
}

function labelForEntry(entry, settings) {
  return String(entry?.category?.label || settings?.categories?.find(item => item.id === entry?.categoryId)?.label || entry?.categoryId || 'other');
}

function payerForEntry(entry, names, settings) {
  const configured = settings?.consumers?.find(item => item.id === entry?.consumer);
  return configured?.name || entry?.member?.name || names.get(entry?.consumer) || entry?.consumer || '';
}

/**
 * Select ordinary expenses only. Transfers, reimbursements and deleted rows
 * stay visible in the ledger but are not treated as a consumption "gotcha".
 */
export function filterDigestEntries(entries, window, { settings = {}, names = new Map() } = {}) {
  const selected = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.deletedAt || entry.type === 'income' || !isBudgetEntry(entry)) continue;
    const date = asDate(entry.occurredAt || entry.createdAt);
    if (!date || date.getTime() < window.startMs || date.getTime() >= window.endMs) continue;
    const amountMinor = entry.amountMinor;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !Object.hasOwn(CURRENCIES, entry.currency)) continue;
    selected.push({
      id: entry.id, amountMinor, currency: entry.currency,
      amount: amountMinor / 10 ** CURRENCIES[entry.currency].digits,
      categoryId: entry.categoryId, category: labelForEntry(entry, settings),
      merchant: String(entry.merchant || '').slice(0, 120),
      note: String(entry.note || '').slice(0, 160),
      payerId: entry.consumer,
      payer: payerForEntry(entry, names, settings),
      occurredAt: date.toISOString(), localTime: new Intl.DateTimeFormat('en-GB', { timeZone: window.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date),
    });
  }
  return selected.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

function compactAggregate(records) {
  const totals = new Map(), categories = new Map(), payers = new Map();
  for (const item of records) {
    totals.set(item.currency, (totals.get(item.currency) || 0) + item.amountMinor);
    const categoryKey = JSON.stringify([item.categoryId || item.category, item.currency]);
    const payerKey = JSON.stringify([item.payerId || item.payer || '—', item.currency]);
    const category = categories.get(categoryKey) || { id: item.categoryId, name: item.category, count: 0, amountMinor: 0, currency: item.currency };
    category.count++; category.amountMinor += item.amountMinor; categories.set(categoryKey, category);
    const payer = payers.get(payerKey) || { id: item.payerId, name: item.payer || '—', count: 0, amountMinor: 0, currency: item.currency };
    payer.count++; payer.amountMinor += item.amountMinor; payers.set(payerKey, payer);
  }
  const money = (minor, currency) => {
    const digits = CURRENCIES[currency]?.digits ?? 0;
    return `${(minor / 10 ** digits).toFixed(digits)} ${currency}`;
  };
  return {
    count: records.length,
    totals: [...totals].map(([currency, amountMinor]) => ({ currency, amountMinor, amount: money(amountMinor, currency) })),
    // Rank within a currency only. A cent and a yen are never comparable.
    categories: [...categories.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.amountMinor - a.amountMinor).map(item => ({ ...item, amount: money(item.amountMinor, item.currency) })),
    payers: [...payers.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.amountMinor - a.amountMinor).map(item => ({ ...item, amount: money(item.amountMinor, item.currency) })),
  };
}

function focusForSlot(slot, language) {
  const copy = {
    zh: { morning: '重点看看昨晚的大餐、夜宵和今早谁先出手', noon: '重点看看午饭吃了什么、谁吃得太好', evening: '盘点全天总账，抓最高频或最大的一笔' },
    en: { morning: 'check last night\'s feasts and who made the first move this morning', noon: 'peek at lunch and who ate suspiciously well', evening: 'wrap up the day and catch the biggest or most frequent spend' },
    uk: { morning: 'перевірити вчорашню вечерю та хто першим витратився зранку', noon: 'підглянути за обідом і тим, хто їв занадто добре', evening: 'підбити день і спіймати найбільшу або найчастішу витрату' },
  };
  return copy[language]?.[slot] || copy.zh[slot];
}

export function digestPrompt({ slot, window, records, language = 'zh', names = [] } = {}) {
  const lang = resolveLanguage(language, 'zh');
  const aggregate = compactAggregate(records || []);
  const languageName = LANGUAGE_NAMES[lang];
  return `Write one short plain-text life-ledger message in ${languageName}. You are the two people’s cheeky, curious friend who sits on their shoulder and watches ordinary spending. Sound like a real friend: playful, nosy, lightly teasing, never cruel. Naturally use one or two of 哇哦, 咳咳, 竟然, 让我来看看..., 哼哼, 额..., 等一下..., 抓到了！ when writing Chinese; use natural equivalents in English or Ukrainian rather than translating Chinese filler. Never use a heading, bullet list, markdown, greeting formula, financial jargon, budget advice, moral lesson, fake warmth, self-introduction, or the words AI/model/assistant. Call members by their exact nicknames when useful. Keep one compact paragraph around 60–110 characters/words appropriate for the language. Use only the verified records below; do not invent a shop, meal, emotion, weather, relationship, or amount. If count is zero, make a funny zero-spend ‘修仙 mode’ observation. Focus: ${focusForSlot(slot, lang)}. Window: ${window.start} to ${window.end} (${window.timezone}). Members: ${JSON.stringify(names)}. Verified aggregate: ${JSON.stringify(aggregate)}. Records: ${JSON.stringify(records || [])}`;
}

export function emptyDigestText(language = 'zh') {
  const lang = resolveLanguage(language, 'zh');
  if (lang === 'en') return 'Um... rubbing my eyes. Not a single expense in this window?! Wow, are you two photosynthesizing at home? The wallet is untouched, so I caught nothing today, hmph.';
  if (lang === 'uk') return 'Ем... протираю очі. У цьому вікні жодного запису?! Вау, ви там фотосинтезуєте? Гаманець цілий, тож сьогодні мені нічого ловити, хм.';
  return '额……揉了揉眼睛。这个时段竟然一笔账都没记？！哇哦，两位是在家光合作用修仙吗？钱包君毫发无损，今天居然抓不到把柄，哼。';
}

function fallbackDigestText(slot, records, language, names = []) {
  if (!records.length) return emptyDigestText(language);
  const lang = resolveLanguage(language, 'zh');
  const aggregate = compactAggregate(records);
  const top = aggregate.categories[0];
  const total = aggregate.totals[0];
  const payer = aggregate.payers[0];
  if (lang === 'en') return `Wow, ${aggregate.count} spend${aggregate.count === 1 ? '' : 's'} showed up: ${total?.amount || ''}. ${top?.name || 'Something'} is leading the parade${top?.count > 1 ? ` with ${top.count} visits` : ''}, and ${payer?.name || names[0] || 'someone'} got caught first, hmph.`.trim();
  if (lang === 'uk') return `Вау, у вікні ${aggregate.count} витрат на ${total?.amount || ''}. Попереду — ${top?.name || 'щось цікаве'}${top?.count > 1 ? ` (${top.count} разів)` : ''}, а ${payer?.name || names[0] || 'хтось'} уже попався, хм.`.trim();
  return `哇哦，这个时段抓到 ${aggregate.count} 笔，共 ${total?.amount || ''}。${top?.name || '某项消费'}${top?.count > 1 ? `竟然来了 ${top.count} 次` : ''}领跑，${payer?.name || names[0] || '某位'}先被抓到了，哼哼。`;
}

function telegramIds(db, memberIds) {
  const result = new Map();
  const add = (chatId, uid, language, { preferLanguage = false } = {}) => {
    const key = String(chatId ?? '').trim();
    if (!key || key.length > 64) return;
    const existing = result.get(key);
    // Telegram preferences capture the language used in the latest private
    // message. Prefer that over a stale profile setting when both sources
    // identify the same chat, while retaining the profile fallback for old
    // data that predates persisted preferences.
    if (!existing || preferLanguage || (!existing.language && language)) result.set(key, { chatId: key, uid, language });
  };
  const memberSet = new Set(memberIds);
  for (const [identity, uid] of Object.entries(db.identities || {})) {
    if (identity.startsWith('telegram:') && memberSet.has(uid)) add(identity.slice(9), uid, db.users?.[uid]?.settings?.language);
  }
  const state = db.telegram || {};
  for (const pool of [state.preferences, state.drafts, state.locations, state.updates]) {
    for (const [key, item] of Object.entries(pool || {})) {
      // preferences are keyed by uid and deliberately omit a redundant uid;
      // drafts/locations normally carry it explicitly.
      const uid = item?.uid || item?.userId || item?.locationEntry?.uid || (pool === state.preferences && key);
      if (!memberSet.has(uid)) continue;
      const chatId = item?.chatId || item?.chat_id || item?.telegramChatId || item?.editingChatId || item?.locationEntry?.chatId;
      if (chatId !== undefined) add(chatId, uid, item?.language || db.users?.[uid]?.settings?.language, { preferLanguage: pool === state.preferences && Boolean(item?.language) });
    }
  }
  return [...result.values()];
}

function ledgerContexts(db, defaultTimezone) {
  const contexts = [];
  for (const [ledgerId, ledger] of Object.entries(db.ledgers || {})) {
    if (!ledger || !Array.isArray(ledger.expenses)) continue;
    const circle = Object.values(db.circles || {}).find(item => item?.ledgerId === ledgerId);
    if (circle && !circle.members?.some(uid => db.users?.[uid]?.activeCircleId === circle.id)) continue;
    // A personal ledger retained after joining a circle is historical, not an
    // active destination. Only the circle ledger should receive a digest.
    const owner = db.users?.[ledgerId];
    if (!circle
      && owner?.activeCircleId && db.circles?.[owner.activeCircleId]?.members?.includes(ledgerId)) continue;
    const { ids, names } = memberMaps(db, ledgerId);
    if (!ids.length) continue;
    const timezone = settingsTimezone(db, ledgerId, ids, defaultTimezone);
    const settings = ledger.settings || {};
    contexts.push({ ledgerId, ledger, ids, names, settings, timezone, recipients: telegramIds(db, ids) });
  }
  return contexts;
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
    if (!response.ok || !payload?.ok) throw new Error(`Telegram ${method} failed`);
    return payload.result;
  };
}

/** Create the scheduler-facing service. It is deliberately independent from HTTP. */
export function createDigestService({ store, summarizer, callTelegram, token = '', now = () => Date.now(), defaultTimezone = DEFAULT_DIGEST_TIMEZONE, leaseMs = 120000 } = {}) {
  if (!store || typeof store.run !== 'function') throw new TypeError('Digest service requires a store');
  const telegram = telegramCaller(token, callTelegram);

  async function claim(ledgerId, slot, localDate, at) {
    const tokenValue = randomUUID();
    const result = await store.run(db => {
      db.cron ||= {};
      db.cron.digests ||= {};
      const key = `${ledgerId}:${localDate}:${slot}`;
      const previous = db.cron.digests[key];
      if (previous?.status === 'sent') return { duplicate: true, key };
      if (previous?.status === 'processing' && Number(previous.leaseUntil) > at) return { duplicate: true, busy: true, key };
      db.cron.digests[key] = { status: 'processing', leaseUntil: at + leaseMs, claimedAt: at, token: tokenValue };
      return { key, token: tokenValue };
    });
    return result;
  }

  async function finish(key, tokenValue, patch) {
    await store.run(db => {
      const item = db.cron?.digests?.[key];
      if (item?.token === tokenValue) Object.assign(item, patch);
    });
  }

  async function one(context, slot, at) {
    const window = getDigestWindow(slot, at, context.timezone);
    const claimResult = await claim(context.ledgerId, slot, window.localDate, at);
    if (claimResult.duplicate) return { ledgerId: context.ledgerId, slot, timezone: context.timezone, localDate: window.localDate, skipped: true, reason: claimResult.busy ? 'processing' : 'already-sent' };
    const records = filterDigestEntries(context.ledger.expenses, window, { settings: context.settings, names: context.names });
    const aggregate = compactAggregate(records);
    const languageByRecipient = new Map();
    for (const recipient of context.recipients) {
      const language = resolveLanguage(recipient.language || context.settings.language, 'zh');
      if (!languageByRecipient.has(language)) languageByRecipient.set(language, []);
      languageByRecipient.get(language).push(recipient);
    }
    if (!languageByRecipient.size) languageByRecipient.set(resolveLanguage(context.settings.language, 'zh'), []);
    const generated = {};
    let modelGenerated = false;
    const deliveries = [];
    let deliveryFailed = false;
    try {
      for (const [language, recipients] of languageByRecipient) {
        let text = '';
        if (records.length && typeof summarizer?.summarize === 'function' && summarizer.enabled !== false) {
          try {
            const value = await summarizer.summarize({ prompt: digestPrompt({ slot, window, records, language, names: context.ids.map(uid => context.names.get(uid) || uid) }), slot, language, window, records });
            text = String(typeof value === 'object' && value ? value.text || '' : value || '').trim();
            if (text) modelGenerated = true;
          } catch {}
        }
        if (!text) text = fallbackDigestText(slot, records, language, context.ids.map(uid => context.names.get(uid) || uid));
        generated[language] = text.slice(0, 3900);
        if (telegram) {
          for (const recipient of recipients) {
            const recipientKey = recipient.chatId;
            const checkpoint = await store.run(db => {
              db.cron ||= {}; db.cron.digestDeliveries ||= {};
              const key = `${claimResult.key}:${recipientKey}`;
              const item = db.cron.digestDeliveries[key];
              if (item?.status === 'sent') return { key, sent: true };
              db.cron.digestDeliveries[key] = { status: 'sending', digestKey: claimResult.key, chatId: recipientKey, startedAt: at };
              return { key, sent: false };
            });
            if (!checkpoint.sent) {
              let recipientStatus = 'sent';
              try {
                const response = await telegram('sendMessage', { chat_id: recipient.chatId, text: generated[language], disable_notification: true });
                await store.run(db => {
                  const item = db.cron?.digestDeliveries?.[checkpoint.key];
                  if (item) Object.assign(item, { status: 'sent', sentAt: at, messageId: response?.message_id ?? null });
                });
              } catch (error) {
                recipientStatus = 'failed';
                deliveryFailed = true;
                await store.run(db => {
                  const item = db.cron?.digestDeliveries?.[checkpoint.key];
                  if (item) Object.assign(item, { status: 'failed', failedAt: at, error: String(error?.message || 'delivery-failed').slice(0, 160) });
                });
              }
              deliveries.push({ chatId: recipientKey, status: recipientStatus });
            } else {
              deliveries.push({ chatId: recipientKey, status: 'sent' });
            }
          }
        }
      }
      // A failed recipient leaves its per-chat checkpoint retryable. Keep the
      // slot claim open only when every recipient succeeded (or none exists).
      if (deliveryFailed) {
        await finish(claimResult.key, claimResult.token, { status: 'failed', failedAt: at, recipients: deliveries });
      } else {
        await finish(claimResult.key, claimResult.token, { status: 'sent', sentAt: at, recipients: deliveries });
      }
    } catch (error) {
      await finish(claimResult.key, claimResult.token, { status: 'failed', failedAt: at, error: String(error?.message || 'delivery-failed').slice(0, 160) });
      throw error;
    }
    const firstLanguage = Object.keys(generated)[0] || 'zh';
    return { ledgerId: context.ledgerId, slot, timezone: context.timezone, localDate: window.localDate, window: { start: window.start, end: window.end }, count: records.length, aggregate, text: generated[firstLanguage], generated: modelGenerated, recipients: deliveries, skipped: false, deliveryFailed };
  }

  async function processSlot(slot, { ledgerId = '', at = now() } = {}) {
    if (!SLOT_NAMES.has(slot)) throw new TypeError('Invalid digest slot');
    at = asTimestamp(at);
    const contexts = await store.run(db => ledgerContexts(db, defaultTimezone).filter(item => !ledgerId || item.ledgerId === ledgerId).map(item => ({ ...item, ledger: structuredClone(item.ledger), settings: structuredClone(item.settings), ids: [...item.ids], names: new Map(item.names) })));
    const results = [];
    for (const context of contexts) results.push(await one(context, slot, at));
    return { ok: true, slot, at: new Date(at).toISOString(), results, delivered: results.filter(item => !item.skipped).length, skipped: results.filter(item => item.skipped).length };
  }

  async function tick({ at = now() } = {}) {
    at = asTimestamp(at);
    const contexts = await store.run(db => ledgerContexts(db, defaultTimezone).map(item => ({ ledgerId: item.ledgerId, timezone: item.timezone })));
    const results = [];
    for (const context of contexts) {
      const local = localDateParts(at, context.timezone);
      const slot = Object.entries(DIGEST_SLOTS).find(([, value]) => value.hour === local.hour)?.[0];
      if (!slot) continue;
      results.push(await processSlot(slot, { ledgerId: context.ledgerId, at }));
    }
    return { ok: true, at: new Date(at).toISOString(), results, triggered: results.length };
  }

  return { processSlot, tick, window: getDigestWindow, contexts: async () => store.run(db => ledgerContexts(db, defaultTimezone)) };
}

export { compactAggregate };
