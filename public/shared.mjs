export const CURRENCIES = {
  JPY: { symbol: '¥', name: '日元', digits: 0 },
  CNY: { symbol: '¥', name: '人民币', digits: 2 },
  USD: { symbol: '$', name: '美元', digits: 2 },
};
export const ICONS = ['bowl', 'book', 'bag', 'game', 'plane', 'spark', 'heart', 'coffee'];
export const COLORS = ['peach', 'blue', 'mint', 'pink', 'yellow', 'lavender'];
export const LANGUAGES = ['zh', 'en', 'uk'];
export const AVATARS = ['cat', 'bunny', 'bear', 'chick', 'fox', 'panda', 'coffee', 'flower', 'sprout', 'star'];
export const CONSUMER_COLORS = ['milk', 'blue', 'pink', 'mint', 'peach', 'yellow', 'lavender', 'sage'];
export const DEFAULT_CONSUMERS = [
  { id: 'xingrun', name: 'Xingrun', color: 'blue', avatar: 'cat' },
  { id: 'liia', name: 'Liia', color: 'milk', avatar: 'bunny' },
];
export const CONSUMERS = { xingrun: 'Xingrun', liia: 'Liia' };
export const DEFAULT_CATEGORIES = [
  { id: 'stomach', label: '胃', icon: 'bowl', color: 'peach' },
  { id: 'learning', label: '学习', icon: 'book', color: 'blue' },
  { id: 'daily', label: '日常用品', icon: 'bag', color: 'mint' },
  { id: 'hobby', label: '兴趣', icon: 'game', color: 'pink' },
  { id: 'travel', label: '旅游', icon: 'plane', color: 'yellow' },
  { id: 'other', label: '其他', icon: 'spark', color: 'lavender' },
];
export function resolveLanguage(code, fallback = 'zh') {
  if (!code || typeof code !== 'string') return fallback;
  const lower = code.toLowerCase().trim();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('uk') || lower.startsWith('ru')) return 'uk';
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
    consumers: structuredClone(DEFAULT_CONSUMERS),
  };
}
export function validateSettings(value) {
  if (value?.language !== undefined && !LANGUAGES.includes(value.language)) throw new Error('请选择有效的语言。');
  if (!value || !CURRENCIES[value.currency] || !Array.isArray(value.categories)
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

  const rawConsumers = Array.isArray(value.consumers) && value.consumers.length > 0 ? value.consumers : DEFAULT_CONSUMERS;
  if (rawConsumers.length < 1 || rawConsumers.length > 8) throw new Error('请保留 1–8 位成员角色。');
  const consumerIds = new Set();
  const consumers = rawConsumers.map((item, index) => {
    const id = item?.id && typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(item.id) ? item.id : `c_${index + 1}`;
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
  if (!CURRENCIES[value.currency] || !Number.isSafeInteger(value.amountMinor) || value.amountMinor < 1
    || value.amountMinor > 10 ** (8 + CURRENCIES[value.currency].digits) - 1) throw new Error('请输入有效金额。');
  const category = settings.categories.find(x => x.id === value.categoryId);
  if (!category) throw new Error('请选择一个花销方向。');
  const allowedConsumers = new Set((settings.consumers || DEFAULT_CONSUMERS).map(c => c.id));
  if (!allowedConsumers.has(value.consumer)) throw new Error('请选择有效的记账角色。');
  if (typeof value.note !== 'string' || value.note.length > 160) throw new Error('备注最多 160 个字符。');
  if (typeof value.timezone !== 'string' || value.timezone.length > 80) throw new Error('时区格式有误。');
  dateKey(new Date(), value.timezone);
  return { id: value.id, amountMinor: value.amountMinor, currency: value.currency,
    categoryId: category.id, category: structuredClone(category), consumer: value.consumer, note: value.note.trim(), timezone: value.timezone };
}
