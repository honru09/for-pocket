import { dateKey, validateEntryTime } from './public/shared.mjs';

const chineseDigits = { 零:0, 〇:0, 一:1, 二:2, 两:2, 兩:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
function number(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (value.includes('十')) {
    const [tens, units] = value.split('十');
    return (tens ? chineseDigits[tens] : 1) * 10 + (units ? chineseDigits[units] : 0);
  }
  return [...value].reduce((result, digit) => result * 10 + chineseDigits[digit], 0);
}
const englishHours = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };
const ukrainianHours = { першій:1, другій:2, третій:3, четвертій:4, "п'ятій":5, 'п’ятій':5, шостій:6, сьомій:7, восьмій:8, "дев'ятій":9, 'дев’ятій':9, десятій:10, одинадцятій:11, дванадцятій:12 };

export function explicitClock(source) {
  const text = String(source || '').toLowerCase(), clocks = [];
  let invalid = false;
  function add(hour, minute = 0, period = '', ambiguous = false) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) { invalid = true; return; }
    if (/下午|傍晚|晚上|晚间|夜里|下午|pm|p\.m|afternoon|evening|дня|вечора/.test(period) && hour < 12) hour += 12;
    if (/中午|午间|noon|опівдні/.test(period) && hour < 11) hour += 12;
    if (/凌晨|午夜|晚上|晚间|夜里|am|a\.m|morning|ранку|ночі/.test(period) && hour === 12) hour = 0;
    if (period) ambiguous = false;
    clocks.push({ hour, minute, ambiguous });
  }
  for (const match of text.matchAll(/(?<!\d)(凌晨|清晨|早上|上午|中午|午间|下午|傍晚|晚上|晚间|夜里|午夜)?\s*(\d{1,2}|[零〇一二两兩三四五六七八九十]{1,3})[点點时時](?:\s*(半|一刻|三刻|[零〇一二两兩三四五六七八九十]{1,3}|\d{1,2})(?:分(?:钟)?)?(?!\d))?/g)) {
    const hour = number(match[2]), minutes = { 半:30, 一刻:15, 三刻:45 };
    add(hour, match[3] ? minutes[match[3]] ?? number(match[3]) : 0, match[1] || '', hour >= 1 && hour <= 12);
  }
  for (const match of text.matchAll(/(?<![\d/])(\d{1,2})[:：](\d{2})(?!\d)\s*(a\.?m\.?|p\.?m\.?|in the morning|in the afternoon|in the evening|ранку|дня|вечора|ночі)?/g)) {
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    const period = match[3] || before.match(/(?:凌晨|早上|上午|中午|下午|傍晚|晚上|晚间|morning|evening)\s*$/)?.[0] || '';
    add(Number(match[1]), Number(match[2]), period);
  }
  for (const match of text.matchAll(/(?<![\d:])\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*o['’]?clock)?\s*(a\.?m\.?|p\.?m\.?|noon|in the morning|in the afternoon|in the evening)\b/g)) {
    add(englishHours[match[1]] ?? Number(match[1]), 0, match[2]);
  }
  for (const match of text.matchAll(/(?<!\p{L})(?:о|об)\s+(\d{1,2}|першій|другій|третій|четвертій|п['’]ятій|шостій|сьомій|восьмій|дев['’]ятій|десятій|одинадцятій|дванадцятій)(?![\d:：])(?:\s+годині)?(?:\s+(ранку|дня|вечора|ночі))?/gu)) {
    const hour = ukrainianHours[match[1]] ?? Number(match[1]);
    add(hour, 0, match[2] || '', hour >= 1 && hour <= 12);
  }
  if (/\bnoon\b|опівдні|正午/.test(text)) add(12);
  if (/\bmidnight\b|опівночі/.test(text)) add(0);
  const unique = [...new Map(clocks.map(clock => [clock.hour + ':' + clock.minute, clock])).values()];
  if (invalid || unique.length > 1) return { uncertain: true };
  return unique[0] || null;
}

function calendarDay(source, anchor, timezone) {
  const text = String(source || '').toLowerCase();
  const localToday = dateKey(new Date(anchor), timezone);
  const dates = [], ranges = [];
  const add = (year, month, day) => dates.push(String(year) + '-' + String(month).padStart(2,'0') + '-' + String(day).padStart(2,'0'));
  for (const match of text.matchAll(/(?<!\d)((?:19|20|21)\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})日?(?!\d)/g)) {
    add(match[1], match[2], match[3]); ranges.push([match.index, match.index + match[0].length]);
  }
  for (const match of text.matchAll(/(?<!\d)(\d{1,2})月(\d{1,2})[日号號](?!\d)/g)) {
    if (!ranges.some(([start,end]) => match.index >= start && match.index < end)) add(localToday.slice(0,4), match[1], match[2]);
  }
  const months = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12,
    січня:1, лютого:2, березня:3, квітня:4, травня:5, червня:6, липня:7, серпня:8, вересня:9, жовтня:10, листопада:11, грудня:12 };
  const names = Object.keys(months).join('|');
  const monthFirst = new RegExp('(?<!\\p{L})(' + names + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?(?!\\d)', 'gu');
  const dayFirst = new RegExp('(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + names + ')(?:,?\\s+(20\\d{2}))?(?!\\p{L})', 'gu');
  for (const match of text.matchAll(monthFirst)) add(match[3] || localToday.slice(0,4), months[match[1]], match[2]);
  for (const match of text.matchAll(dayFirst)) add(match[3] || localToday.slice(0,4), months[match[2]], match[1]);
  const relatives = [
    [-2, /前天|позавчора|day before yesterday/],
    [2, /后天|後天|післязавтра|day after tomorrow/],
    [-1, /昨天|昨日|вчора|yesterday/],
    [1, /明天|завтра|tomorrow/],
    [0, /今天|今日|сьогодні|today/],
  ];
  // Remove longer relative phrases before matching their shorter suffixes.
  let remaining = text;
  for (const [offset,pattern] of relatives) if (pattern.test(remaining)) {
    const date = new Date(localToday + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + offset); dates.push(date.toISOString().slice(0,10));
    remaining = remaining.replace(new RegExp(pattern.source, 'g'), '');
  }
  const unique = [...new Set(dates)];
  if (unique.length > 1) return { uncertain:true, explicit:true };
  return { day:unique[0] || localToday, explicit:Boolean(unique.length) };
}

