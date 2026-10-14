import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDigestService } from '../digest.mjs';

// All data and Telegram deliveries are in-memory fixtures. No account, file,
// provider, scheduler or network state is used by these copy contract tests.
const NOON = Date.parse('2026-10-11T04:00:00.000Z');
const MORNING = Date.parse('2026-10-11T01:00:00.000Z');
const CATEGORY = { zh: '交通', en: 'Transport', uk: 'Транспорт' };
const COMMENT = { zh: '这回交通抢镜了。', en: 'Transport stole the spotlight.', uk: 'Проїзд сьогодні в центрі уваги.' };

function expense(language, overrides = {}) {
  return {
    id: 'transport-1000', type: 'expense', amountMinor: 1000, currency: 'JPY',
    categoryId: 'transport', category: { id: 'transport', label: CATEGORY[language] },
    consumer: 'u_101', member: { id: 'u_101', name: 'Jay' },
    occurredAt: '2026-10-11T03:50:00.000Z', note: '', ...overrides,
  };
}

async function deliver({ language = 'zh', entries = [expense(language)], reply = COMMENT[language], slot = 'noon', at = NOON, unavailable = false } = {}) {
  const settings = { language, timezone: 'Asia/Tokyo', currency: 'JPY', categories: [{ id: 'transport', label: CATEGORY[language] }] };
  const db = {
    users: { '101': { id: '101', name: 'Jay', settings, activeCircleId: null } },
    identities: { 'telegram:101': '101' }, circles: {},
    ledgers: { '101': { settings, expenses: entries } },
  };
  const calls = [], prompts = [];
  const service = createDigestService({
    store: { async run(fn) { return fn(db); } }, now: () => at,
    summarizer: { enabled: true, async summarize(input) {
      prompts.push(input);
      if (unavailable) throw new Error('fixture provider unavailable');
      return reply;
    } },
    callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 17 }; },
  });
  const result = await service.processSlot(slot, { at });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendMessage');
  assert.equal(calls[0].params.disable_notification, true, 'all digest deliveries remain silent');
  assert.equal(calls[0].params.text, result.results[0].text);
  return { text: calls[0].params.text, prompts, result };
}

function assertCompact(text, language) {
  assert.ok(text.trim(), 'a complete message is available');
  assert.doesNotMatch(text, /[\r\n]/u, 'one paragraph');
  const points = Array.from(text).length;
  assert.ok(points <= (language === 'zh' ? 70 : 240), `${language} message has ${points} Unicode code points: ${text}`);
  if (language !== 'zh') assert.ok(text.trim().split(/\s+/u).length <= 40, 'at most 40 words');
  const sentences = [...new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text)].filter(part => part.segment.trim());
  assert.ok(sentences.length <= 2, `at most two sentences, received ${sentences.length}: ${text}`);
  assert.doesNotMatch(text, /(?:…|\.{3})$/u, 'never chop a model reply into an unfinished fragment');
  assert.match(text, /[。.!！?？](?:\s*\p{Extended_Pictographic}\uFE0F?)*$/u, 'ends as a complete sentence');
}

for (const language of ['zh', 'en', 'uk']) {
  test(`digest ${language}: verified amount and purpose are present even when the model returns only a comment`, async () => {
    const { text, result } = await deliver({ language });
    assert.match(text.replace(/[,\s\u00a0\u202f]/gu, ''), /1000/u);
    assert.ok(text.toLocaleLowerCase().includes(CATEGORY[language].toLocaleLowerCase()), 'recorded purpose is visible');
    assert.ok(text.includes(COMMENT[language]), 'a concise, grounded model comment is retained');
    assert.equal(result.results[0].generated, true, 'accepted comments are distinguished from identical safe fallback wording');
    assertCompact(text, language);
  });

  test(`digest ${language}: no entries means no records, without a claim about meals or an untouched wallet`, async () => {
    const { text, prompts } = await deliver({ language, entries: [] });
    assert.equal(prompts.length, 0, 'empty records use a factual local fallback');
    const absence = {
      zh: /(?:没|未|无|没有|尚无).*(?:记录|记账|新账|账)|(?:账|记录).*(?:未记|没记)/u,
      en: /(?:no|nothing|not a single).*(?:record|log|entry|entries)/iu,
      uk: /(?:нема|немає|жодн).*(?:запис|витрат)|(?:запис|витрат).*(?:нема|немає)/iu,
    };
    assert.match(text, absence[language]);
    assert.doesNotMatch(text, /修仙|光合|没花|没有消费|毫发无损|饿|没吃|photosynth|untouched|spent nothing|didn.t spend|skipped lunch|фотосинтез|гаманець цілий|не витратили|не їли/iu);
    assertCompact(text, language);
  });

  test(`digest ${language}: an oversized model reply becomes a whole short message`, async () => {
    const phrases = { zh: '这一笔已经写进小账本里了。', en: 'That little entry is here on the page.', uk: 'Цей запис уже є у блокноті.' };
    const { text } = await deliver({ language, reply: `${phrases[language]} `.repeat(70) });
    assertCompact(text, language);
    assert.match(text.replace(/[,\s\u00a0\u202f]/gu, ''), /1000/u, 'length limiting keeps the actual amount');
  });

  test(`digest ${language}: the fallback keeps mixed currencies explicit without inventing one combined total`, async () => {
    const entries = [
      expense(language, { id: 'yen', amountMinor: 850 }),
      expense(language, { id: 'dollar', amountMinor: 1250, currency: 'USD' }),
    ];
    const { text } = await deliver({ language, entries, unavailable: true });
    const identifiesBoth = /JPY|日元|円|єн|yen|¥/iu.test(text) && /USD|美元|долар|\$/iu.test(text);
    const describesMultiple = /多币种|多种货币|mixed currenc|multiple currenc|різн\S* валют|кільк\S* валют/iu.test(text);
    assert.ok(identifiesBoth || describesMultiple, `currencies are separately identified or explicitly described as multiple: ${text}`);
    assert.doesNotMatch(text, /862[.,]5|2[,.\s]?100/u, 'minor units or foreign amounts are not added together');
    assertCompact(text, language);
  });
}

