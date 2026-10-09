import { DEFAULT_CATEGORIES } from './shared.mjs';

export const LOCALES = { zh: 'zh-CN', en: 'en-US', uk: 'uk-UA' };
export const MESSAGES = {
  zh: {
    title: '花给生活', record: '记一笔', ledger: '小账本', recordTitle: '花给什么', historyTitle: '小账本', manageTitle: '我的分类',
    language: '语言', navigation: '页面导航', amountInput: '金额输入', amountLabel: '金额', currentAmount: '当前金额', currency: '币种',
    JPY: '日元', CNY: '人民币', USD: '美元', categories: '用途', editCategories: '编辑', keypad: '数字键盘', clear: '清空金额', decimal: '小数点', backspace: '删除最后一位',
    consumer: '谁花的？', selectConsumer: '选择消费者', note: '备注（可选）', notePlaceholder: '备注（可选）', optional: '可选', save: '记下这笔', saving: '正在保存…', enterAmount: '先输入金额', selectCategory: '选择用途',
    today: '今天', todayTotal: '今日支出', period: '时间范围', month: '这个月', all: '全部', ledgerCurrency: '账本币种', summary: '花销汇总', allSpending: '全部支出', monthSpending: '本月支出', count: '{n} 笔 · {currency}',
    emptyTitle: '还没有记录', emptyText: '记下第一笔小生活。', newEntry: '＋ 记一笔', deleteExpense: '删除 {category} {amount}',
    unknownConsumer: '未标注', back: '返回', manageIntro: '改个名字，换个图标。', addCategory: '＋ 添加分类', resetCategories: '恢复默认', saveCategories: '保存',
    categoryName: '分类名称：{name}', categoryIcon: '图标：{name}', categoryColor: '颜色：{name}', removeCategory: '移除分类：{name}',
    bowl: '热乎饭', book: '小书本', bag: '购物袋', game: '游戏机', plane: '小飞机', spark: '小星星', heart: '小爱心', coffee: '咖啡杯',
    peach: '蜜桃', blue: '天空', mint: '薄荷', pink: '樱花', yellow: '奶黄', lavender: '薰衣草',
    stomach: '胃', learning: '学习', daily: '日常用品', hobby: '兴趣', travel: '旅游', other: '其他',
    loading: '正在打开…', localStorage: '仅保存在此浏览器', remoteStorage: '已同步', unavailable: '暂时无法打开', undo: '撤销', closeNotice: '关闭提示',
    saved: '{person} · {amount}，记下啦。', removed: '已移除这笔。', restored: '已恢复这笔。', categoriesSaved: '分类已保存。', currencyChanged: '已切换为 {currency}，请重新输入金额。', maxDigits: '最多输入 8 位整数。', keepCategory: '至少保留一个分类。',
    errorCategoryCount: '请保留 1–18 个分类。', errorCategoryFormat: '分类格式有误。', errorCategoryName: '分类名称需为 1–24 个字，且不能重复。', errorIconColor: '请选择有效的图标和颜色。', errorLanguage: '请选择有效的语言。',
    errorExpenseId: '记录编号有误。', errorAmount: '请输入有效金额。', errorCategory: '请选择一个花销方向。', errorConsumer: '请选择 Xingrun 或 Liia。', errorNote: '备注最多 160 个字符。', errorTimezone: '时区格式有误。',
    errorLocalData: '本机记录格式有误，请先备份浏览器数据。', errorLocalSpace: '本机空间不足或存储被禁用，这笔还没保存。', errorMissing: '这笔记录已经不存在。', errorRestore: '无法恢复这笔记录。',
    errorNetwork: '连接没成功，这次操作还未确认。请再试一次。', errorAuth: '请从 Telegram bot 重新打开，以验证身份。', errorSave: '暂时没有保存成功，请再试一次。', errorConnect: '暂时连接不上，请刷新后再打开。', errorBot: 'bot 服务还没有配置完成，请先配置服务端。', errorCapacity: '账本已满，请备份后扩展存储。', errorOrigin: '请求来源不匹配。', errorDeleted: '这笔记录已移除，请重新输入。',
  },
  en: {
    title: 'Little spending', record: 'Add', ledger: 'Ledger', recordTitle: "What's it for", historyTitle: 'Your ledger', manageTitle: 'Your categories',
    language: 'Language', navigation: 'Navigation', amountInput: 'Amount input', amountLabel: 'Amount', currentAmount: 'Current amount', currency: 'Currency',
    JPY: 'Yen', CNY: 'Yuan', USD: 'Dollar', categories: 'Category', editCategories: 'Edit', keypad: 'Number pad', clear: 'Clear amount', decimal: 'Decimal point', backspace: 'Delete last digit',
    consumer: 'Who spent it?', selectConsumer: 'Choose a person', note: 'Note (optional)', notePlaceholder: 'Note (optional)', optional: 'Optional', save: 'Save expense', saving: 'Saving…', enterAmount: 'Enter an amount', selectCategory: 'Choose a category',
    today: 'Today', todayTotal: "Today's spending", period: 'Time range', month: 'This month', all: 'All', ledgerCurrency: 'Ledger currency', summary: 'Spending summary', allSpending: 'Total spending', monthSpending: 'This month', count: '{n} entries · {currency}',
    emptyTitle: 'No expenses yet', emptyText: 'Start with a little everyday moment.', newEntry: '＋ Add expense', deleteExpense: 'Delete {category} {amount}',
    unknownConsumer: 'Unassigned', back: 'Back', manageIntro: 'A new name. A little new icon.', addCategory: '＋ Add category', resetCategories: 'Reset defaults', saveCategories: 'Save',
    categoryName: 'Category name: {name}', categoryIcon: 'Icon: {name}', categoryColor: 'Color: {name}', removeCategory: 'Remove category: {name}',
    bowl: 'Bowl', book: 'Book', bag: 'Bag', game: 'Gamepad', plane: 'Plane', spark: 'Star', heart: 'Heart', coffee: 'Coffee',
    peach: 'Peach', blue: 'Sky', mint: 'Mint', pink: 'Pink', yellow: 'Yellow', lavender: 'Lavender',
    stomach: 'Food', learning: 'Learning', daily: 'Daily needs', hobby: 'Hobbies', travel: 'Travel', other: 'Other',
    loading: 'Opening…', localStorage: 'Saved in this browser only', remoteStorage: 'Synced', unavailable: 'Unable to open', undo: 'Undo', closeNotice: 'Dismiss notice',
    saved: '{person} · {amount}, saved.', removed: 'Expense removed.', restored: 'Expense restored.', categoriesSaved: 'Categories saved.', currencyChanged: 'Switched to {currency}. Enter the amount again.', maxDigits: 'Up to 8 whole-number digits.', keepCategory: 'Keep at least one category.',
    errorCategoryCount: 'Keep 1–18 categories.', errorCategoryFormat: 'Invalid category format.', errorCategoryName: 'Names must be unique and contain 1–24 characters.', errorIconColor: 'Choose a valid icon and color.', errorLanguage: 'Choose a valid language.',
    errorExpenseId: 'Invalid expense ID.', errorAmount: 'Enter a valid amount.', errorCategory: 'Choose a category.', errorConsumer: 'Choose Xingrun or Liia.', errorNote: 'Notes can contain up to 160 characters.', errorTimezone: 'Invalid time zone.',
    errorLocalData: 'Stored records are invalid. Back up your browser data first.', errorLocalSpace: 'Browser storage is unavailable or full. This expense has not been saved.', errorMissing: 'This expense no longer exists.', errorRestore: 'This expense could not be restored.',
    errorNetwork: 'Connection failed. The result is unconfirmed; please retry.', errorAuth: 'Reopen the app from the Telegram bot to sign in.', errorSave: 'Unable to save. Please retry.', errorConnect: 'Unable to connect. Refresh and try again.', errorBot: 'The bot server has not been configured yet.', errorCapacity: 'The ledger is full. Back up your records and expand storage.', errorOrigin: 'The request origin does not match.', errorDeleted: 'This expense was removed. Enter it again.',
  },
  uk: {
    title: 'Маленькі витрати', record: 'Додати', ledger: 'Витрати', recordTitle: 'На що витратили', historyTitle: 'Ваші витрати', manageTitle: 'Мої категорії',
    language: 'Мова', navigation: 'Навігація', amountInput: 'Введення суми', amountLabel: 'Сума', currentAmount: 'Поточна сума', currency: 'Валюта',
    JPY: 'Єна', CNY: 'Юань', USD: 'Долар', categories: 'Категорія', editCategories: 'Змінити', keypad: 'Цифрова клавіатура', clear: 'Очистити суму', decimal: 'Десятковий роздільник', backspace: 'Видалити останню цифру',
    consumer: 'Хто витратив?', selectConsumer: 'Оберіть людину', note: 'Нотатка (необов’язково)', notePlaceholder: 'Нотатка (необов’язково)', optional: 'Необов’язково', save: 'Зберегти витрату', saving: 'Зберігаємо…', enterAmount: 'Введіть суму', selectCategory: 'Оберіть категорію',
    today: 'Сьогодні', todayTotal: 'Витрати за сьогодні', period: 'Період', month: 'Цей місяць', all: 'Усі', ledgerCurrency: 'Валюта витрат', summary: 'Підсумок витрат', allSpending: 'Усі витрати', monthSpending: 'Цей місяць', count: '{n} записів · {currency}',
    emptyTitle: 'Ще немає витрат', emptyText: 'Запишіть першу маленьку витрату.', newEntry: '＋ Додати витрату', deleteExpense: 'Видалити {category} {amount}',
    unknownConsumer: 'Не вказано', back: 'Назад', manageIntro: 'Нова назва. Нова маленька іконка.', addCategory: '＋ Додати категорію', resetCategories: 'Стандартні', saveCategories: 'Зберегти',
    categoryName: 'Назва категорії: {name}', categoryIcon: 'Іконка: {name}', categoryColor: 'Колір: {name}', removeCategory: 'Прибрати категорію: {name}',
    bowl: 'Миска', book: 'Книга', bag: 'Сумка', game: 'Геймпад', plane: 'Літак', spark: 'Зірка', heart: 'Серце', coffee: 'Кава',
    peach: 'Персиковий', blue: 'Блакитний', mint: 'М’ятний', pink: 'Рожевий', yellow: 'Жовтий', lavender: 'Лавандовий',
    stomach: 'Їжа', learning: 'Навчання', daily: 'Для дому', hobby: 'Захоплення', travel: 'Подорожі', other: 'Інше',
    loading: 'Відкриваємо…', localStorage: 'Лише в цьому браузері', remoteStorage: 'Синхронізовано', unavailable: 'Не вдалося відкрити', undo: 'Скасувати', closeNotice: 'Закрити повідомлення',
    saved: '{person} · {amount}, збережено.', removed: 'Витрату видалено.', restored: 'Витрату відновлено.', categoriesSaved: 'Категорії збережено.', currencyChanged: 'Валюту змінено на {currency}. Введіть суму ще раз.', maxDigits: 'До 8 цифр у цілій частині.', keepCategory: 'Залиште хоча б одну категорію.',
    errorCategoryCount: 'Залиште 1–18 категорій.', errorCategoryFormat: 'Неправильний формат категорії.', errorCategoryName: 'Назви мають бути унікальними й містити 1–24 символи.', errorIconColor: 'Оберіть правильну іконку та колір.', errorLanguage: 'Оберіть доступну мову.',
    errorExpenseId: 'Неправильний номер витрати.', errorAmount: 'Введіть правильну суму.', errorCategory: 'Оберіть категорію.', errorConsumer: 'Оберіть Xingrun або Liia.', errorNote: 'Нотатка може містити до 160 символів.', errorTimezone: 'Неправильний часовий пояс.',
    errorLocalData: 'Збережені дані пошкоджено. Спочатку зробіть резервну копію.', errorLocalSpace: 'Сховище браузера недоступне або заповнене. Витрату не збережено.', errorMissing: 'Цієї витрати вже немає.', errorRestore: 'Не вдалося відновити витрату.',
    errorNetwork: 'З’єднання перервано. Результат не підтверджено; спробуйте ще раз.', errorAuth: 'Відкрийте застосунок через Telegram-бота для входу.', errorSave: 'Не вдалося зберегти. Спробуйте ще раз.', errorConnect: 'Немає з’єднання. Оновіть сторінку й спробуйте ще раз.', errorBot: 'Сервер бота ще не налаштовано.', errorCapacity: 'Сховище витрат заповнене. Зробіть резервну копію та збільште сховище.', errorOrigin: 'Джерело запиту не збігається.', errorDeleted: 'Цю витрату видалено. Введіть її знову.',
  },
};
export function translate(language, key, values = {}) {
  const message = MESSAGES[language]?.[key] ?? MESSAGES.zh[key];
  if (message === undefined) throw new Error(`Missing translation: ${key}`);
  return message.replace(/\{(\w+)\}/g, (_, field) => String(values[field] ?? ''));
}
export function categoryLabel(category, language) {
  const original = DEFAULT_CATEGORIES.find(item => item.id === category.id && item.label === category.label);
  return original ? translate(language, original.id) : category.label;
}
export function translateError(message, language) {
  const key = Object.keys(MESSAGES.zh).find(key => key.startsWith('error') && MESSAGES.zh[key] === message);
  const aliases = {
    '请从 Telegram bot 重新打开。': 'errorAuth', '找不到这笔记录。': 'errorMissing',
    '暂时没有保存成功，请稍后重试。': 'errorSave', '账本已达 10000 笔容量，请备份后扩展存储。': 'errorCapacity',
  };
  if (key || aliases[message]) return translate(language, key || aliases[message]);
  if (Object.values(MESSAGES[language]).includes(message)) return message;
  return translate(language, 'errorSave');
}

