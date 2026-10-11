import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explicitClock, localDateTimeToUtc, resolveExpenseTime } from '../expense-time.mjs';

const timezone = 'Asia/Tokyo';
const now = Date.parse('2026-10-11T05:46:00.000Z');
const voice = text => ({ now, recordText: text, file: { mimeType: 'audio/ogg' } });
const resolveVoice = (text, raw = {}, input = {}) => resolveExpenseTime(raw, { ...voice(text), ...input }, timezone);

test('spoken Chinese noon overrides a wrong model instant and converts Tokyo time once', () => {
  const result = resolveVoice('今天中午十二点在新宿吃拉面，1723日元', { occurredAt: '2026-10-11T12:30:00.000Z' });
  assert.equal(result.occurredAt, '2026-10-11T03:00:00.000Z');
  assert.equal(result.dayKey, '2026-10-11');
  assert.equal(result.issue, null);
});

test('Chinese half-hours and quarter-hours retain the spoken minutes', () => {
  for (const [text, expected] of [
    ['下午三点半买咖啡500日元', '2026-10-11T06:30:00.000Z'],
    ['早上八点一刻买早餐', '2026-10-10T23:15:00.000Z'],
    ['晚上九点三刻买宵夜', '2026-10-11T12:45:00.000Z'],
    ['凌晨十二点买水', '2026-10-10T15:00:00.000Z'],
    ['中午十二点三十分吃拉面', '2026-10-11T03:30:00.000Z'],
  ]) assert.equal(resolveVoice(text).occurredAt, expected, text);
});

test('24-hour notation is a local clock, not an already UTC value', () => {
  const result = resolveVoice('今天12:30吃拉面', { occurredAt: '2026-10-11T12:30:00.000Z' });
  assert.equal(result.occurredAt, '2026-10-11T03:30:00.000Z');
  assert.equal(result.issue, null);
});

test('English noon and 12-hour clock boundary are unambiguous', () => {
  for (const [text, hour, expected] of [
    ['today at noon, ramen 1723 yen', 12, '2026-10-11T03:00:00.000Z'],
    ['today at 12pm, lunch 1723 yen', 12, '2026-10-11T03:00:00.000Z'],
    ['today at 12am, water 100 yen', 0, '2026-10-10T15:00:00.000Z'],
    ['today at three in the afternoon, coffee 500 yen', 15, '2026-10-11T06:00:00.000Z'],
  ]) {
    assert.equal(explicitClock(text)?.hour, hour, text);
    assert.equal(resolveVoice(text).occurredAt, expected, text);
  }
});

test('English colon clocks do not also parse their minute suffix as a second hour', () => {
  for (const [text, expected] of [
    ['today 12:05pm ramen', '2026-10-11T03:05:00.000Z'],
    ['today 1:30pm coffee', '2026-10-11T04:30:00.000Z'],
    ['today 12:05am water', '2026-10-10T15:05:00.000Z'],
    ['today 8:09 am breakfast', '2026-10-10T23:09:00.000Z'],
  ]) {
    const result = resolveVoice(text);
    assert.equal(result.occurredAt, expected, text);
    assert.equal(result.issue, null, text);
  }
});

test('colon clocks honor English and Ukrainian day-period suffixes', () => {
  for (const [text, expected] of [
    ['today at 3:30 in the afternoon coffee', '2026-10-11T06:30:00.000Z'],
    ['today at 8:30 in the evening dinner', '2026-10-11T11:30:00.000Z'],
    ['Сьогодні о 3:30 дня кава 500 єн', '2026-10-11T06:30:00.000Z'],
    ['Сьогодні о 8:30 вечора вечеря', '2026-10-11T11:30:00.000Z'],
  ]) {
    const result = resolveVoice(text);
    assert.equal(result.occurredAt, expected, text);
    assert.equal(result.issue, null, text);
  }
});

test('Ukrainian ordinal hours and noon retain the spoken clock', () => {
  for (const [text, expected] of [
    ['Сьогодні о дванадцятій дня рамен 1723 єни', '2026-10-11T03:00:00.000Z'],
    ['Сьогодні опівдні рамен 1723 єни', '2026-10-11T03:00:00.000Z'],
    ['Сьогодні о третій дня кава 500 єн', '2026-10-11T06:00:00.000Z'],
    ['Сьогодні о восьмій ранку сніданок', '2026-10-10T23:00:00.000Z'],
    ['Сьогодні о дванадцятій ночі вода', '2026-10-10T15:00:00.000Z'],
  ]) {
    const result = resolveVoice(text);
    assert.equal(result.occurredAt, expected, text);
    assert.equal(result.issue, null, text);
  }
});

