import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getCategorySuggestions, isExistingCategorySuggestion, normalizeCategorySuggestion } from '../public/category-suggestions.mjs';
import { initialSettings } from '../public/shared.mjs';
import { createExpenseParser } from '../ai.mjs';
import { createStore } from '../store.mjs';
import { createTelegramHandler } from '../telegram-ai.mjs';

const entry = (patch = {}) => ({
  id: `e-${Math.random().toString(36).slice(2)}`,
  type: 'expense',
  recordKind: 'purchase',
  categorySuggestion: '夜市小吃',
  ledgerId: 'ledger-a',
  ...patch,
});

test('category aliases prevent suggestions that already exist in another locale or legacy label', () => {
  const settings = initialSettings();
  assert.equal(isExistingCategorySuggestion('Dining', settings.categories), true);
  assert.equal(isExistingCategorySuggestion('Харчування', settings.categories), true);
  assert.equal(isExistingCategorySuggestion('胃', settings.categories), true);
  assert.equal(isExistingCategorySuggestion('外食', [{ ...settings.categories[0], label: '胃' }]), true);
  assert.equal(isExistingCategorySuggestion('Unusual hobby', settings.categories), false);
});

test('suggestions require three distinct saved purchases in the same ledger', () => {
  const settings = initialSettings();
  const expenses = [
    entry({ id: 'a', categorySuggestion: '夜市小吃' }),
    entry({ id: 'b', categorySuggestion: '夜市小吃' }),
    entry({ id: 'c', categorySuggestion: '夜市小吃' }),
    entry({ id: 'duplicate', categorySuggestion: '露营', deletedAt: '2026-10-11T00:00:00.000Z' }),
    entry({ id: 'transfer', categorySuggestion: '露营', recordKind: 'transfer' }),
    entry({ id: 'income', categorySuggestion: '露营', type: 'income' }),
    entry({ id: 'other-ledger', categorySuggestion: '夜市小吃', ledgerId: 'ledger-b' }),
    entry({ id: 'missing-ledger', categorySuggestion: '夜市小吃', ledgerId: undefined }),
    entry({ id: 'needs-review', categorySuggestion: '夜市小吃', needsReview: true }),
  ];
  assert.deepEqual(getCategorySuggestions(settings.categories, expenses, { ledgerId: 'ledger-a' }).map(x => [x.label, x.count]), [['夜市小吃', 3]]);
  assert.deepEqual(getCategorySuggestions(settings.categories, expenses, { ledgerId: 'ledger-b' }), []);
});

test('suggestion normalization keeps the field bounded and rejects generic labels', () => {
  assert.equal(normalizeCategorySuggestion('  夜市　小吃  '), '夜市 小吃');
  assert.equal(normalizeCategorySuggestion('其他'), undefined);
  assert.equal(normalizeCategorySuggestion('x'), undefined);
  assert.equal(normalizeCategorySuggestion('x'.repeat(25)), undefined);
});

test('expense parser keeps a distinct high-confidence purpose suggestion', async () => {
  const parser = createExpenseParser({ modelClient: {
    async generateContent() {
      return { response: { candidates: [{ content: { parts: [{ text: JSON.stringify([{
        amount: 1200, currency: 'JPY', type: 'expense', categoryId: 'other', categoryLabel: '其他',
        categorySuggestion: '夜市小吃', merchant: 'Market', note: 'snack', rawText: 'night market 1200',
        occurredAt: '2026-10-11T03:00:00.000Z', timezone: 'Asia/Tokyo', confidence: 0.98,
      }]) }] } }] } };
    },
  } });
  const settings = initialSettings();
  settings.consumers = [{ id: 'u1', name: 'Me', color: 'blue' }];
  const [item] = await parser.parse({ text: 'night market 1200', timezone: 'Asia/Tokyo', defaultConsumer: settings.consumers[0].id }, settings);
  assert.equal(item.categorySuggestion, '夜市小吃');
});

test('Telegram preview confirmation carries the suggestion into the saved expense', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'for-category-suggestion-'));
  const store = createStore(dataDir);
  const calls = [];
  const handler = createTelegramHandler({
    store,
    token: 'fixture-token',
    now: () => Date.parse('2026-10-11T03:00:00.000Z'),
    aiParser: { enabled: true, async parse() {
      return [{ amountMinor: 1200, amount: 1200, currency: 'JPY', type: 'expense', categoryId: 'other',
        categoryLabel: '其他', categorySuggestion: '夜市小吃', merchant: 'Market', note: 'snack',
        occurredAt: '2026-10-11T03:00:00.000Z', timezone: 'Asia/Tokyo', confidence: 0.98 }];
    } },
    callTelegram: async (method, params) => { calls.push({ method, params }); return { message_id: 7 }; },
  });
  const update = id => ({ update_id: id, message: { message_id: id, date: 1791687600,
    chat: { id: 101, type: 'private' }, from: { id: 101, first_name: 'Me', language_code: 'zh' }, text: '夜市 1200' } });
  try {
    const preview = await handler.handle(update(1));
    assert.equal(preview.kind, 'draft');
    const draftId = preview.draftId;
    const confirmed = await handler.handle({ update_id: 2, callback_query: { id: 'q2', from: { id: 101 },
      message: { message_id: 7, chat: { id: 101, type: 'private' } }, data: `fp:confirm:${draftId}` } });
    assert.equal(confirmed.kind, 'confirmed');
    await store.flush();
    const db = JSON.parse(await readFile(path.join(dataDir, '_pocket-v2.json'), 'utf8'));
    const expense = db.ledgers['101'].expenses[0];
    assert.equal(expense.categorySuggestion, '夜市小吃');
    assert.equal(calls.some(call => call.method === 'sendMessage'), true);
  } finally {
    handler.close();
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