for (const lie of ['交通花了1000，没吃午饭吧。', '午餐都没记录，饿肚子了吧。', '今天又偷偷聚餐啦。']) {
  test(`digest discards an invented meal story: ${lie}`, async () => {
    const { text } = await deliver({ reply: lie });
    assert.doesNotMatch(text, /没吃|午饭|午餐|饿肚子|偷偷|聚餐/u);
    assert.match(text, /交通/u);
    assert.match(text.replace(/[,\s]/gu, ''), /1000/u);
    assertCompact(text, 'zh');
  });
}

test('digest rejects English and Ukrainian invented meals too', async () => {
  for (const [language, reply, forbidden] of [
    ['en', 'You skipped lunch and secretly went out for dinner.', /skipped lunch|went out for dinner|secretly|went hungry/iu],
    ['uk', 'Ви не обідали й потай пішли на вечерю.', /не обідали|потай|пішли на вечерю/iu],
  ]) {
    const { text } = await deliver({ language, reply });
    assert.doesNotMatch(text, forbidden);
    assertCompact(text, language);
  }
});

test('morning copy treats yesterday daytime and this morning as separate parts of the recorded window', async () => {
  const entries = [
    expense('zh', { id: 'yesterday-afternoon', amountMinor: 850, occurredAt: '2026-10-10T05:00:00.000Z' }),
    expense('zh', { id: 'today-morning', amountMinor: 500, occurredAt: '2026-10-10T23:00:00.000Z' }),
  ];
  const { text } = await deliver({ entries, at: MORNING, slot: 'morning', reply: '昨晚又偷偷吃夜宵啦。' });
  assert.match(text, /昨[日天]/u);
  assert.match(text, /今[早天]/u);
  assert.doesNotMatch(text, /昨晚|夜宵|偷偷/u);
  assertCompact(text, 'zh');
});

test('two category records are not reported as two visits or two journeys', async () => {
  const entries = [expense('en'), expense('en', { id: 'second', amountMinor: 850 })];
  const { text } = await deliver({ language: 'en', entries, unavailable: true });
  assert.doesNotMatch(text, /\bvisits?\b|\bjourneys?\b|\btrips?\b|got caught first/iu);
  assertCompact(text, 'en');
});

test('custom category punctuation cannot turn a concise digest into extra sentences', async () => {
  const entries = [expense('zh', { categoryId: 'custom-supplies', category: { id: 'custom-supplies', label: '生活。超市。' } })];
  const { text } = await deliver({ entries, reply: '这回小账本挺热闹。' });
  assert.doesNotMatch(text, /生活。超市|。。/u);
  assertCompact(text, 'zh');
});

test('short invented people and transport events are rejected just like longer meal stories', async () => {
  for (const reply of ['Jay这回坐飞机去东京了。', '今天公交又迟到了。']) {
    const { text, result } = await deliver({ reply });
    assert.doesNotMatch(text, /飞机|东京|迟到/u);
    assert.equal(result.results[0].generated, false, 'a short unsupported event must use a factual-safe aside');
    assertCompact(text, 'zh');
  }
});

test('Ukrainian three-currency fallback uses the natural count form and identifies multiple currencies', async () => {
  const entries = [
    expense('uk', { id: 'yen' }),
    expense('uk', { id: 'dollar', currency: 'USD', amountMinor: 1250 }),
    expense('uk', { id: 'yuan', currency: 'CNY', amountMinor: 500 }),
  ];
  const { text } = await deliver({ language: 'uk', entries, unavailable: true });
  assert.match(text, /3 записи/iu);
  assert.doesNotMatch(text, /3 записів/iu);
  assert.match(text, /різн\S* валют|кільк\S* валют/iu);
  assertCompact(text, 'uk');
});