test('relative date anchors use the sender local day, including UTC date differences', () => {
  const anchor = Date.parse('2026-10-10T16:00:00.000Z'); // Tokyo Oct 11 01:00.
  for (const [text, expected, dayKey] of [
    ['今天中午十二点拉面', '2026-10-11T03:00:00.000Z', '2026-10-11'],
    ['昨天中午十二点拉面', '2026-10-10T03:00:00.000Z', '2026-10-10'],
    ['前天中午十二点拉面', '2026-10-09T03:00:00.000Z', '2026-10-09'],
    ['tomorrow at noon ramen', '2026-10-12T03:00:00.000Z', '2026-10-12'],
    ['Вчора опівдні рамен', '2026-10-10T03:00:00.000Z', '2026-10-10'],
  ]) {
    const result = resolveVoice(text, {}, { now: anchor });
    assert.equal(result.occurredAt, expected, text);
    assert.equal(result.dayKey, dayKey, text);
  }
});

test('relative date arithmetic crosses month and year boundaries correctly', () => {
  for (const [anchor, text, expected] of [
    ['2026-02-28T16:00:00.000Z', '昨天中午十二点吃饭', '2026-02-28T03:00:00.000Z'],
    ['2026-12-31T16:00:00.000Z', '昨天中午十二点吃饭', '2026-12-31T03:00:00.000Z'],
    ['2026-12-31T05:00:00.000Z', '明天中午十二点吃饭', '2027-01-01T03:00:00.000Z'],
  ]) assert.equal(resolveVoice(text, {}, { now: Date.parse(anchor) }).occurredAt, expected, text);
});

test('a voice expense with no spoken time uses its sending instant', () => {
  const result = resolveVoice('新宿拉面1723日元', { occurredAt: '2026-10-11T12:30:00.000Z' });
  assert.equal(result.occurredAt, '2026-10-11T05:46:00.000Z');
  assert.equal(result.issue, null);
});

test('dedicated spoken time evidence survives a shortened summary excerpt', () => {
  const result = resolveVoice('新宿拉面1723日元', { timeSource:'explicit', timeText:'今天中午十二点', localTime:'12:00', occurredAt:'2026-10-11T12:30:00.000Z' });
  assert.equal(result.occurredAt, '2026-10-11T03:00:00.000Z');
});

test('an explicit date with no clock uses local noon, not the sending hour', () => {
  for (const [text, expected] of [
    ['2026年10月8日买拉面1723日元', '2026-10-08T03:00:00.000Z'],
    ['10月8号买拉面1723日元', '2026-10-08T03:00:00.000Z'],
    ['昨天吃拉面1723日元', '2026-10-10T03:00:00.000Z'],
  ]) assert.equal(resolveVoice(text).occurredAt, expected, text);
});

test('a receipt with clock but no visible date must not invent today', () => {
  const result = resolveExpenseTime({ occurredAt: '2026-10-11T03:30:00.000Z' }, { now, recordText: '12:30 拉面1723', image: { mimeType: 'image/png' } }, timezone);
  assert.equal(result.occurredAt, null);
  assert.equal(result.issue, 'missingTime');
});

test('a receipt with no visible date or clock must not accept a hallucinated timestamp', () => {
  for (const attachment of [{ image: { mimeType: 'image/png' } }, { file: { mimeType: 'application/pdf' } }]) {
    const result = resolveExpenseTime({ occurredAt: '2026-10-11T03:30:00.000Z' }, { now, recordText: '拉面1723', ...attachment }, timezone);
    assert.equal(result.occurredAt, null);
    assert.equal(result.issue, 'missingTime');
  }
});

test('a document date is converted with the same local clock exactly once', () => {
  const result = resolveExpenseTime({ localDate: '2026-10-09', occurredAt: '2026-10-09T12:30:00.000Z' }, { now, recordText: 'October 9, 12:30 ramen 1723', image: { mimeType: 'image/png' } }, timezone);
  assert.equal(result.occurredAt, '2026-10-09T03:30:00.000Z');
  assert.equal(result.dayKey, '2026-10-09');
  assert.equal(result.issue, null);
});

test('a structured model date without visible date evidence is insufficient for a receipt', () => {
  const result = resolveExpenseTime({ localDate: '2026-10-11', occurredAt: '2026-10-11T03:30:00.000Z' }, { now, recordText: '12:30 拉面1723', image: { mimeType: 'image/png' } }, timezone);
  assert.equal(result.occurredAt, null);
  assert.equal(result.issue, 'missingTime');
});

