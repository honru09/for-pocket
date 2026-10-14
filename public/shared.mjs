import { normalizeLocation } from './location.mjs';
import { DEFAULT_CATEGORIES, LEGACY_DEFAULT_CATEGORIES, sortCategoriesByUsage } from './category-presets.mjs';
import { normalizeCategorySuggestion } from './category-suggestions.mjs';

export const CURRENCIES = {
  JPY: { symbol: '¥', name: '日元', digits: 0 },
  CNY: { symbol: '¥', name: '人民币', digits: 2 },
  USD: { symbol: '$', name: '美元', digits: 2 },
  UAH: { symbol: '₴', name: '格里夫纳', digits: 2 },
  EUR: { symbol: '€', name: '欧元', digits: 2 },
  GBP: { symbol: '£', name: '英镑', digits: 2 },
  KRW: { symbol: '₩', name: '韩元', digits: 0 },
  TWD: { symbol: 'NT$', name: '新台币', digits: 2 },
  HKD: { symbol: 'HK$', name: '港元', digits: 2 },
  SGD: { symbol: 'S$', name: '新加坡元', digits: 2 },
  AUD: { symbol: 'A$', name: '澳元', digits: 2 },
  CAD: { symbol: 'C$', name: '加元', digits: 2 },
  CHF: { symbol: 'CHF', name: '瑞士法郎', digits: 2 },
};
export const ICONS = ['bowl', 'book', 'bag', 'game', 'plane', 'spark', 'heart', 'coffee', 'wallet', 'coins', 'gift', 'receipt', 'piggy', 'card', 'transfer', 'users', 'google', 'sprout', 'flower', 'star'];
export const COLORS = ['peach', 'blue', 'mint', 'pink', 'yellow', 'lavender'];
export const LANGUAGES = ['zh', 'en', 'uk'];
export const AVATARS = ['cloud', 'cat', 'bunny', 'bear', 'chick', 'fox', 'panda', 'coffee', 'flower', 'sprout', 'star'];
export const CONSUMER_COLORS = ['milk', 'blue', 'pink', 'mint', 'peach', 'yellow', 'lavender', 'sage'];
export const DEFAULT_CONSUMERS = [];
export const CONSUMERS = {};
export const MAX_CIRCLE_MEMBERS = 99;
export const MAX_CUSTOM_AVATAR_LENGTH = 256 * 1024;
export const MAX_RECURRING_EXPENSES = 64;
export const EMPTY_FIXED_CAPITAL = Object.freeze({
  enabled: false,
  incomesTotal: 0,
  expensesTotal: 0,
  savingsTarget: 0,
  dailyAllowance: 0,
  payday: null,
  lastCalculatedAt: null,
});
const MAX_FIXED_CAPITAL_MINOR = 10 ** 14;
export function isCustomAvatar(value) {
  return typeof value === 'string' && value.length <= MAX_CUSTOM_AVATAR_LENGTH
    && /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value);
}
// Keep transfers and repayments visible without inflating everyday spending.
export function isBudgetEntry(entry) {
  return !['transfer', 'reimbursement'].includes(entry?.recordKind);
}
export function validateUserProfile(value) {
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  if (!name || Array.from(name).length > 24) throw new Error('角色名称需为 1–24 个字。');
  if (!CONSUMER_COLORS.includes(value.color)) throw new Error('请选择有效的图标和颜色。');
  const avatar = value.avatar;
  if (!AVATARS.includes(avatar) && !(typeof avatar === 'string' && avatar.length <= 2048 && /^https:\/\//.test(avatar)) && !isCustomAvatar(avatar)) throw new Error('请选择有效的图标和颜色。');
  return { name, color: value.color, avatar };
}
export { DEFAULT_CATEGORIES, LEGACY_DEFAULT_CATEGORIES, sortCategoriesByUsage } from './category-presets.mjs';
export const MAX_CATEGORIES = 48;
export const DEFAULT_INCOME_CATEGORIES = [
  { id: 'wage', label: '工资', icon: 'wallet', color: 'mint' },
  { id: 'bonus', label: '奖金', icon: 'coins', color: 'yellow' },
  { id: 'redpacket', label: '红包', icon: 'gift', color: 'peach' },
  { id: 'parttime', label: '兼职', icon: 'sprout', color: 'blue' },
  { id: 'reimburse', label: '报销', icon: 'receipt', color: 'lavender' },
  { id: 'other_in', label: '其他入账', icon: 'spark', color: 'pink' },
];
export function resolveLanguage(code, fallback = 'zh') {
  if (!code || typeof code !== 'string') return fallback;
  const lower = code.toLowerCase().trim();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('uk')) return 'uk';
  if (lower.startsWith('en')) return 'en';
  return 'en';
}
export function initialSettings(lang = 'zh') {
  const language = LANGUAGES.includes(lang) ? lang : resolveLanguage(lang, 'zh');
  return {
    currency: 'JPY',
    // The scheduler uses the ledger's wall clock. Tokyo is the product's
    // initial fallback; the app synchronizes the device's timezone on opening.
    timezone: 'Asia/Tokyo',
    language,
    languageManual: false,
    categories: structuredClone(DEFAULT_CATEGORIES),
    incomeCategories: structuredClone(DEFAULT_INCOME_CATEGORIES),
    consumers: structuredClone(DEFAULT_CONSUMERS),
    recurringExpenses: [],
    fixedCapital: structuredClone(EMPTY_FIXED_CAPITAL),
    soundPack: 'off',
    theme: 'matcha',
  };
}

export function validateFixedCapital(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : EMPTY_FIXED_CAPITAL;
  const money = key => {
    const amount = input[key] === undefined ? 0 : input[key];
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_FIXED_CAPITAL_MINOR) throw new Error('自由金金额格式有误。');
    return amount;
  };
  const incomesTotal = money('incomesTotal');
  const expensesTotal = money('expensesTotal');
  const savingsTarget = money('savingsTarget');
  const dailyAllowance = money('dailyAllowance');
  if (expensesTotal + savingsTarget > incomesTotal) throw new Error('自由金收入、支出和储蓄目标需要留出可用余额。');
  const payday = input.payday == null || input.payday === '' ? null : Number(input.payday);
  if (payday !== null && (!Number.isInteger(payday) || payday < 1 || payday > 31)) throw new Error('自由金发薪日需为 1–31。');
  const lastCalculatedAt = input.lastCalculatedAt == null || input.lastCalculatedAt === '' ? null : String(input.lastCalculatedAt);
  if (lastCalculatedAt !== null && (lastCalculatedAt.length > 80 || !Number.isFinite(Date.parse(lastCalculatedAt)))) throw new Error('自由金计算时间有误。');
  const enabled = input.enabled === true;
  if (enabled && incomesTotal < 1) throw new Error('开启自由金前请先填写收入。');
  return { enabled, incomesTotal, expensesTotal, savingsTarget, dailyAllowance, payday, lastCalculatedAt };
}

