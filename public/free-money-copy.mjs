const copy = {
  zh: {
    daily: '每天自由花', income: '每月收入', fixed: '固定开销', savings: '先存起来', payday: '每月发薪日',
    setup: '把每月的钱安排一下', reserve: '留一点给未来', next: '继续', review: '每天的份额', save: '放进口袋', saved: '放好啦',
    adjust: '调整', close: '收好', pause: '暂停自由金', paused: '已暂停', day: '日',
    intro: '留好固定开销，剩下的慢慢花。', reserveHint: '不存也可以，填 0 就好。', paydayHint: '遇到没有这一天的月份，按月末计算。',
    cycle: '本轮 {days} 天 · {start}—{end}', today: '今天还可用', spent: '今天已花', balance: '这轮还剩',
    optional: '看看这一轮', optionalHint: '可选，数字已算好。', analyzing: '翻翻这轮记录…', analysisFailed: '刚才没翻到，还是可以直接保存。',
    analysisEmpty: '这轮数字都在上面，照自己的节奏来。', incomeError: '填一个大于 0 的收入金额。', moneyError: '检查一下金额和小数位。',
    reservedError: '固定开销和存下的钱，合计不能超过收入。', paydayError: '填 1—31 之间的日期。', saveError: '还没保存好，再试一次就好。',
    reserveTotal: '这轮自由金', editHint: '收入或安排有变化时，再来改就好。',
  },
  en: {
    daily: 'Yours to spend each day', income: 'Monthly income', fixed: 'Fixed costs', savings: 'Set aside', payday: 'Monthly payday',
    setup: 'Make a little room', reserve: 'Keep a little for later', next: 'Continue', review: 'Your daily share', save: 'Put it in my pocket', saved: 'All tucked away',
    adjust: 'Adjust', close: 'Done', pause: 'Pause this pocket', paused: 'Paused', day: 'day',
    intro: 'Cover the essentials. The rest is yours.', reserveHint: 'Nothing to set aside? Leave it at 0.', paydayHint: 'Shorter months use their last day.',
    cycle: '{days} days · {start}–{end}', today: 'Left for today', spent: 'Spent today', balance: 'Left this cycle',
    optional: 'Take a closer look', optionalHint: 'Optional. Your numbers are ready.', analyzing: 'Looking over this cycle…', analysisFailed: 'That did not load. You can still save your pocket.',
    analysisEmpty: 'Your numbers are above. Go at your own pace.', incomeError: 'Enter an income greater than 0.', moneyError: 'Check the amount and decimal places.',
    reservedError: 'Fixed costs and savings cannot add up to more than your income.', paydayError: 'Use a day from 1 to 31.', saveError: 'That did not save. Give it another try.',
    reserveTotal: 'This cycle’s pocket', editHint: 'Come back whenever your plans change.',
  },
  uk: {
    daily: 'На щоденні бажання', income: 'Дохід на місяць', fixed: 'Обов’язкові витрати', savings: 'Відкласти', payday: 'День зарплати',
    setup: 'Розкладемо все по місцях', reserve: 'Трохи на потім', next: 'Далі', review: 'На кожен день', save: 'До кишеньки', saved: 'Усе на місці',
    adjust: 'Змінити', close: 'Готово', pause: 'Призупинити', paused: 'Призупинено', day: 'число',
    intro: 'Відкладемо на необхідне. Решта — на ваші бажання.', reserveHint: 'Не плануєте відкладати? Залиште 0.', paydayHint: 'У коротшому місяці беремо його останній день.',
    cycle: '{days} дн. · {start}–{end}', today: 'Ще можна сьогодні', spent: 'Витрачено сьогодні', balance: 'Залишок цього періоду',
    optional: 'Зазирнути в записи', optionalHint: 'За бажанням. Суми вже пораховано.', analyzing: 'Переглядаємо записи…', analysisFailed: 'Не вдалося завантажити. Зберегти суми все одно можна.',
    analysisEmpty: 'Усі суми вище. Рухайтеся у своєму темпі.', incomeError: 'Вкажіть дохід, більший за 0.', moneyError: 'Перевірте суму та знаки після коми.',
    reservedError: 'Витрати й заощадження разом не можуть перевищувати дохід.', paydayError: 'Вкажіть число від 1 до 31.', saveError: 'Не збереглося. Спробуймо ще раз.',
    reserveTotal: 'У кишеньці на цей період', editHint: 'Плани змінилися? Тут усе можна поправити.',
  },
};

export function freeMoneyCopy(language, key, params = {}) {
  return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), (copy[language] || copy.en)[key] || key);
}