test('May is valid visible date evidence and must not be replaced with today', () => {
  const result = resolveExpenseTime({ localDate: '2026-05-09', localTime: '12:00', occurredAt: '2026-05-09T03:00:00.000Z' }, { now, recordText: 'May 9 at noon, ramen 1723 yen' }, timezone);
  assert.equal(result.occurredAt, '2026-05-09T03:00:00.000Z');
  assert.equal(result.dayKey, '2026-05-09');
  assert.equal(result.issue, null);
});

test('a sending-day phrase and an explicit month-name date cannot silently replace one another', () => {
  const result = resolveExpenseTime({ localDate: '2026-10-09', localTime: '12:00', occurredAt: '2026-10-09T03:00:00.000Z' }, { now, recordText: 'Today I am recording October 9 at noon, ramen 1723 yen' }, timezone);
  assert.equal(result.occurredAt, null);
  assert.equal(result.issue, 'ambiguousTime');
});

test('two different calendar dates in a single record require review', () => {
  const result = resolveExpenseTime({ localDate: '2026-10-10', localTime: '12:00', occurredAt: '2026-10-10T03:00:00.000Z' }, { now, recordText: '2026-10-09 forgot to record; actually 2026-10-10 at noon ramen 1723' }, timezone);
  assert.equal(result.occurredAt, null);
  assert.equal(result.issue, 'ambiguousTime');
});

test('an explicitly stated UTC clock keeps its instant while retaining the user display timezone', () => {
  const result = resolveExpenseTime({ localDate: '2026-10-11', localTime: '21:00', occurredAt: '2026-10-11T12:00:00.000Z' }, { now, recordText: '2026-10-11 12:00 UTC ramen 1723' }, timezone);
  assert.equal(result.occurredAt, '2026-10-11T12:00:00.000Z');
  assert.equal(result.timezone, timezone);
  assert.equal(result.dayKey, '2026-10-11');
  assert.equal(result.issue, null);
});

test('explicit ISO timestamps validate their original calendar date and clock', () => {
  for (const timestamp of ['2026-02-30T12:00Z', '2026-10-11T24:00Z', '2026-10-11T12:00+09:99', '2026-10-11T12:00+14:01']) {
    const result = resolveVoice(`${timestamp} ramen 1723 yen`);
    assert.equal(result.occurredAt, null, timestamp);
    assert.equal(result.issue, 'invalidLocalTime', timestamp);
  }
  assert.equal(resolveVoice('2028-02-29T12:00+09:00 ramen 1723 yen').occurredAt, '2028-02-29T03:00:00.000Z');
});

test('UTC offsets validate hours and minutes instead of normalizing them', () => {
  for (const offset of ['UTC+09:99', 'UTC+14:01', 'UTC-15:00']) {
    const result = resolveVoice(`2026-10-11 12:00 ${offset} ramen 1723 yen`);
    assert.equal(result.occurredAt, null, offset);
    assert.equal(result.issue, 'invalidLocalTime', offset);
  }
  assert.equal(resolveVoice('2026-10-11 12:00 UTC+09:00 ramen 1723 yen').occurredAt, '2026-10-11T03:00:00.000Z');
});

test('relative dates alongside ISO instants are checked in the user display timezone', () => {
  const result = resolveVoice('今天 2026-10-10T15:00Z 拉面1723日元');
  assert.equal(result.occurredAt, '2026-10-10T15:00:00.000Z');
  assert.equal(result.dayKey, '2026-10-11');
  assert.equal(result.issue, null);
  const conflict = resolveVoice('昨天 2026-10-10T15:00Z 拉面1723日元');
  assert.equal(conflict.occurredAt, null);
  assert.equal(conflict.issue, 'ambiguousTime');
});

test('supplementary spoken time evidence cannot silently override a conflicting transcription date', () => {
  const result = resolveExpenseTime({
    rawText: '今天中午十二点拉面1723',
    timeText: '昨天中午十二点',
    timeSource: 'explicit',
    localDate: '2026-10-11',
    localTime: '12:00',
    occurredAt: '2026-10-11T03:00:00.000Z',
  }, { now, file: { mimeType: 'audio/ogg' } }, timezone);
  assert.equal(result.occurredAt, null);
  assert.equal(result.issue, 'ambiguousTime');
});