/**
 * Parse a small, deliberately constrained addition expression.  The amount
 * keypad accepts digits, one decimal point per term, and plus signs only;
 * this keeps the feature predictable and avoids evaluating user input.
 */
export function parseAmountExpression(raw, currency = 'JPY') {
  const digits = CURRENCIES[currency]?.digits;
  if (!Number.isInteger(digits) || typeof raw !== 'string') return { valid: false, minor: 0, expression: '' };
  const expression = raw.replace(/[\uFF0B＋]/g, '+').replace(/[\uFF0E．]/g, '.').replace(/\s+/g, '');
  if (!expression || expression.length > 96 || !/^\d+(?:\.\d*)?(?:\+\d+(?:\.\d*)?)*$/.test(expression)) {
    return { valid: false, minor: 0, expression };
  }
  const terms = expression.split('+');
  let minor = 0;
  for (const term of terms) {
    const [whole, fraction = ''] = term.split('.');
    if (fraction.length > digits || !/^\d+$/.test(whole) || digits === 0 && fraction.length) return { valid: false, minor: 0, expression };
    const termMinor = Number(whole) * 10 ** digits + Number((fraction || '').padEnd(digits, '0') || 0);
    if (!Number.isSafeInteger(termMinor) || termMinor < 0 || minor > Number.MAX_SAFE_INTEGER - termMinor) return { valid: false, minor: 0, expression };
    minor += termMinor;
  }
  return { valid: Number.isSafeInteger(minor) && minor > 0, minor, expression, terms };
}

