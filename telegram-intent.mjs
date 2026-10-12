// Fast, high-confidence routes. Ambiguous colloquial notes get a model vote;
// an explicit transaction can never be demoted to banter by that vote.
export function textIntent(text) {
  const value = String(text || '').normalize('NFKC').trim();
  const number = /\d|[零一二两三四五六七八九十百千万]|\b(?:hundred|thousand|fifty|twenty)\b|(?:сот|тисяч|п'ятсот|п’ятсот)/iu.test(value);
  const currency = /[¥$₴€£]|日元|円|元|块|人民币|美元|грив|\b(?:yen|yuan|dollars?|uah|jpy|usd|cny|eur)\b/iu.test(value);
  const explicit = /记(?:账|一笔|下这|一下)|入账|记录.{0,8}(?:花|支出|收入)|\b(?:log|record|add)\b.{0,25}\b(?:expense|payment|spent|income)\b|запиши|записати|занеси/iu.test(value);
  const paid = /花了|买了|付了|消费了|支出了|转给|转账|代付|报销|扣了|到账|收入|退款|\b(?:spent|bought|paid|purchased|charged|received|refunded|transfer(?:red)?)\b|витрати[вл]|купи[вл]|оплати[вл]|переказа[вл]|отрима[вл]|відда[вл]|віддала|заплати[вл]/iu.test(value);
  const future = /明天|后天|下周|打算|准备|想(?:要)?|tomorrow|next\s+(?:day|week)|planning\s+to|going\s+to|завтра|післязавтра|наступн|планую|хочу/iu.test(value);
  if (explicit) return 'expense';
  if (future && !paid) return 'chat';
  if (/^[\d.,\s]+$/u.test(value) && /\d/u.test(value)) return 'expense';
  if (paid && (number || currency)) return 'expense';
  const purpose = /拉面|咖啡|午饭|午餐|晚饭|晚餐|早餐|房租|打车|外卖|超市|便利店|便当|奶茶|水电|\b(?:lunch|dinner|breakfast|coffee|ramen|rent|taxi|groceries|netflix)\b|обід|вечер|снідан|кав[аиу]|оренд|таксі|продукт/iu.test(value);
  if (purpose && (number || currency)) return 'expense';
  if (/(?:^|\s)(?:I have|I've got)\s+\d+\s+(?:cats?|dogs?|kids?|minutes?)\b|有\d+只|\d+\s*(?:коти|котів|собаки|собак)/iu.test(value)) return 'chat';
  if (!number && !currency && !paid && /你好|晚安|好累|在干嘛|吃了吗|吃什么|\b(?:hello|hi|good night|tired|how are you)\b|привіт|надобраніч|втоми/iu.test(value)) return 'chat';
  return 'ambiguous';
}

export function intentFallback(text) {
  // A terse merchant + price note remains useful if classification is offline.
  return textIntent(text) === 'expense' || /[¥$₴€£]|(?:^|\s)\d+(?:[.,]\d+)?\s*$|\d+(?:元|円|块|日元)/u.test(String(text)) ? 'expense' : 'chat';
}
