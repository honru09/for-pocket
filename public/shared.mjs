export const CURRENCIES = {
  JPY: { symbol: '¥', name: '日元', digits: 0 },
  CNY: { symbol: '¥', name: '人民币', digits: 2 },
  USD: { symbol: '$', name: '美元', digits: 2 },
};
export const ICONS = ['bowl', 'book', 'bag', 'game', 'plane', 'spark', 'heart', 'coffee', 'wallet', 'coins', 'gift', 'receipt', 'piggy', 'card', 'transfer', 'users', 'google', 'sprout', 'flower', 'star'];
export const COLORS = ['peach', 'blue', 'mint', 'pink', 'yellow', 'lavender'];
export const LANGUAGES = ['zh', 'en', 'uk'];
export const AVATARS = ['cloud', 'cat', 'bunny', 'bear', 'chick', 'fox', 'panda', 'coffee', 'flower', 'sprout', 'star'];
export const CONSUMER_COLORS = ['milk', 'blue', 'pink', 'mint', 'peach', 'yellow', 'lavender', 'sage'];
export const DEFAULT_CONSUMERS = [];
export const CONSUMERS = {};
export const MAX_CIRCLE_MEMBERS = 99;
export function validateUserProfile(value) {
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  if (!name || Array.from(name).length > 24) throw new Error('角色名称需为 1–24 个字。');
  if (!CONSUMER_COLORS.includes(value.color)) throw new Error('请选择有效的图标和颜色。');
  const avatar = value.avatar;
  if (!AVATARS.includes(avatar) && !(typeof avatar === 'string' && avatar.length <= 2048 && /^https:\/\//.test(avatar))) throw new Error('请选择有效的图标和颜色。');
  return { name, color: value.color, avatar };
}
export const DEFAULT_CATEGORIES = [
  { id: 'stomach', label: '胃', icon: 'bowl', color: 'peach' },
  { id: 'learning', label: '学习', icon: 'book', color: 'blue' },
  { id: 'daily', label: '日常用品', icon: 'bag', color: 'mint' },
  { id: 'hobby', label: '兴趣', icon: 'game', color: 'pink' },
  { id: 'travel', label: '旅游', icon: 'plane', color: 'yellow' },
  { id: 'other', label: '其他', icon: 'spark', color: 'lavender' },
];
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
    language,
    languageManual: false,
    categories: structuredClone(DEFAULT_CATEGORIES),
    incomeCategories: structuredClone(DEFAULT_INCOME_CATEGORIES),
    consumers: structuredClone(DEFAULT_CONSUMERS),
  };
}
export function validateSettings(value) {
  if (value?.language !== undefined && !LANGUAGES.includes(value.language)) throw new Error('请选择有效的语言。');
  if (!value || !Object.hasOwn(CURRENCIES, value.currency) || !Array.isArray(value.categories)
    || value.categories.length < 1 || value.categories.length > 18) throw new Error('请保留 1–18 个分类。');
  const ids = new Set();
  const labels = new Set();
  const categories = value.categories.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)
      || ids.has(item.id) || typeof item.label !== 'string') throw new Error('分类格式有误。');
    const label = item.label.trim();
    if (!label || Array.from(label).length > 24 || labels.has(label)) throw new Error('分类名称需为 1–24 个字，且不能重复。');
    if (!ICONS.includes(item.icon) || !COLORS.includes(item.color)) throw new Error('请选择有效的图标和颜色。');
    ids.add(item.id); labels.add(label);
    return { id: item.id, label, icon: item.icon, color: item.color };
  });

  const rawIncome = Array.isArray(value.incomeCategories) && value.incomeCategories.length > 0 ? value.incomeCategories : DEFAULT_INCOME_CATEGORIES;
  if (rawIncome.length > 18) throw new Error('请保留 1–18 个分类。');
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
    const avatar = typeof item?.avatar === 'string' && (AVATARS.includes(item.avatar) || item.avatar.startsWith('http') || item.avatar.startsWith('data:')) ? item.avatar : (index === 0 ? 'cat' : 'bunny');
    return { id, name, color, avatar };
  });

  return {
    currency: value.currency,
    language: value.language || 'zh',
    languageManual: Boolean(value.languageManual),
    categories,
    incomeCategories,
    consumers,
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
  const occurredAt = value.occurredAt == null ? null : validateEntryTime(value.occurredAt, value.timezone).occurredAt;
  return { id: value.id, type, amountMinor: value.amountMinor, currency: value.currency, occurredAt,
    categoryId: category.id, category: structuredClone(category), consumer: value.consumer, note: value.note.trim(), timezone: value.timezone,
    splitMode, splitParticipants: [...splitParticipants] };
}
export function validateEntryTime(value, timezone) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new Error('errorEntryTime');
  const time = new Date(value);
  if (!Number.isFinite(time.getTime()) || time.getUTCFullYear() < 1970 || time.getUTCFullYear() > 2100 || time.toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) throw new Error('errorEntryTime');
  if (typeof timezone !== 'string' || timezone.length > 80) throw new Error('errorEntryTime');
  try { return { occurredAt: time.toISOString(), timezone, dayKey: dateKey(time, timezone) }; } catch { throw new Error('errorEntryTime'); }
}
