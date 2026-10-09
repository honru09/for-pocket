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
    manageMembers: '记账角色', manageMembersIntro: '自定义昵称与专属颜色。', addConsumer: '＋ 添加角色', removeConsumer: '移除角色：{name}', saveMembers: '保存角色', keepConsumer: '至少保留一个角色。',
    consumerName: '角色昵称：{name}', consumerColor: '颜色：{name}',
    sharedLedger: '双人共享账本', sharedLedgerIntro: '两个人连接后，实时同步账本数据。', myShareCode: '我的账本共享码', copyCode: '点击复制', codeCopied: '共享码已复制',
    connectPartner: '连接另一半', partnerCodePlaceholder: '输入对方的 6 位共享码', connectButton: '建立连接', connecting: '正在连接…',
    pairedStatus: '已与 {partner} 共享账本', unpairButton: '解除共享', unpairing: '正在解除…', pairedSuccess: '已连接另一半，账本数据现已同步共享！', unpairedSuccess: '已解除共享，账本恢复独立。',
    expense: '出账', income: '入账', todayExpense: '今日出账', todayIncome: '今日入账', todayBalance: '今日结余', allIncome: '全部入账', monthIncome: '本月入账', netBalance: '净结余',
    wage: '工资', bonus: '奖金', redpacket: '红包', parttime: '兼职', reimburse: '报销', other_in: '其他入账',
    googleLogin: 'Google 账号登录', googleLinked: 'Google 已连携', googleNotLinked: '未连携 Google', linkGoogle: '连携 Google',
    tgLinked: 'Telegram 已连携', tgNotLinked: '未连携 Telegram', linkTg: '连携 Telegram',
    linkCodeLabel: '多端连携码', linkCodePlaceholder: '输入 6 位连携码', linkButton: '确认连携', linking: '正在连携…', linkSuccess: '连携成功！多端数据已全部共通。',
    friends: '好友', circles: '好友圈', myFriendCode: '我的好友码', friendCodePlaceholder: '输入对方 6 位好友码', addFriend: '添加好友', addingFriend: '正在添加…', friendAdded: '已成功添加好友！', friendList: '我的好友', noFriends: '还没有好友，输入好友码添加吧。',
    circleMax4: '好友圈（最多4人）', createCircle: '创建好友圈', circleNamePlaceholder: '圈子名称（如：温馨小窝）', selectFriends: '从好友中邀请（最多3位好友）', needFriendsFirst: '请先添加对方为好友，再邀请加入圈子。', currentCircle: '当前圈子', leaveCircle: '退出圈子', circleCreated: '好友圈已创建！圈内成员可共同记账。', circleJoined: '已加入好友圈！',
    wallet: '钱包', coins: '硬币', gift: '礼物', receipt: '票据', piggy: '存钱罐', card: '银行卡', transfer: '转账', users: '好友圈',
    categoryName: '分类名称：{name}', categoryIcon: '图标：{name}', categoryColor: '颜色：{name}', removeCategory: '移除分类：{name}',
    bowl: '热乎饭', book: '小书本', bag: '购物袋', game: '游戏机', plane: '小飞机', spark: '小星星', heart: '小爱心', coffee: '咖啡杯',
    cat: '小猫咪', bunny: '小兔子', bear: '小熊', chick: '小鸡仔', fox: '小狐狸', panda: '大熊猫', flower: '向日葵', sprout: '小豆芽', star: '小星星',
    peach: '蜜桃', blue: '天空', mint: '薄荷', pink: '樱花', yellow: '奶黄', lavender: '薰衣草', milk: '奶白', sage: '鼠尾草',
    stomach: '胃', learning: '学习', daily: '日常用品', hobby: '兴趣', travel: '旅游', other: '其他',
    loading: '正在打开…', localStorage: '仅保存在此浏览器', remoteStorage: '已同步', unavailable: '暂时无法打开', undo: '撤销', closeNotice: '关闭提示',
    saved: '{person} · {amount}，记下啦。', savedIncome: '{person} · +{amount}，入账啦。', removed: '已移除这笔。', restored: '已恢复这笔。', categoriesSaved: '分类已保存。', membersSaved: '角色已保存。', currencyChanged: '已切换为 {currency}，请重新输入金额。', maxDigits: '最多输入 8 位整数。', keepCategory: '至少保留一个分类。',
    switchCircle: '切换圈子', defaultLedger: '个人 / 双人账本', switchToDefaultLedger: '切回个人账本', generateLinkCode: '生成设备同步码', syncCodeHint: '在另一台设备输入此码即可将两端数据合并（15分钟内有效）：',
    errorCategoryCount: '请保留 1–18 个分类。', errorCategoryFormat: '分类格式有误。', errorCategoryName: '分类名称需为 1–24 个字，且不能重复。', errorIconColor: '请选择有效的图标和颜色。', errorLanguage: '请选择有效的语言。',
    errorConsumerCount: '请保留 1–8 位记账角色。', errorConsumerName: '角色名称需为 1–24 个字，且不能重复。',
    errorInvalidCode: '请输入有效的 6 位共享码。', errorSelfPair: '不能连接自己的共享码。', errorPairNotFound: '未找到该共享码对应的账本。',
    errorExpenseId: '记录编号有误。', errorAmount: '请输入有效金额。', errorCategory: '请选择一个花销方向。', errorConsumer: '请选择有效的记账角色。', errorNote: '备注最多 160 个字符。', errorTimezone: '时区格式有误。',
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
    manageMembers: 'Members', manageMembersIntro: 'Custom nicknames and personal colors.', addConsumer: '＋ Add member', removeConsumer: 'Remove member: {name}', saveMembers: 'Save members', keepConsumer: 'Keep at least one member.',
    consumerName: 'Nickname: {name}', consumerColor: 'Color: {name}',
    sharedLedger: 'Shared Ledger', sharedLedgerIntro: 'Connect together to share one live ledger.', myShareCode: 'My ledger code', copyCode: 'Copy code', codeCopied: 'Code copied',
    connectPartner: 'Connect partner', partnerCodePlaceholder: 'Enter partner’s 6-character code', connectButton: 'Connect', connecting: 'Connecting…',
    pairedStatus: 'Sharing ledger with {partner}', unpairButton: 'Disconnect', unpairing: 'Disconnecting…', pairedSuccess: 'Connected! Your ledgers are now synced.', unpairedSuccess: 'Disconnected. Your ledger is now independent.',
    expense: 'Expense', income: 'Income', todayExpense: "Today's expense", todayIncome: "Today's income", todayBalance: "Today's balance", allIncome: 'Total income', monthIncome: 'This month income', netBalance: 'Net balance',
    wage: 'Salary', bonus: 'Bonus', redpacket: 'Red packet', parttime: 'Side hustle', reimburse: 'Reimbursement', other_in: 'Other income',
    googleLogin: 'Sign in with Google', googleLinked: 'Google linked', googleNotLinked: 'Google not linked', linkGoogle: 'Link Google',
    tgLinked: 'Telegram linked', tgNotLinked: 'Telegram not linked', linkTg: 'Link Telegram',
    linkCodeLabel: 'Sync code', linkCodePlaceholder: 'Enter 6-digit sync code', linkButton: 'Link', linking: 'Linking…', linkSuccess: 'Linked! Data unified across all devices.',
    friends: 'Friends', circles: 'Circles', myFriendCode: 'My friend code', friendCodePlaceholder: 'Enter 6-digit code', addFriend: 'Add friend', addingFriend: 'Adding…', friendAdded: 'Friend added!', friendList: 'My friends', noFriends: 'No friends yet.',
    circleMax4: 'Circle (Max 4)', createCircle: 'Create Circle', circleNamePlaceholder: 'Circle name', selectFriends: 'Select friends (up to 3)', needFriendsFirst: 'Add as friend first before inviting.', currentCircle: 'Current Circle', leaveCircle: 'Leave Circle', circleCreated: 'Circle created!', circleJoined: 'Joined circle!',
    wallet: 'Wallet', coins: 'Coins', gift: 'Gift', receipt: 'Receipt', piggy: 'Piggy bank', card: 'Card', transfer: 'Transfer', users: 'Circle',
    categoryName: 'Category name: {name}', categoryIcon: 'Icon: {name}', categoryColor: 'Color: {name}', removeCategory: 'Remove category: {name}',
    bowl: 'Bowl', book: 'Book', bag: 'Bag', game: 'Gamepad', plane: 'Plane', spark: 'Star', heart: 'Heart', coffee: 'Coffee',
    cat: 'Cat', bunny: 'Bunny', bear: 'Bear', chick: 'Chick', fox: 'Fox', panda: 'Panda', flower: 'Flower', sprout: 'Sprout', star: 'Star',
    peach: 'Peach', blue: 'Sky', mint: 'Mint', pink: 'Pink', yellow: 'Yellow', lavender: 'Lavender', milk: 'Milk', sage: 'Sage',
    stomach: 'Food', learning: 'Learning', daily: 'Daily needs', hobby: 'Hobbies', travel: 'Travel', other: 'Other',
    loading: 'Opening…', localStorage: 'Saved in this browser only', remoteStorage: 'Synced', unavailable: 'Unable to open', undo: 'Undo', closeNotice: 'Dismiss notice',
    saved: '{person} · {amount}, saved.', savedIncome: '{person} · +{amount}, income added.', removed: 'Expense removed.', restored: 'Expense restored.', categoriesSaved: 'Categories saved.', membersSaved: 'Members saved.', currencyChanged: 'Switched to {currency}. Enter the amount again.', maxDigits: 'Up to 8 whole-number digits.', keepCategory: 'Keep at least one category.',
    switchCircle: 'Switch circle', defaultLedger: 'Personal / Pair ledger', switchToDefaultLedger: 'Switch to personal ledger', generateLinkCode: 'Generate sync code', syncCodeHint: 'Enter this 6-digit code on another device to merge and link data (valid for 15 mins):',
    errorCategoryCount: 'Keep 1–18 categories.', errorCategoryFormat: 'Invalid category format.', errorCategoryName: 'Names must be unique and contain 1–24 characters.', errorIconColor: 'Choose a valid icon and color.', errorLanguage: 'Choose a valid language.',
    errorConsumerCount: 'Keep 1–8 members.', errorConsumerName: 'Member names must be unique and contain 1–24 characters.',
    errorInvalidCode: 'Enter a valid 6-character code.', errorSelfPair: 'You cannot connect to your own code.', errorPairNotFound: 'No ledger found with this code.',
    errorExpenseId: 'Invalid expense ID.', errorAmount: 'Enter a valid amount.', errorCategory: 'Choose a category.', errorConsumer: 'Choose a valid member.', errorNote: 'Notes can contain up to 160 characters.', errorTimezone: 'Invalid time zone.',
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
    manageMembers: 'Учасники', manageMembersIntro: 'Власні імена та кольори.', addConsumer: '＋ Додати учасника', removeConsumer: 'Видалити: {name}', saveMembers: 'Зберегти', keepConsumer: 'Залиште хоча б одного учасника.',
    consumerName: 'Ім’я: {name}', consumerColor: 'Колір: {name}',
    sharedLedger: 'Спільний бюджет', sharedLedgerIntro: 'Спільний доступ до одного бюджету.', myShareCode: 'Мій код доступу', copyCode: 'Скопіювати', codeCopied: 'Код скопійовано',
    connectPartner: 'Підключити партнера', partnerCodePlaceholder: '6-значний код партнера', connectButton: 'Підключитися', connecting: 'Підключення…',
    pairedStatus: 'Спільний доступ із {partner}', unpairButton: 'Відключити', unpairing: 'Відключення…', pairedSuccess: 'Успішно підключено! Дані синхронізовано.', unpairedSuccess: 'Спільний доступ скасовано.',
    expense: 'Витрата', income: 'Надходження', todayExpense: 'Сьогодні витрачено', todayIncome: 'Сьогодні отримано', todayBalance: 'Баланс дня', allIncome: 'Всього надходжень', monthIncome: 'Надходження місяця', netBalance: 'Чистий залишок',
    wage: 'Зарплата', bonus: 'Бонус', redpacket: 'Подарунок', parttime: 'Підробіток', reimburse: 'Компенсація', other_in: 'Інші надходження',
    googleLogin: 'Увійти через Google', googleLinked: 'Google привʼязано', googleNotLinked: 'Google не привʼязано', linkGoogle: 'Привʼязати Google',
    tgLinked: 'Telegram привʼязано', tgNotLinked: 'Telegram не привʼязано', linkTg: 'Привʼязати Telegram',
    linkCodeLabel: 'Код синхронізації', linkCodePlaceholder: 'Введіть 6-значний код', linkButton: 'Привʼязати', linking: 'Привʼязка…', linkSuccess: 'Успішно привʼязано!',
    friends: 'Друзі', circles: 'Кола друзів', myFriendCode: 'Мій код друга', friendCodePlaceholder: 'Введіть код друга', addFriend: 'Додати друга', addingFriend: 'Додавання…', friendAdded: 'Друга додано!', friendList: 'Мої друзі', noFriends: 'Ще немає друзів.',
    circleMax4: 'Коло друзів (макс. 4)', createCircle: 'Створити коло', circleNamePlaceholder: 'Назва кола', selectFriends: 'Виберіть друзів (до 3)', needFriendsFirst: 'Спочатку додайте в друзі.', currentCircle: 'Поточне коло', leaveCircle: 'Вийти з кола', circleCreated: 'Коло створено!', circleJoined: 'Приєднано до кола!',
    wallet: 'Гаманець', coins: 'Монети', gift: 'Подарунок', receipt: 'Чек', piggy: 'Скарбничка', card: 'Картка', transfer: 'Переказ', users: 'Коло',
    categoryName: 'Назва категорії: {name}', categoryIcon: 'Іконка: {name}', categoryColor: 'Колір: {name}', removeCategory: 'Прибрати категорію: {name}',
    bowl: 'Миска', book: 'Книга', bag: 'Сумка', game: 'Геймпад', plane: 'Літак', spark: 'Зірка', heart: 'Серце', coffee: 'Кава',
    cat: 'Котик', bunny: 'Зайчик', bear: 'Ведмедик', chick: 'Курча', fox: 'Лисичка', panda: 'Панда', flower: 'Квітка', sprout: 'Паросток', star: 'Зірка',
    peach: 'Персиковий', blue: 'Блакитний', mint: 'М’ятний', pink: 'Рожевий', yellow: 'Жовтий', lavender: 'Лавандовий', milk: 'Молочний', sage: 'Шавлієвий',
    stomach: 'Їжа', learning: 'Навчання', daily: 'Для дому', hobby: 'Захоплення', travel: 'Подорожі', other: 'Інше',
    loading: 'Відкриваємо…', localStorage: 'Лише в цьому браузері', remoteStorage: 'Синхронізовано', unavailable: 'Не вдалося відкрити', undo: 'Скасувати', closeNotice: 'Закрити повідомлення',
    saved: '{person} · {amount}, збережено.', savedIncome: '{person} · +{amount}, надходження збережено.', removed: 'Витрату видалено.', restored: 'Витрату відновлено.', categoriesSaved: 'Категорії збережено.', membersSaved: 'Учасників збережено.', currencyChanged: 'Валюту змінено на {currency}. Введіть суму ще раз.', maxDigits: 'До 8 цифр у цілій частині.', keepCategory: 'Залиште хоча б одну категорію.',
    switchCircle: 'Змінити коло', defaultLedger: 'Особистий бюджет', switchToDefaultLedger: 'Повернутися до особистого', generateLinkCode: 'Створити код синхронізації', syncCodeHint: 'Введіть цей код на іншому пристрої, щоб об’єднати дані (діє 15 хв):',
    errorCategoryCount: 'Залиште 1–18 категорій.', errorCategoryFormat: 'Неправильний формат категорії.', errorCategoryName: 'Назви мають бути унікальними й містити 1–24 символи.', errorIconColor: 'Оберіть правильну іконку та колір.', errorLanguage: 'Оберіть доступну мову.',
    errorConsumerCount: 'Залиште 1–8 учасників.', errorConsumerName: 'Імена мають бути унікальними й містити 1–24 символи.',
    errorInvalidCode: 'Введіть правильний 6-значний код.', errorSelfPair: 'Не можна підключитися до власного коду.', errorPairNotFound: 'Бюджет за цим кодом не знайдено.',
    errorExpenseId: 'Неправильний номер витрати.', errorAmount: 'Введіть правильну суму.', errorCategory: 'Оберіть категорію.', errorConsumer: 'Оберіть учасника.', errorNote: 'Нотатка може містити до 160 символів.', errorTimezone: 'Неправильний часовий пояс.',
    errorLocalData: 'Збережені дані пошкоджено. Спочатку зробіть резервну копію.', errorLocalSpace: 'Сховище браузера недоступне або заповнене. Витрату не збережено.', errorMissing: 'Цієї витрати вже немає.', errorRestore: 'Не вдалося відновити витрату.',
    errorNetwork: 'З’єднання перервано. Результат не підтверджено; спробуйте ще раз.', errorAuth: 'Відкрийте застосунок через Telegram-бота для входу.', errorSave: 'Не вдалося зберегти. Спробуйте ще раз.', errorConnect: 'Немає з’єднання. Оновіть сторінку й спробуйте ще раз.', errorBot: 'Сервер бота ще не налаштовано.', errorCapacity: 'Сховище витрат заповнене. Зробіть резервну копію та збільште сховище.', errorOrigin: 'Джерело запиту не збігається.', errorDeleted: 'Цю витрату видалено. Введіть її знову.',
  },
};
export function translate(language, key, values = {}) {
  const message = MESSAGES[language]?.[key] ?? MESSAGES.zh[key];
  if (message === undefined) throw new Error(`Missing translation: ${key}`);
  return message.replace(/\{(\w+)\}/g, (_, field) => String(values[field] ?? ''));
}
const DEFAULT_LABEL_MAP = {
  stomach: ['胃', 'Food', 'Їжа'],
  learning: ['学习', 'Learning', 'Навчання'],
  daily: ['日常用品', 'Daily needs', 'Для дому'],
  hobby: ['兴趣', 'Hobbies', 'Захоплення'],
  travel: ['旅游', 'Travel', 'Подорожі'],
  other: ['其他', 'Other', 'Інше'],
  wage: ['工资', 'Salary', 'Зарплата'],
  bonus: ['奖金', 'Bonus', 'Бонус'],
  redpacket: ['红包', 'Red packet', 'Подарунок'],
  parttime: ['兼职', 'Side hustle', 'Підробіток'],
  reimburse: ['报销', 'Reimbursement', 'Компенсація'],
  other_in: ['其他入账', 'Other income', 'Інші надходження'],
};
export function categoryLabel(category, language) {
  const standard = DEFAULT_LABEL_MAP[category.id];
  if (standard && standard.includes(category.label)) {
    return translate(language, category.id);
  }
  return category.label;
}
export function translateError(message, language) {
  if (!message) return translate(language, 'errorSave');
  const key = Object.keys(MESSAGES.zh).find(k => k.startsWith('error') && MESSAGES.zh[k] === message);
  const aliases = {
    '请从 Telegram bot 重新打开。': 'errorAuth',
    '找不到这笔记录。': 'errorMissing',
    '暂时没有保存成功，请稍后重试。': 'errorSave',
    '账本已达 10000 笔容量，请备份后扩展存储。': 'errorCapacity',
    '请求来源不匹配。': 'errorOrigin',
  };
  if (key || aliases[message]) return translate(language, key || aliases[message]);
  if (Object.values(MESSAGES[language] || {}).includes(message)) return message;
  return message;
}

