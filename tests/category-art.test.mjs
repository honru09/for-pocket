import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES, LEGACY_DEFAULT_CATEGORIES } from '../public/shared.mjs';
import { categoryArtworkKey } from '../src/category-art.mjs';

test('category artwork covers the 30 expense and 6 income presets without changing stored data', () => {
  const presets = [...DEFAULT_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES];
  assert.equal(new Set(presets.map(categoryArtworkKey)).size, 36);
  for (const category of presets) assert.equal(categoryArtworkKey(category), category.id);
  for (const category of LEGACY_DEFAULT_CATEGORIES) assert.equal(categoryArtworkKey(category), category.id);
});

test('custom, changed and historical category icons keep the users choice', () => {
  assert.equal(categoryArtworkKey({id:'my-cafe', icon:'coffee'}), null);
  assert.equal(categoryArtworkKey({...DEFAULT_CATEGORIES[0], icon:'book'}), null);
  assert.equal(categoryArtworkKey({...DEFAULT_CATEGORIES[0], color:'blue'}), null);
  assert.equal(categoryArtworkKey({...DEFAULT_CATEGORIES[0], label:'午餐'}), 'stomach');
  assert.equal(categoryArtworkKey(null), null);
  assert.equal(categoryArtworkKey({}), null);
});