function wallParts(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Date.UTC(Number(values.year), Number(values.month)-1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
}

// Convert a wall-clock value exactly once. Gaps and repeated DST hours require
// review rather than silently choosing a different time or offset.
export function localDateTimeToUtc(day, hour, minute, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const local = day + 'T' + String(hour).padStart(2,'0') + ':' + String(minute).padStart(2,'0') + ':00.000Z';
  const target = Date.parse(local);
  if (!Number.isFinite(target) || new Date(target).toISOString() !== local) return null;
  let timestamp = target;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const difference = target - wallParts(timestamp, timezone);
      if (!difference) break;
      timestamp += difference;
    }
    if (wallParts(timestamp, timezone) !== target) return null;
    for (const offset of [-7200000,-3600000,3600000,7200000]) if (wallParts(timestamp + offset, timezone) === target) return null;
    return validateEntryTime(new Date(timestamp).toISOString(), timezone).occurredAt;
  } catch { return null; }
}

function explicitInstant(value) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/i);
  if (!match) return null;
  const [,day,hour,minute,second = '00',millisecond = '000',,sign,offsetHour = '00',offsetMinute = '00'] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || Number(offsetMinute) > 59 || Number(offsetHour) > 14 || Number(offsetHour) === 14 && Number(offsetMinute)) return null;
  const wall = `${day}T${hour}:${minute}:${second}.${millisecond}Z`;
  const timestamp = Date.parse(wall);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== wall) return null;
  const offset = (sign === '-' ? -1 : 1) * (Number(offsetHour) * 60 + Number(offsetMinute));
  return timestamp - offset * 60000;
}

