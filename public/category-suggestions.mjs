import { CATEGORY_LABELS, LEGACY_DEFAULT_CATEGORIES } from './category-presets.mjs';

// A suggestion is just evidence on a saved purchase. It never changes settings
// or adds a category until a ledger editor accepts it.  Labels are compared
// across the three supported languages so a model cannot suggest "Dining"
// when the ledger already has "外食" (or the original "胃") configured.
export function normalizeCategorySuggestion(value) {
  if (typeof value !== 'string') return undefined;
  const label = value.normalize('NFKC').trim().replace(/ +/g, ' ');
  if (Array.from(label).length < 2 || Array.from(label).length > 24
    || !/^[\p{L}\p{M}\p{N} '&’+\-/·]+$/u.test(label) || !/\p{L}/u.test(label)
    || /^(?:other|misc|expense|purchase|其他|支出|消费|інше|витрата)$/iu.test(label)) return undefined;
  return label;
}

const keyFor = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s_\-/·&]+/g, '');

const BUILTIN_ALIASES = {
  stomach: ['胃', '外食', '餐饮', '餐飲', 'dining', 'food', 'харчування', 'їжа'],
  learning: ['学习', 'learning', 'education', 'навчання', 'освіта'],
  daily: ['日常用品', '日杂', 'household', 'daily needs', 'побут'],
  hobby: ['兴趣', '游戏', 'hobbies', 'games', 'захоплення', 'ігри'],
  travel: ['旅游', '旅行', 'travel', 'подорожі'],
  other: ['其他', 'other', 'misc', 'expense', 'purchase', 'інше', 'витрата'],
};

const aliasMap = new Map();
for (const [id, labels] of Object.entries(CATEGORY_LABELS)) {
  for (const label of labels || []) aliasMap.set(keyFor(label), id);
}
for (const category of LEGACY_DEFAULT_CATEGORIES) aliasMap.set(keyFor(category.label), category.id);
for (const [id, labels] of Object.entries(BUILTIN_ALIASES)) {
  for (const label of labels) aliasMap.set(keyFor(label), id);
}

const canonicalKey = value => aliasMap.get(keyFor(value)) || keyFor(value);
export function isExistingCategorySuggestion(label, categories = []) {
  const key = canonicalKey(label);
  return categories.some(category => canonicalKey(category.id) === key || canonicalKey(category.label) === key);
}

export function getCategorySuggestions(categories = [], expenses = [], { type = 'expense', limit = 3, minCount = 3, ledgerId } = {}) {
  if (type !== 'expense') return [];
  const seen = new Set(), groups = new Map();
  for (const entry of expenses) {
    if (!entry?.id || seen.has(entry.id) || entry.deletedAt || entry.pending || entry.needsReview
      || ['pending', 'draft', 'refining'].includes(entry.status)
      || (entry.type || 'expense') !== type || (entry.recordKind || 'purchase') !== 'purchase') continue;
    if (ledgerId !== undefined && entry.ledgerId !== ledgerId) continue;
    seen.add(entry.id);
    const label = normalizeCategorySuggestion(entry.categorySuggestion);
    if (!label || isExistingCategorySuggestion(label, categories)) continue;
    const key = keyFor(label), group = groups.get(key) || { label, count: 0, icon: 'receipt', color: 'yellow' };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.count >= Math.max(3, minCount))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, Math.max(0, Math.min(3, limit)));
}
