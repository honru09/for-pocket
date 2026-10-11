import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExpenseParser } from '../ai.mjs';
import { initialSettings } from '../public/shared.mjs';

const raw = (patch = {}) => ({ amount: 1200, currency: 'JPY', type: 'expense', categoryId: 'stomach', categoryLabel: 'Food',
  merchant: 'Lunch', note: 'Lunch', rawText: 'lunch 1200', occurredAt: '2026-10-11T01:00:00.000Z', timezone: 'Asia/Tokyo', confidence: 0.95,
  consumer: '', splitMode: 'none', splitParticipants: [], recordKind: 'purchase', needsReview: false, reviewReason: '', detectedLanguage: 'en', currencyExplicit: false, ...patch });

function parserReturning(value, calls = []) {
  return createExpenseParser({ modelClient: { async generateContent(request) {
    calls.push(request);
    return { response: { candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] } };
  } } });
}

test('a PDF attachment with no accompanying text is sent as native inlineData and normalized as a file', async () => {
  const calls = [];
  const file = { mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4 receipt bytes').toString('base64'), name: 'receipt.pdf' };
  const items = await parserReturning([raw()], calls).parse({ file, timezone: 'Asia/Tokyo' }, initialSettings());
  assert.deepEqual(calls[0].contents[0].parts.find(part => part.inlineData).inlineData, { mimeType: 'application/pdf', data: file.data });
  assert.equal(items[0].source, 'file');
  assert.equal(items[0].amountMinor, 1200);
});

test('spoken currency defaults to JPY without inferring from account currency or spoken language', async () => {
  const settings = { ...initialSettings('uk'), currency: 'USD' };
  const file = { mimeType: 'audio/ogg', data: Buffer.from('voice bytes').toString('base64') };
  const result = await parserReturning([raw({ currency: 'USD', detectedLanguage: 'uk', note: 'Обід', currencyExplicit: false })]).parse({ file }, settings);
  assert.equal(result[0].currency, 'JPY');
  assert.equal(result[0].amountMinor, 1200);
  assert.equal(result[0].detectedLanguage, 'uk');
  assert.equal(result[0].note, 'Обід');
});

test('an explicitly spoken supported currency retains its minor-unit precision', async () => {
  const result = await parserReturning([raw({ amount: 12.34, currency: 'USD', currencyExplicit: true, detectedLanguage: 'en' })]).parse({ file: { mimeType: 'audio/ogg', data: Buffer.from('twelve dollars').toString('base64') } }, initialSettings());
  assert.equal(result[0].currency, 'USD');
  assert.equal(result[0].amountMinor, 1234);
  assert.equal(result[0].detectedLanguage, 'en');
});

test('empty extraction results are valid for unclear speech and documents without transactions', async () => {
  const parser = parserReturning([]);
  for (const input of [{ file: { mimeType: 'audio/ogg', data: 'AA==' } }, { file: { mimeType: 'application/pdf', data: 'AA==' } }, { text: 'no expenses listed' }]) {
    assert.deepEqual(await parser.parse(input, initialSettings()), []);
  }
});
