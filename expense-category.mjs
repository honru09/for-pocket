import { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from './public/shared.mjs';

const normal = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s_\-—–/]+/g, '');
const words = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
const token = expression => new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${expression})(?=$|[^\\p{L}\\p{N}])`, 'iu');

// Exact aliases are used for model category names; single characters never match
// arbitrary merchant text. Contextual inference below uses complete purpose words.
const ALIASES = {
  stomach: ['stomach', 'food', 'meal', 'dining', 'restaurant', 'ramen', 'lunch', 'dinner', 'breakfast', 'coffee', '胃', '餐饮', '饮食', '吃饭', '食物', '餐费', '食費', '外食', 'їжа', 'харчування', 'обід', 'вечеря', 'сніданок', 'кава', 'ресторан'],
  learning: ['learning', 'study', 'education', 'book', 'course', 'class', 'school', '学习', '教育', '课程', '学费', '书籍', 'навчання', 'освіта', 'курси', 'книги'],
  daily: ['daily', 'household', 'grocery', 'groceries', 'supplies', 'utility', '日常用品', '日用品', '日常', '生活', '杂货', 'побут', 'побутові товари', 'продукти'],
  hobby: ['hobby', 'interest', 'entertainment', 'game', 'gaming', 'music', 'movie', '兴趣', '娱乐', '游戏', 'хобі', 'розваги', 'ігри'],
  travel: ['travel', 'trip', 'flight', 'hotel', 'tour', 'transport', 'transportation', 'commute', '交通', '通勤', '旅行', '旅游', '机票', '酒店', 'подорож', 'подорожі', 'транспорт'],
  wage: ['wage', 'salary', 'paycheck', '工资', '薪资', 'зарплата', 'заробітна плата'],
  bonus: ['bonus', '奖金', '奖励', 'премія', 'бонус'],
  redpacket: ['redpacket', 'gift', '红包', '礼金', 'подарунок'],
  parttime: ['parttime', 'freelance', '兼职', 'підробіток', 'фриланс'],
  reimburse: ['reimburse', 'reimbursement', '报销', '报销款', 'відшкодування', 'компенсація'],
};
const OTHER = new Set(['other', 'other_in', 'misc', 'miscellaneous', '其他', '其他入账', '杂项', 'інше', 'інші', 'інший дохід'].map(normal));
const EXPENSE_FAMILIES = ['stomach', 'learning', 'daily', 'hobby', 'travel'];
const INCOME_FAMILIES = ['wage', 'bonus', 'redpacket', 'parttime', 'reimburse'];
const ICON_FAMILY = { bowl: 'stomach', coffee: 'stomach', book: 'learning', bag: 'daily', game: 'hobby', plane: 'travel' };

const hasFood = text => /拉面|拉麵|寿司|壽司|咖啡|午餐|午饭|午飯|晚餐|晚饭|晚飯|早餐|早饭|早飯|餐饮|餐飲|便当|便當|外卖|外賣|奶茶|火锅|火鍋|食費|ラーメン|らーめん/u.test(text)
  || token('ramen|noodles?|sushi|coffee|meals?|dining|lunch|dinner|breakfast|restaurant|café|cafe|takeaway|takeout|pizza|обід(?:у)?|вечер(?:я|ю)|снідан(?:ок|ку)|кав(?:а|у|и)|рамен|суші|ресторан(?:і|у)?').test(text);
const hasLearning = text => /学习|學習|课程|課程|网课|網課|学费|學費|教材|教科书|教科書|参考书|參考書|买书|買書|书籍|書籍|食谱|食譜/u.test(text)
  || token('study|studying|tuition|textbooks?|classes|lessons?|education|cookbooks?|recipes?|навчання|навчальний|підручник(?:и)?|книг(?:а|и|у)|курс(?:и|у|ів)?').test(text)
  || (token('courses?').test(text) && !token('course (?:meal|dinner|lunch)').test(text))
  || (token('books?').test(text) && !token('book (?:a|an|the) (?:taxi|hotel|flight|appointment|table|restaurant|ticket|trip)').test(text));
const hasDaily = text => /日用品|日常用品|杂货|雜貨|洗衣液|洗洁精|洗潔精|清洁剂|清潔劑|牙膏|牙刷|洗发水|洗髮水|卫生纸|衛生紙|纸巾|紙巾|沐浴露|充电线|充電線/u.test(text)
  || token('groceries|household|detergent|toothpaste|toothbrush|shampoo|soap|cleaning supplies|toilet paper|tissues|побутові|пральний|шампунь|мило|зубна паста|туалетний папір').test(text);
const hasHobby = text => /游戏|遊戲|电影|電影|演唱会|演唱會|音乐会|音樂會|手办|手辦|玩具/u.test(text)
  || token('games?|gaming|cinema|movies?|concerts?|hobbies|hobby|toys?|ігри|гру|кіно|кінотеатр|концерт(?:у)?|хобі|іграшк(?:а|и|у)').test(text);
const hasTravel = text => /地铁|地鐵|电车|電車|公交|公车|公車|打车|打車|出租车|出租車|车费|車費|交通|通勤|机票|機票|飞机票|飛機票|酒店|旅馆|旅館|旅行|旅游|旅遊|新干线|新幹線/u.test(text)
  || token('subway|metro|taxi|bus|train|fare|commute|transport|flights?|airfare|hotels?|travel|trip|метро|таксі|автобус(?:а|ом)?|поїзд(?:а|ом)?|квиток|готел(?:ь|ю|і)|подорож(?:і)?|транспорт').test(text);
const FAMILY_MATCH = { stomach: hasFood, learning: hasLearning, daily: hasDaily, hobby: hasHobby, travel: hasTravel };

const isOther = item => OTHER.has(normal(item?.id)) || OTHER.has(normal(item?.label));
const familyForAlias = (value, families) => families.find(family => ALIASES[family].some(alias => normal(alias) === normal(value)));

function categoryFamily(item, families) {
  const labelFamily = familyForAlias(item.label, families);
  if (labelFamily) return labelFamily;
  const labelMatches = families.filter(family => FAMILY_MATCH[family]?.(words(item.label)));
  if (labelMatches.length === 1) return labelMatches[0];
  const idFamily = familyForAlias(item.id, families);
  if (idFamily) return idFamily;
  // Icons can help locate a renamed category, but conflicting label meanings
  // and multiple categories with the same icon are deliberately not guessed.
  return labelMatches.length ? null : (families.includes(ICON_FAMILY[item.icon]) ? ICON_FAMILY[item.icon] : null);
}

const SPECIFIC_PURPOSES = [
  { family: 'stomach', test: text => /咖啡/u.test(text) || token('coffee|café|cafe|кав(?:а|у|и)').test(text) },
  { family: 'stomach', test: text => /午餐|午饭|午飯/u.test(text) || token('lunch|обід(?:у)?').test(text) },
  { family: 'stomach', test: text => /晚餐|晚饭|晚飯/u.test(text) || token('dinner|вечер(?:я|ю)').test(text) },
  { family: 'stomach', test: text => /拉面|拉麵|ラーメン/u.test(text) || token('ramen|noodles?|рамен').test(text) },
  { family: 'travel', test: text => /交通|通勤|地铁|地鐵|电车|電車|公交|车费|車費/u.test(text) || token('transport|transportation|commute|metro|subway|taxi|bus|train|транспорт|метро|таксі').test(text) },
];

function uniqueFamilyCategory(pool, family, context = '') {
  const choices = pool.filter(item => !isOther(item) && categoryFamily(item, EXPENSE_FAMILIES.concat(INCOME_FAMILIES)) === family);
  if (choices.length === 1) return choices[0];
  const specific = choices.filter(item => SPECIFIC_PURPOSES.some(purpose => purpose.family === family && purpose.test(context) && purpose.test(words(item.label))));
  return specific.length === 1 ? specific[0] : null;
}

function explicitCategory(text, pool, families) {
  const specified = String(text || '').match(/(?:分类|類別|类别|用途|category|категорія)\s*[:：=]?\s*([^,，;；。\n]+)/iu)?.[1]?.trim();
  if (!specified) return null;
  const exact = pool.find(item => normal(item.id) === normal(specified) || normal(item.label) === normal(specified));
  return exact || uniqueFamilyCategory(pool, familyForAlias(specified, families));
}

function isMoneyMovement(candidate) {
  const context = words([candidate.rawText, candidate.note].filter(value => typeof value === 'string').join(' '));
  return ['transfer', 'reimbursement', 'refund'].includes(candidate.recordKind)
    || /转账|轉帳|转给|轉給|代付|垫付|墊付|报销|報銷|还款|還款|还我|還我|(?:帮|幫|替)(?:朋友|别人|別人|同事|他|她).{0,8}(?:付|买|買)/u.test(context)
    || token('transfer|transferred|reimburse(?:ment|d)?|repayment|paid (?:back|on behalf)|переказ(?:ав|ала)?|відшкодування|повернення боргу|за друга').test(context);
}

// Exposed for the normaliser: model recordKind can be wrong, so textual
// evidence of paying on somebody else's behalf must still block auto-entry.
export function hasMoneyMovementEvidence(candidate = {}) {
  return isMoneyMovement(candidate);
}

function inferExpenseFamily(candidate) {
  const context = words([candidate.rawText, candidate.note].filter(value => typeof value === 'string').join(' '));
  if (isMoneyMovement(candidate)) return null;

  // A ramen cookbook/course is an education purchase. Food words inside that
  // object do not turn it into a meal; the same applies to branded non-food goods.
  if (hasLearning(context)) return 'learning';
  const nonFood = ['daily', 'hobby', 'travel'].filter(family => FAMILY_MATCH[family](context));
  const food = hasFood(context);
  if (food && nonFood.length) return null;
  if (nonFood.length === 1) return nonFood[0];
  if (nonFood.length) return null;
  if (food && !/软件|軟件|应用|應用|品牌|网店|網店|零件/u.test(context) && !token('software|app|brand|parts').test(context)) return 'stomach';
  return null;
}

export function mapExpenseCategory(candidate = {}, type, settings = {}) {
  const pool = type === 'income' ? (settings.incomeCategories || DEFAULT_INCOME_CATEGORIES) : (settings.categories || DEFAULT_CATEGORIES);
  if (!Array.isArray(pool) || !pool.length) throw new Error('errorAiCategory');
  const families = type === 'income' ? INCOME_FAMILIES : EXPENSE_FAMILIES;
  const fallback = pool.find(isOther) || pool[pool.length - 1];
  const explicit = explicitCategory(candidate.rawText, pool, families);
  if (explicit) return explicit;
  const wanted = [candidate.categoryId, candidate.categoryLabel].map(normal).filter(Boolean);
  const exact = pool.find(item => !isOther(item) && wanted.includes(normal(item.id)))
    || pool.find(item => !isOther(item) && wanted.includes(normal(item.label)));
  if (exact) return exact;
  if (type === 'expense' && isMoneyMovement(candidate)) return fallback;
  for (const value of wanted) {
    const family = familyForAlias(value, families);
    const category = family && uniqueFamilyCategory(pool, family);
    if (category) return category;
  }
  if (type === 'expense') {
    const family = inferExpenseFamily(candidate);
    const category = family && uniqueFamilyCategory(pool, family, words([candidate.rawText, candidate.note].join(' ')));
    if (category) return category;
  }
  return fallback;
}
