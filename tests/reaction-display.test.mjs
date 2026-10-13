import test from 'node:test';
import assert from 'node:assert/strict';
import { REACTION_EMOJIS, normalizeReactionEmoji, formatReactionCount } from '../public/reactions.mjs';

test('the horizontal drawer contains valid, distinct single emoji', () => {
  assert.ok(REACTION_EMOJIS.length >= 80);
  assert.equal(new Set(REACTION_EMOJIS).size, REACTION_EMOJIS.length);
  for (const emoji of REACTION_EMOJIS) assert.equal(normalizeReactionEmoji(emoji),emoji);
});

test('burst counters hide single sends and use emoji digits', () => {
  for (const count of [undefined,null,0,1,NaN,Infinity,-1]) assert.equal(formatReactionCount(count),'');
  assert.equal(formatReactionCount(2),'✖️2️⃣');
  assert.equal(formatReactionCount(9),'✖️9️⃣');
  assert.equal(formatReactionCount(10),'✖️🔟');
  assert.equal(formatReactionCount(11),'✖️1️⃣1️⃣');
  assert.equal(formatReactionCount(100),'✖️1️⃣0️⃣0️⃣');
});