function validateRecurringExpense(item, settings, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('固定支出格式有误。');
  const id = typeof item.id === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(item.id) ? item.id : `recurring_${index + 1}`;
  const day = Number(item.day);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('固定支出日期需为 1–31。');
  if (!Object.hasOwn(CURRENCIES, item.currency || settings.currency) || !Number.isSafeInteger(item.amountMinor) || item.amountMinor < 1) throw new Error('固定支出金额有误。');
  const currency = item.currency || settings.currency;
  const pool = settings.categories || DEFAULT_CATEGORIES;
  const category = pool.find(c => c.id === item.categoryId) || pool.find(c => c.id === 'other') || pool[0];
  if (!category) throw new Error('固定支出用途有误。');
  const consumers = Array.isArray(settings.consumers) ? settings.consumers : DEFAULT_CONSUMERS;
  const consumer = consumers.some(c => c.id === item.consumer) ? item.consumer : consumers[0]?.id;
  if (!consumer) throw new Error('固定支出角色有误。');
  const note = typeof item.note === 'string' ? item.note.trim() : '';
  if (note.length > 160) throw new Error('备注最多 160 个字符。');
  return { id, day, amountMinor: item.amountMinor, currency, categoryId: category.id, consumer, note };
}
export function validateSettings(value) {
  // Existing six-category ledgers remain intact. New ledgers use the thirty
  // built-ins from initialSettings; validation never rewrites a user's list.
  const input = value || {};
  if (input?.language !== undefined && !LANGUAGES.includes(input.language)) throw new Error('请选择有效的语言。');
  const timezone = input?.timezone === undefined ? 'Asia/Tokyo' : input.timezone;
  if (typeof timezone !== 'string' || !timezone.trim() || timezone.length > 80) throw new Error('时区格式有误。');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw new Error('时区格式有误。'); }
  if (!value || !Object.hasOwn(CURRENCIES, input.currency) || !Array.isArray(input.categories)
    || input.categories.length < 1 || input.categories.length > MAX_CATEGORIES) throw new Error('请保留 1–48 个分类。');
  const ids = new Set();
  const labels = new Set();
  const categories = input.categories.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)
      || ids.has(item.id) || typeof item.label !== 'string') throw new Error('分类格式有误。');
    const label = item.label.trim();
    if (!label || Array.from(label).length > 24 || labels.has(label)) throw new Error('分类名称需为 1–24 个字，且不能重复。');
    if (!ICONS.includes(item.icon) || !COLORS.includes(item.color)) throw new Error('请选择有效的图标和颜色。');
    ids.add(item.id); labels.add(label);
    return { id: item.id, label, icon: item.icon, color: item.color };
  });

  const rawIncome = Array.isArray(input.incomeCategories) && input.incomeCategories.length > 0 ? input.incomeCategories : DEFAULT_INCOME_CATEGORIES;
  if (rawIncome.length > MAX_CATEGORIES) throw new Error('请保留 1–48 个分类。');
  const incomeIds = new Set();
  const incomeLabels = new Set();
  const incomeCategories = rawIncome.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)
      || incomeIds.has(item.id) || typeof item.label !== 'string') throw new Error('收入分类格式有误。');
    const label = item.label.trim();
    if (!label || Array.from(label).length > 24 || incomeLabels.has(label)) throw new Error('分类名称需为 1–24 个字，且不能重复。');
    if (!ICONS.includes(item.icon) || !COLORS.includes(item.color)) throw new Error('请选择有效的图标和颜色。');
    incomeIds.add(item.id); incomeLabels.add(label);
    return { id: item.id, label, icon: item.icon, color: item.color };
  });

  const rawConsumers = Array.isArray(value.consumers) && value.consumers.length > 0 ? value.consumers : DEFAULT_CONSUMERS;
  if (rawConsumers.length > MAX_CIRCLE_MEMBERS) throw new Error('圈子已满。');
  const consumerIds = new Set();
  const consumers = rawConsumers.map((item, index) => {
    const id = item?.id && typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(item.id) ? item.id : `c_${index + 1}`;
    if (consumerIds.has(id)) throw new Error('角色编号不能重复。');
    consumerIds.add(id);
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name || Array.from(name).length > 24) throw new Error('角色名称需为 1–24 个字。');
    const color = CONSUMER_COLORS.includes(item?.color) ? item.color : 'milk';
    const avatar = typeof item?.avatar === 'string' && (AVATARS.includes(item.avatar) || /^https:\/\//.test(item.avatar) || isCustomAvatar(item.avatar)) ? item.avatar : (index === 0 ? 'cat' : 'bunny');
    return { id, name, color, avatar };
  });

  const rawRecurring = Array.isArray(input.recurringExpenses) ? input.recurringExpenses : [];
  if (rawRecurring.length > MAX_RECURRING_EXPENSES) throw new Error('固定支出最多 64 条。');
  const recurringIds = new Set();
  const recurringExpenses = rawRecurring.map((item, index) => {
    const normalized = validateRecurringExpense(item, { ...input, categories, consumers }, index);
    if (recurringIds.has(normalized.id)) throw new Error('固定支出编号不能重复。');
    recurringIds.add(normalized.id);
    return normalized;
  });
  const fixedCapital = validateFixedCapital(input.fixedCapital);
  const soundPack = ['off', 'water', 'wood'].includes(input.soundPack) ? input.soundPack : 'off';
  const theme = ['matcha', 'cheese', 'peach', 'sea'].includes(input.theme) ? input.theme : 'matcha';
  return {
    currency: input.currency,
    timezone,
    language: input.language || 'zh',
    languageManual: Boolean(input.languageManual),
    categories,
    incomeCategories,
    consumers,
    recurringExpenses,
    fixedCapital,
    soundPack,
    theme,
  };
}
export function dateKey(date = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function validateExpense(value, settings) {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(value.id)) throw new Error('记录编号有误。');
  if (!Object.hasOwn(CURRENCIES, value.currency) || !Number.isSafeInteger(value.amountMinor) || value.amountMinor < 1
    || value.amountMinor > 10 ** (8 + CURRENCIES[value.currency].digits) - 1) throw new Error('请输入有效金额。');
  if (value.type !== undefined && !['expense', 'income'].includes(value.type)) throw new Error('记录类型有误。');
  const type = value.type || 'expense';
  const categoryPool = type === 'income' ? (settings.incomeCategories || DEFAULT_INCOME_CATEGORIES) : settings.categories;
  const category = categoryPool.find(x => x.id === value.categoryId);
  if (!category) throw new Error('请选择一个分类方向。');
  const allowedConsumers = new Set((settings.consumers || DEFAULT_CONSUMERS).map(c => c.id));
  if (!allowedConsumers.has(value.consumer)) throw new Error('请选择有效的记账角色。');
  const splitMode = value.splitMode === undefined ? 'none' : value.splitMode;
  if (!['none', 'equal'].includes(splitMode) || type === 'income' && splitMode !== 'none') throw new Error('errorSplit');
  const splitParticipants = value.splitParticipants === undefined ? [] : value.splitParticipants;
  if (!Array.isArray(splitParticipants) || splitParticipants.length > MAX_CIRCLE_MEMBERS
    || splitMode === 'none' && splitParticipants.length || splitMode === 'equal' && !splitParticipants.length
    || splitParticipants.some(id => typeof id !== 'string' || !allowedConsumers.has(id))
    || new Set(splitParticipants).size !== splitParticipants.length) throw new Error('errorSplit');
  if (typeof value.note !== 'string' || value.note.length > 160) throw new Error('备注最多 160 个字符。');
  if (typeof value.timezone !== 'string' || value.timezone.length > 80) throw new Error('时区格式有误。');
  dateKey(new Date(), value.timezone);
  const recordKinds = ['purchase', 'transfer', 'reimbursement', 'refund', 'gift', 'other'];
  const recordKind = recordKinds.includes(value.recordKind) ? value.recordKind : 'purchase';
  const occurredAt = value.occurredAt == null ? null : validateEntryTime(value.occurredAt, value.timezone).occurredAt;
  const suggestion = type === 'expense' && recordKind === 'purchase' ? normalizeCategorySuggestion(value.categorySuggestion) : undefined;
  const location = normalizeLocation(value.location);
  const recurringId = value.recurringId === undefined || value.recurringId === null || value.recurringId === '' ? undefined : value.recurringId;
  if (recurringId !== undefined && (typeof recurringId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(recurringId))) throw new Error('固定支出编号有误。');
  return { id: value.id, type, amountMinor: value.amountMinor, currency: value.currency, occurredAt,
    categoryId: category.id, category: structuredClone(category), consumer: value.consumer, note: value.note.trim(), timezone: value.timezone,
    splitMode, splitParticipants: [...splitParticipants], recordKind,
    ...(suggestion ? { categorySuggestion: suggestion } : {}), ...(location ? { location } : {}), ...(recurringId ? { recurringId } : {}) };
}
export function validateExpenseUpdate(entry, patch, settings) {
  const fields = ['amountMinor','currency','categoryId','consumer','note'];
  const changes = Object.fromEntries(fields.filter(key => Object.hasOwn(patch, key)).map(key => [key, patch[key]]));
  const poolKey = entry.type === 'income' ? 'incomeCategories' : 'categories';
  const pool = [...(settings[poolKey] || [])];
  // A note correction must still work after a category/member was archived.
  if ((!changes.categoryId || changes.categoryId === entry.categoryId) && entry.category && !pool.some(c => c.id === entry.categoryId)) pool.push(entry.category);
  const consumers = [...(settings.consumers || [])];
  const preservedMembers = [...(entry.splitParticipants || []), ...(!changes.consumer || changes.consumer === entry.consumer ? [entry.consumer] : [])];
  for (const id of preservedMembers) if (!consumers.some(c => c.id === id)) consumers.push({ id });
  const valid = validateExpense({ ...entry, ...changes, occurredAt:entry.occurredAt || entry.createdAt }, { ...settings, [poolKey]:pool, consumers });
  return { ...Object.fromEntries(fields.map(key => [key, valid[key]])), category:valid.category };
}
export function validateEntryTime(value, timezone) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new Error('errorEntryTime');
  const time = new Date(value);
  if (!Number.isFinite(time.getTime()) || time.getUTCFullYear() < 1970 || time.getUTCFullYear() > 2100 || time.toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) throw new Error('errorEntryTime');
  if (typeof timezone !== 'string' || timezone.length > 80) throw new Error('errorEntryTime');
  try { return { occurredAt: time.toISOString(), timezone, dayKey: dateKey(time, timezone) }; } catch { throw new Error('errorEntryTime'); }
}
