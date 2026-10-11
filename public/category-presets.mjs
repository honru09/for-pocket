/**
 * Built in expense categories.
 *
 * The first six ids are deliberately the ids used by the original release.
 * They are kept stable so old entries and saved custom ledgers continue to
 * render without rewriting their category snapshots.
 */
export const LEGACY_DEFAULT_CATEGORIES = Object.freeze([
  { id: 'stomach', label: '胃', icon: 'bowl', color: 'peach' },
  { id: 'learning', label: '学习', icon: 'book', color: 'blue' },
  { id: 'daily', label: '日常用品', icon: 'bag', color: 'mint' },
  { id: 'hobby', label: '兴趣', icon: 'game', color: 'pink' },
  { id: 'travel', label: '旅游', icon: 'plane', color: 'yellow' },
  { id: 'other', label: '其他', icon: 'spark', color: 'lavender' },
]);

/**
 * Thirty useful, intentionally broad presets.  Keep the ids short and stable:
 * they are sent with expense records and may be used by an imported receipt.
 */
export const DEFAULT_CATEGORIES = Object.freeze([
  // Legacy ids (do not remove or rename). Keep their stored labels stable;
  // the active UI presents refreshed labels from CATEGORY_LABELS.
  { id: 'stomach', label: '胃', icon: 'bowl', color: 'peach' },
  { id: 'learning', label: '学习', icon: 'book', color: 'blue' },
  { id: 'daily', label: '日常用品', icon: 'bag', color: 'mint' },
  { id: 'hobby', label: '兴趣', icon: 'game', color: 'pink' },
  { id: 'travel', label: '旅游', icon: 'plane', color: 'yellow' },
  { id: 'convenience', label: '便利店', icon: 'bag', color: 'mint' },
  { id: 'coffee', label: '咖啡甜品', icon: 'coffee', color: 'yellow' },
  { id: 'groceries', label: '超市食材', icon: 'bag', color: 'mint' },
  { id: 'izakaya', label: '居酒小酌', icon: 'bowl', color: 'lavender' },
  { id: 'takeaway', label: '外卖', icon: 'receipt', color: 'peach' },
  { id: 'rent', label: '房租', icon: 'wallet', color: 'blue' },
  { id: 'utilities', label: '水电', icon: 'coins', color: 'yellow' },
  { id: 'pet', label: '宠物', icon: 'heart', color: 'pink' },
  { id: 'transport', label: '交通', icon: 'card', color: 'blue' },
  { id: 'taxi', label: '打车', icon: 'card', color: 'lavender' },
  { id: 'fuel', label: '加油', icon: 'card', color: 'yellow' },
  { id: 'long_trip', label: '远行', icon: 'plane', color: 'blue' },
  { id: 'movie', label: '电影', icon: 'spark', color: 'lavender' },
  { id: 'sports', label: '运动', icon: 'sprout', color: 'mint' },
  { id: 'fees', label: '手续费', icon: 'coins', color: 'lavender' },
  { id: 'clothing', label: '穿搭', icon: 'bag', color: 'peach' },
  { id: 'beauty', label: '美容美发', icon: 'flower', color: 'pink' },
  { id: 'medical', label: '药妆医疗', icon: 'heart', color: 'lavender' },
  { id: 'subscription', label: '订阅', icon: 'receipt', color: 'blue' },
  { id: 'date', label: '约会', icon: 'heart', color: 'peach' },
  { id: 'gift_expense', label: '礼物', icon: 'gift', color: 'pink' },
  { id: 'electronics', label: '数码设备', icon: 'card', color: 'lavender' },
  { id: 'home', label: '家居修缮', icon: 'sprout', color: 'mint' },
  { id: 'insurance', label: '保险', icon: 'wallet', color: 'yellow' },
  { id: 'other', label: '其他', icon: 'spark', color: 'lavender' },
]);

