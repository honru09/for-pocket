import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiUiEnabled, aiSummaryUiEnabled } from '../src/ai-availability.mjs';

test('a remote AI service remains usable when a stale config says AI is disabled', () => {
  const service = { aiParseExpense() {}, aiSummary() {} };
  assert.equal(aiUiEnabled({ isRemote: true, config: { aiEnabled: false }, service }), true);
  assert.equal(aiSummaryUiEnabled({ isRemote: true, config: { aiEnabled: false }, service }), true);
});

test('local mode still keeps AI controls behind the account gate', () => {
  const service = { aiParseExpense() {}, aiSummary() {} };
  assert.equal(aiUiEnabled({ isRemote: false, config: { aiEnabled: true }, service }), false);
  assert.equal(aiSummaryUiEnabled({ isRemote: false, config: { aiEnabled: true }, service }), false);
});
