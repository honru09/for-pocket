import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapExpenseCategory } from '../expense-category.mjs';
import { initialSettings } from '../public/shared.mjs';

const settings = initialSettings();
const candidate = patch => ({ categoryId: 'other', categoryLabel: '其他', merchant: '', note: '', rawText: '', type: 'expense', ...patch });
const classify = (patch, active = settings, type = 'expense') => mapExpenseCategory(candidate(patch), type, active).id;

test('the noon Shinjuku ramen voice transcription is food even when the model chose other', () => {
  assert.equal(classify({ merchant: '新宿拉面', note: '午餐', rawText: '今天中午十二点新宿拉面花了1723日元' }), 'stomach');
});

test('complete purpose words recover food, education, household, hobbies and transport in three languages', () => {
  for (const [rawText, expected] of [
    ['新宿拉面1200日元', 'stomach'], ['买了咖啡500日元', 'stomach'], ['地铁车费230日元', 'travel'],
    ['买教材800日元', 'learning'], ['牙膏450日元', 'daily'], ['电影票1800日元', 'hobby'],
    ['Coffee for 500 yen', 'stomach'], ['Paid 230 yen for the subway', 'travel'], ['Bought a textbook for 800 yen', 'learning'],
    ['Toilet paper 450 yen', 'daily'], ['Movie ticket 1800 yen', 'hobby'],
    ['Обід у ресторані 1200 єн', 'stomach'], ['Кава 500 єн', 'stomach'], ['Метро 230 єн', 'travel'],
    ['Книги 800 єн', 'learning'], ['Зубна паста 450 єн', 'daily'], ['Кіно 1800 єн', 'hobby'],
  ]) assert.equal(classify({ rawText }), expected, rawText);
});

test('valid non-other model IDs, exact custom labels and explicit user categories retain priority', () => {
  assert.equal(classify({ categoryId: 'hobby', categoryLabel: '其他', note: '午餐' }), 'hobby');
  assert.equal(classify({ rawText: '拉面1200日元，分类：兴趣' }), 'hobby');
  assert.equal(classify({ rawText: '拉面1200日元，分类：其他' }), 'other');
  const active = { ...settings, categories: [{ id: 'personal', label: 'My lunch', icon: 'bowl' }, settings.categories.at(-1)] };
  assert.equal(classify({ categoryId: 'unknown', categoryLabel: 'My lunch', note: '午餐' }, active), 'personal');
  assert.equal(classify({ categoryId: 'unknown', categoryLabel: 'Food' }, active), 'personal');
});

test('inference selects only an available unique semantic category, including renamed categories', () => {
  const other = settings.categories.at(-1);
  const custom = { ...settings, categories: [{ id: 'meals', label: '餐饮', icon: 'spark' }, other] };
  assert.equal(classify({ note: '午餐' }, custom), 'meals');
  const renamed = { ...settings, categories: [{ id: 'favorite', label: '我的小肚子', icon: 'bowl' }, other] };
  assert.equal(classify({ note: '午餐' }, renamed), 'favorite');
  const absent = { ...settings, categories: [{ id: 'supplies', label: '用品', icon: 'bag' }, other] };
  assert.equal(classify({ note: '午餐' }, absent), 'other');
  const duplicate = { ...settings, categories: [{ id: 'food_a', label: '餐饮 A', icon: 'bowl' }, { id: 'food_b', label: '餐饮 B', icon: 'bowl' }, other] };
  assert.equal(classify({ note: '午餐' }, duplicate), 'other');
  const dedicated = { ...settings, categories: [...settings.categories, { id: 'coffee', label: '咖啡', icon: 'coffee' }, { id: 'transport', label: '交通', icon: 'card' }] };
  assert.equal(classify({ note: '咖啡' }, dedicated), 'coffee');
  assert.equal(classify({ rawText: '地铁230日元' }, dedicated), 'transport');
});

test('food words cannot override course/book purposes or ambiguous branded merchants', () => {
  for (const rawText of ['拉面食谱学习1200日元', '拉面课程1200日元', 'Bought a ramen cookbook for 1200 yen']) {
    assert.equal(classify({ rawText }), 'learning');
  }
  assert.equal(classify({ merchant: '小拉面', note: '软件订阅', rawText: '花了1200日元订阅软件' }), 'other');
  assert.equal(classify({ merchant: '新宿拉面', rawText: '1200日元' }), 'other', 'a merchant name alone is not an explicit spending purpose');
  assert.equal(classify({ rawText: 'Book a taxi for 1200 yen' }), 'travel', 'book used as a reservation verb is not education');
  assert.equal(classify({ rawText: 'Three course dinner for 1200 yen' }), 'stomach', 'a meal course is not education');
  for (const rawText of ['饭岛商店1200日元', '食品科学研究资料', '课堂窗帘1200日元', 'Booked an appointment for 1200 yen']) {
    assert.equal(classify({ rawText }), 'other', rawText);
  }
});

test('transfers, repayments and reimbursements are not inferred as restaurant purchases', () => {
  for (const patch of [
    { recordKind: 'transfer', note: '午餐', rawText: '拉面1200日元' },
    { recordKind: 'reimbursement', note: '午餐', rawText: '拉面1200日元' },
    { rawText: '帮朋友代付新宿拉面1723日元' },
    { rawText: '帮朋友付新宿拉面1723日元' },
    { rawText: '朋友转给我昨天拉面的1200日元' },
    { rawText: 'Reimbursement for ramen 1200 yen' },
    { rawText: 'Переказ за обід 1200 єн' },
    { categoryId: 'unknown', categoryLabel: 'Food', recordKind: 'transfer', rawText: 'Transfer for ramen 1200 yen' },
  ]) assert.equal(classify(patch), 'other', JSON.stringify(patch));
});

test('income maps within income categories and never uses expense food semantics', () => {
  assert.equal(classify({ categoryId: 'salary', categoryLabel: 'Salary' }, settings, 'income'), 'wage');
  assert.equal(classify({ categoryId: 'other_in', categoryLabel: '其他入账', merchant: '新宿拉面', note: '午餐退款' }, settings, 'income'), 'other_in');
  const active = { ...settings, incomeCategories: [{ id: 'custom_salary', label: 'Зарплата', icon: 'wallet' }, settings.incomeCategories.at(-1)] };
  assert.equal(classify({ categoryId: 'salary' }, active, 'income'), 'custom_salary');
  assert.throws(() => mapExpenseCategory({}, 'expense', { categories: [] }), /errorAiCategory/);
});