// Labels are kept here so non-Chinese UI locales can present the built-ins
// without mutating the stored category label.  Custom labels still fall back
// to the user supplied text.
export const CATEGORY_LABELS = Object.freeze({
  stomach: ['外食', 'Dining', 'Харчування'], convenience: ['便利店', 'Convenience', 'Магазин'],
  coffee: ['咖啡甜品', 'Coffee & sweets', 'Кава й десерти'], groceries: ['超市食材', 'Groceries', 'Продукти'],
  izakaya: ['居酒小酌', 'Izakaya & drinks', 'Ідзакая й напої'], takeaway: ['外卖', 'Takeaway', 'Доставка'],
  rent: ['房租', 'Rent', 'Оренда'], utilities: ['水电', 'Utilities', 'Комунальні послуги'],
  daily: ['日杂', 'Household', 'Побут'], pet: ['宠物', 'Pets', 'Домашні тварини'],
  transport: ['交通', 'Transport', 'Транспорт'], taxi: ['打车', 'Taxi', 'Таксі'],
  fuel: ['加油', 'Fuel', 'Пальне'], long_trip: ['远行', 'Long trips', 'Далекі поїздки'],
  hobby: ['游戏', 'Games', 'Ігри'], movie: ['电影', 'Movies', 'Кіно'], sports: ['运动', 'Sports', 'Спорт'],
  clothing: ['穿搭', 'Clothing', 'Одяг'],
  beauty: ['美容美发', 'Beauty', 'Краса'], medical: ['药妆医疗', 'Health & pharmacy', 'Здоров’я й аптека'],
  subscription: ['订阅', 'Subscriptions', 'Підписки'], date: ['约会', 'Dates', 'Побачення'],
  gift_expense: ['礼物', 'Gifts', 'Подарунки'], learning: ['学习', 'Learning', 'Навчання'],
  electronics: ['数码设备', 'Electronics', 'Техніка'], home: ['家居修缮', 'Home repair', 'Дім і ремонт'],
  insurance: ['保险', 'Insurance', 'Страхування'], fees: ['手续费', 'Fees', 'Комісії'],
  other: ['其他', 'Other', 'Інше'],
});

const sameCategory = (a, b) => a && b && a.id === b.id && a.label === b.label && a.icon === b.icon && a.color === b.color;
export const isLegacyDefaultCategories = categories => Array.isArray(categories)
  && categories.length === LEGACY_DEFAULT_CATEGORIES.length
  && categories.every((item, index) => sameCategory(item, LEGACY_DEFAULT_CATEGORIES[index]));

/** Upgrade only an untouched six-category default. Custom/deleted categories
 * are left alone, preserving the user's intent and historical snapshots. */
export function upgradeCategoryPresets(settings = {}) {
  if (!isLegacyDefaultCategories(settings.categories)) return settings;
  const legacyIds = new Set(LEGACY_DEFAULT_CATEGORIES.map(category => category.id));
  return {
    ...settings,
    // Explicit upgrades preserve the six original objects so old category
    // names remain editable and any saved snapshot keeps its exact wording.
    categories: [
      ...structuredClone(LEGACY_DEFAULT_CATEGORIES),
      ...structuredClone(DEFAULT_CATEGORIES.filter(category => !legacyIds.has(category.id))),
    ],
  };
}

/**
 * Put the most-used categories first while retaining a stable user-defined
 * order for ties and the rest. `expenses` may contain deleted or historical
 * snapshots; only active matching ids are counted.
 */
export function sortCategoriesByUsage(categories, expenses = [], { type = 'expense', limit = 6 } = {}) {
  if (!Array.isArray(categories)) return [];
  const counts = new Map(categories.map(category => [category.id, 0]));
  if (Array.isArray(expenses)) for (const entry of expenses) {
    if (!entry || entry.deletedAt || (entry.type || 'expense') !== type
      || (type === 'expense' && ['transfer', 'reimbursement'].includes(entry.recordKind))) continue;
    if (counts.has(entry.categoryId)) counts.set(entry.categoryId, counts.get(entry.categoryId) + 1);
  }
  const visibleLimit = Math.max(0, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 6, categories.length));
  const ranked = categories
    .map((category, index) => ({ category, index, count: counts.get(category.id) || 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index);
  const hot = new Set(ranked.slice(0, visibleLimit).map(item => item.category.id));
  return categories.slice().sort((a, b) => {
    const ah = hot.has(a.id), bh = hot.has(b.id);
    if (ah !== bh) return ah ? -1 : 1;
    return (ah ? (counts.get(b.id) || 0) - (counts.get(a.id) || 0) : 0)
      || categories.indexOf(a) - categories.indexOf(b);
  });
}