test('a bare 12-hour time requires review rather than assuming AM or PM', () => {
  const result = resolveVoice('三点半买咖啡', { occurredAt: '2026-10-11T06:30:00.000Z' });
  assert.equal(result.occurredAt, '2026-10-11T06:30:00.000Z');
  assert.equal(result.issue, 'ambiguousTime');
  const inconsistent = resolveVoice('三点半买咖啡', { occurredAt: '2026-10-11T05:46:00.000Z' });
  assert.equal(inconsistent.occurredAt, null);
  assert.equal(inconsistent.issue, 'ambiguousTime');
});

test('a vague part of the day requires review without fabricating a clock', () => {
  for (const text of ['今天上午买水100日元', '今天下午吃拉面1723日元', 'this afternoon coffee 500 yen', 'This Afternoon coffee 500 yen', 'сьогодні вранці кава 500 єн', 'Вранці кава 500 єн']) {
    const result = resolveVoice(text, { occurredAt: '2026-10-11T05:46:00.000Z' });
    assert.equal(result.occurredAt, null, text);
    assert.equal(result.issue, 'ambiguousTime', text);
  }
});

test('two explicit clocks in one unsplit record require review', () => {
  const result = resolveVoice('中午十二点拉面1723，下午三点半咖啡500');
  assert.equal(result.occurredAt, null);
  assert.equal(result.issue, 'ambiguousTime');
});

test('individual record excerpts prevent clocks from leaking across a multi-expense message', () => {
  const text = '中午十二点新宿拉面1723日元，下午三点半咖啡500日元';
  const lunch = resolveExpenseTime({ rawText: '中午十二点新宿拉面1723日元' }, { now, text, file: { mimeType: 'audio/ogg' } }, timezone);
  const coffee = resolveExpenseTime({ rawText: '下午三点半咖啡500日元' }, { now, text, file: { mimeType: 'audio/ogg' } }, timezone);
  assert.equal(lunch.occurredAt, '2026-10-11T03:00:00.000Z');
  assert.equal(coffee.occurredAt, '2026-10-11T06:30:00.000Z');
  assert.equal(lunch.issue, null);
  assert.equal(coffee.issue, null);
});

test('a modification with no new time preserves the previous confirmed time', () => {
  const result = resolveVoice('改成现金付款', { occurredAt: '2026-10-11T12:30:00.000Z' }, { previousRecord: { occurredAt: '2026-10-09T03:00:00.000Z', timezone } });
  assert.equal(result.occurredAt, '2026-10-09T03:00:00.000Z');
  assert.equal(result.issue, null);
});

test('local wall-clock conversion supports leap days and never normalizes invalid dates', () => {
  assert.equal(localDateTimeToUtc('2028-02-29', 12, 0, timezone), '2028-02-29T03:00:00.000Z');
  for (const [day, hour, minute] of [
    ['2026-02-29', 12, 0], ['2026-04-31', 12, 0], ['2026-00-10', 12, 0],
    ['2026-13-10', 12, 0], ['2026-10-00', 12, 0], ['2026-10-32', 12, 0],
    ['2026-10-11', -1, 0], ['2026-10-11', 24, 0], ['2026-10-11', 12, -1],
    ['2026-10-11', 12, 60], ['2026-10-11', 12.5, 0], ['2026-10-11', 12, 0.5],
    ['2026-10-11', NaN, 0], ['2026-10-11', 12, NaN], ['2026-10-11', Infinity, 0],
  ]) assert.equal(localDateTimeToUtc(day, hour, minute, timezone), null, `${day} ${hour}:${minute}`);
  assert.equal(localDateTimeToUtc('2026-10-11', 12, 0, 'not/a-zone'), null);
});

test('Europe/Kyiv DST gaps and repeated clocks require review', () => {
  assert.equal(localDateTimeToUtc('2026-03-29', 3, 30, 'Europe/Kyiv'), null, 'spring-forward 03:30 does not exist');
  assert.equal(localDateTimeToUtc('2026-10-25', 3, 30, 'Europe/Kyiv'), null, 'fall-back 03:30 has two offsets');
  assert.equal(localDateTimeToUtc('2026-03-29', 4, 30, 'Europe/Kyiv'), '2026-03-29T01:30:00.000Z');
  assert.equal(localDateTimeToUtc('2026-10-25', 4, 30, 'Europe/Kyiv'), '2026-10-25T02:30:00.000Z');
  for (const recordText of ['2026-03-29 03:30 coffee', '2026-10-25 03:30 coffee']) {
    const result = resolveExpenseTime({}, { now, recordText }, 'Europe/Kyiv');
    assert.equal(result.occurredAt, null);
    assert.equal(result.issue, 'invalidLocalTime');
  }
});