export function resolveExpenseTime(raw, input, timezone) {
  const excerpt = String(input.recordText ?? raw.rawText ?? input.text ?? '');
  // For recordings/OCR the model is also the transcription source. Preserve
  // its dedicated quoted time evidence if the short excerpt omitted it.
  // Plain text and existing draft edits keep their original source of truth.
  const source = (input.file || input.image) && !input.previousRecord && raw.timeSource === 'explicit' && typeof raw.timeText === 'string'
    ? excerpt + ' ' + raw.timeText : excerpt;
  const instantPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})(?![\d:])/gi;
  const instants = [...source.matchAll(instantPattern)].map(match => explicitInstant(match[0]));
  if (instants.some(instant => instant === null)) return { occurredAt:null, dayKey:null, timezone, issue:'invalidLocalTime' };
  // An ISO date belongs to its own offset. Compare any additional relative
  // date against the instant's displayed day, not the timestamp's literal day.
  const daySource = source.replace(instantPattern, '');
  const zoneMatch = daySource.match(/(?<!\p{L})(?:UTC|GMT)(?:\s*([+-])(\d{1,2})(?::?(\d{2}))?)?(?![\p{L}\d:])/iu);
  if (zoneMatch && (Number(zoneMatch[3] || 0) > 59 || Number(zoneMatch[2] || 0) > 14 || Number(zoneMatch[2]) === 14 && Number(zoneMatch[3]))) return { occurredAt:null, dayKey:null, timezone, issue:'invalidLocalTime' };
  const zoneOffset = zoneMatch ? (zoneMatch[1] === '-' ? -1 : 1) * (Number(zoneMatch[2] || 0) * 60 + Number(zoneMatch[3] || 0)) : null;
  const day = calendarDay(daySource, zoneOffset == null ? input.now : new Date(input.now).getTime() + zoneOffset * 60000, zoneOffset == null ? timezone : 'UTC');
  if (day.uncertain) return { occurredAt:null, dayKey:null, timezone, issue:'ambiguousTime' };
  if (instants.length) {
    const unique = [...new Set(instants)];
    if (unique.length !== 1 || day.explicit && day.day !== dateKey(new Date(unique[0] + (zoneOffset || 0) * 60000), zoneOffset == null ? timezone : 'UTC')) return { occurredAt:null, dayKey:null, timezone, issue:'ambiguousTime' };
    try { return { ...validateEntryTime(new Date(unique[0]).toISOString(),timezone), issue:null }; }
    catch { return { occurredAt:null, dayKey:null, timezone, issue:'invalidLocalTime' }; }
  }
  const clock = explicitClock(zoneMatch ? source.replace(zoneMatch[0], '') : source);
  const convert = (localDay,hour,minute) => {
    const instant = localDateTimeToUtc(localDay,hour,minute,zoneOffset == null ? timezone : 'UTC');
    if (!instant || zoneOffset != null && Math.abs(zoneOffset) > 14 * 60) return null;
    return zoneOffset == null ? instant : new Date(Date.parse(instant) - zoneOffset * 60000).toISOString();
  };
  const document = input.image || input.file && !/^audio\//.test(input.file.mimeType);
  const dateEvidence = day.explicit || /上周|上星期|本周|这周|週|星期|周[一二三四五六日天]|last week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|понеділ|вівтор|серед|четвер|п['’]ятниц|субот|неділ|\d{1,4}[/.]\d{1,2}[/.]\d{1,4}/i.test(source);
  const structuredDay = dateEvidence && /^\d{4}-\d{2}-\d{2}$/.test(raw.localDate || '') ? raw.localDate : null;
  const previous = input.previousRecord;
  const vagueTime = !clock && /上午|下午(?!茶)|晚上|傍晚|凌晨|昨晚|昨夜|今早|昨早|今晚|(?:in the|this|last|yesterday|today|tomorrow)\s+(?:morning|afternoon|evening|night)|вранці|увечері/iu.test(source);
  if (vagueTime) return { occurredAt:null, dayKey:null, timezone, issue:'ambiguousTime' };
  if (!day.explicit && !dateEvidence && !clock && previous?.occurredAt) {
    try { return { ...validateEntryTime(previous.occurredAt, previous.timezone), issue:null }; } catch {}
  }
  if (clock?.uncertain) return { occurredAt:null, dayKey:null, timezone, issue:'ambiguousTime' };
  if (clock && !clock.ambiguous) {
    // A visible receipt date is required; an audio/text clock without a date
    // belongs to the sending day's local calendar.
    if (document && !day.explicit && !structuredDay) return { occurredAt:null, dayKey:null, timezone, issue:'missingTime' };
    if (dateEvidence && !day.explicit && !structuredDay) return { occurredAt:null, dayKey:null, timezone, issue:'missingTime' };
    const occurredAt = convert(day.explicit ? day.day : structuredDay || day.day, clock.hour, clock.minute);
    return { occurredAt, dayKey:occurredAt ? dateKey(new Date(occurredAt), timezone) : null, timezone, issue:occurredAt ? null : 'invalidLocalTime' };
  }
  if (clock?.ambiguous) {
    // Keep only a model interpretation consistent with the spoken hour and
    // minute, and require confirmation of AM/PM before automatic saving.
    try {
      const checked = validateEntryTime(raw.occurredAt, timezone);
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone:timezone, hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date(checked.occurredAt));
      const values = Object.fromEntries(parts.map(part => [part.type,part.value]));
      if (Number(values.hour) % 12 === clock.hour % 12 && Number(values.minute) === clock.minute) return { ...checked, issue:'ambiguousTime' };
    } catch {}
    return { occurredAt:null, dayKey:null, timezone, issue:'ambiguousTime' };
  }
  if (raw.timeSource === 'explicit' && raw.timeText && source.includes(raw.timeText) && /^\d{4}-\d{2}-\d{2}$/.test(raw.localDate || '') && /^\d{2}:\d{2}$/.test(raw.localTime || '')) {
    const [hour,minute] = raw.localTime.split(':').map(Number);
    const occurredAt = convert(day.explicit ? day.day : raw.localDate, hour, minute);
    return { occurredAt, dayKey:occurredAt ? dateKey(new Date(occurredAt),timezone) : null, timezone, issue:occurredAt ? null : 'invalidLocalTime' };
  }
  if (day.explicit) {
    const occurredAt = convert(day.day, 12, 0);
    return { occurredAt, dayKey:occurredAt ? dateKey(new Date(occurredAt),timezone) : null, timezone, issue:occurredAt ? null : 'invalidLocalTime' };
  }
  if (document && !day.explicit && !dateEvidence) return { occurredAt:null, dayKey:null, timezone, issue:'missingTime' };
  if (/^audio\//.test(input.file?.mimeType || '') && raw.timeSource !== 'unknown' && !dateEvidence) {
    return { ...validateEntryTime(new Date(input.now).toISOString(), timezone), issue:null };
  }
  try { return { ...validateEntryTime(raw.occurredAt, timezone), issue:null }; }
  catch { return { occurredAt:null, dayKey:null, timezone, issue:'missingTime' }; }
}
