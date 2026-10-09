export const CURRENCIES = {
  JPY: { symbol: '¥', name: '日元', digits: 0 },
  CNY: { symbol: '¥', name: '人民币', digits: 2 },
  USD: { symbol: '$', name: '美元', digits: 2 },
};
export const ICONS = ['bowl', 'book', 'bag', 'game', 'plane', 'spark', 'heart', 'coffee'];
export const COLORS = ['peach', 'blue', 'mint', 'pink', 'yellow', 'lavender'];
export const LANGUAGES = ['zh', 'en', 'uk'];
export const CONSUMERS = { xingrun: 'Xingrun', liia: 'Liia' };
export const DEFAULT_CATEGORIES = [
  { id: 'stomach', label: '胃', icon: 'bowl', color: 'peach' },
  { id: 'learning', label: '学习', icon: 'book', color: 'blue' },
  { id: 'daily', label: '日常用品', icon: 'bag', color: 'mint' },
  { id: 'hobby', label: '兴趣', icon: 'game', color: 'pink' },
  { id: 'travel', label: '旅游', icon: 'plane', color: 'yellow' },
  { id: 'other', label: '其他', icon: 'spark', color: 'lavender' },
];
export function initialSettings() {
  return { currency: 'JPY', language: 'zh', categories: structuredClone(DEFAULT_CATEGORIES) };
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
  return { currency: value.currency, language: value.language || 'zh', categories };
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
  if (!Object.hasOwn(CONSUMERS, value.consumer)) throw new Error('请选择 Xingrun 或 Liia。');
  if (typeof value.note !== 'string' || value.note.length > 160) throw new Error('备注最多 160 个字符。');
  if (typeof value.timezone !== 'string' || value.timezone.length > 80) throw new Error('时区格式有误。');
  dateKey(new Date(), value.timezone);
  return { id: value.id, amountMinor: value.amountMinor, currency: value.currency,
    categoryId: category.id, category: structuredClone(category), consumer: value.consumer, note: value.note.trim(), timezone: value.timezone };
}
