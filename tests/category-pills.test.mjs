import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATEGORIES, DEFAULT_INCOME_CATEGORIES, initialSettings, validateExpense, validateSettings } from '../public/shared.mjs';
import { sortCategoriesByUsage, upgradeCategoryPresets } from '../public/category-presets.mjs';

const legacyCategories = [
  { id: 'stomach', label: '胃', icon: 'bowl', color: 'peach' },
  { id: 'learning', label: '学习', icon: 'book', color: 'blue' },
  { id: 'daily', label: '日常用品', icon: 'bag', color: 'mint' },
  { id: 'hobby', label: '兴趣', icon: 'game', color: 'pink' },
  { id: 'travel', label: '旅游', icon: 'plane', color: 'yellow' },
  { id: 'other', label: '其他', icon: 'spark', color: 'lavender' },
];
const expense = categoryId => ({ id: `legacy_${categoryId}`, type:'expense', amountMinor:850, currency:'JPY',
  categoryId, consumer:'u_local', note:'', timezone:'Asia/Tokyo' });
const withConsumer = settings => ({ ...settings, consumers:[{ id:'u_local', name:'Me', color:'yellow', avatar:'cloud' }] });

test('new ledgers have thirty distinct editable expense presets without changing income categories', () => {
  const settings = initialSettings();
  assert.equal(settings.categories.length, 30);
  assert.equal(new Set(settings.categories.map(category => category.id)).size, 30);
  assert.equal(new Set(settings.categories.map(category => category.label)).size, 30);
  assert.deepEqual(validateSettings(settings).categories, settings.categories);
  assert.deepEqual(settings.incomeCategories, DEFAULT_INCOME_CATEGORIES);
  // A user edit must not change the default of another new ledger.
  settings.categories[0].label = 'Only this ledger';
  assert.notEqual(initialSettings().categories[0].label, settings.categories[0].label);
});

test('all original category IDs remain usable for entry creation after the preset expansion', () => {
  const settings = withConsumer(initialSettings());
  for (const original of legacyCategories) {
    const active = DEFAULT_CATEGORIES.find(category => category.id === original.id);
    assert.ok(active, `Missing legacy category ${original.id}`);
    const entry = validateExpense(expense(original.id), settings);
    assert.equal(entry.categoryId, original.id);
    assert.deepEqual(entry.category, active);
  }
});

test('existing six-category ledgers and renamed categories remain valid and keep their own labels', () => {
  const oldSettings = withConsumer({ ...initialSettings(), categories:structuredClone(legacyCategories) });
  oldSettings.categories[0].label = 'Our little kitchen';
  const validated = validateSettings(oldSettings);
  assert.deepEqual(validated.categories, oldSettings.categories);
  const entry = validateExpense(expense('stomach'), validated);
  assert.equal(entry.category.label, 'Our little kitchen');
  // Recorded snapshots must be independent of later category edits.
  validated.categories[0].label = 'New name';
  assert.equal(entry.category.label, 'Our little kitchen');
  assert.equal(entry.categoryId, 'stomach');
});

test('expanded presets still reject duplicate categories and ambiguous names', () => {
  const duplicateId = initialSettings();
  duplicateId.categories[1].id = duplicateId.categories[0].id;
  assert.throws(() => validateSettings(duplicateId), /分类格式/);
  const duplicateLabel = initialSettings();
  duplicateLabel.categories[1].label = duplicateLabel.categories[0].label;
  assert.throws(() => validateSettings(duplicateLabel), /不能重复/);
});

test('frequent categories are ordered first without changing the saved category pool', () => {
  const settings = initialSettings();
  const expenses = [
    { type:'expense', categoryId:'travel' },
    { type:'expense', categoryId:'travel' },
    { type:'expense', categoryId:'travel' },
    { type:'expense', categoryId:'daily' },
    { type:'income', categoryId:'wage' },
    // An old/deleted ID and malformed record must not create a phantom pill.
    { type:'expense', categoryId:'removed-category' },
    null,
  ];
  const ordered = sortCategoriesByUsage(settings.categories, expenses, { type:'expense', limit:6 });
  assert.equal(ordered.length, settings.categories.length);
  assert.deepEqual(ordered.slice(0, 2).map(category => category.id), ['travel', 'daily']);
  assert.deepEqual(new Set(ordered.map(category => category.id)), new Set(settings.categories.map(category => category.id)));
  assert.deepEqual(settings.categories.map(category => category.id).slice(0, 6), DEFAULT_CATEGORIES.map(category => category.id).slice(0, 6), 'Sorting returns a new order');
});

test('legacy untouched six-category settings can opt into the expanded presets while custom edits stay intact', () => {
  const legacy = withConsumer({ ...initialSettings(), categories:structuredClone(legacyCategories) });
  const upgraded = upgradeCategoryPresets(legacy);
  assert.equal(upgraded.categories.length, 30);
  for (const category of legacyCategories) assert.deepEqual(upgraded.categories.find(item => item.id===category.id), category);
  const custom = withConsumer({ ...initialSettings(), categories:[...structuredClone(legacyCategories.slice(0, 5)), { id:'my_food', label:'My food', icon:'bowl', color:'peach' }, legacyCategories[5]] });
  assert.strictEqual(upgradeCategoryPresets(custom), custom, 'Edited pools must not be silently replaced');
});
