import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ListingInput } from '../../src/listings/listings.dto.js';

const ok = (body: Record<string, unknown>) => ListingInput.safeParse(body).success;
const fieldOf = (body: Record<string, unknown>) => {
  const r = ListingInput.safeParse(body);
  return r.success ? null : r.error.issues.map((i) => i.path.join('.'));
};

test('international and Russian clothing sizes are accepted', () => {
  assert.ok(ok({ category: 'tshirts', sizeSystem: 'ALPHA', sizeValue: 'M' }));
  assert.ok(ok({ category: 'tshirts', sizeSystem: 'ALPHA', sizeValue: '3XL' }));
  assert.ok(ok({ category: 'tshirts', sizeSystem: 'RU', sizeValue: '48' }));
  assert.ok(ok({ category: 'jeans', sizeSystem: 'JEANS_W', sizes: ['W30', 'W32'] }));
  assert.ok(ok({ category: 'shoes', sizeSystem: 'SHOE_EU', sizeValue: '42' }));
});

test('a size can only be picked from a grid, never typed', () => {
  assert.deepEqual(fieldOf({ category: 'tshirts', sizeSystem: 'ALPHA', sizeValue: 'ДЕТСКОЕ ПОРНО' }), ['size']);
  assert.deepEqual(fieldOf({ category: 'tshirts', sizeValue: 'One size лол' }), ['size']);
  assert.deepEqual(fieldOf({ category: 'tshirts', sizeSystem: 'ALPHA', sizes: ['M', 'нецензурщина'] }), ['size']);
  assert.deepEqual(fieldOf({ category: 'tshirts', sizeSystem: 'RU', sizeValue: '47' }), ['size']);
  assert.deepEqual(fieldOf({ category: 'tshirts', sizeSystem: 'ALPHA', extraSizes: ['XXXXXL'] }), ['size']);
  // OTHER is for imports only.
  assert.ok(!ok({ category: 'tshirts', sizeSystem: 'OTHER', sizeValue: 'Уточняйте' }));
});

test('the grid has to fit the category', () => {
  assert.deepEqual(fieldOf({ category: 'shoes', sizeSystem: 'RU', sizeValue: '42' }), ['size']);
  assert.deepEqual(fieldOf({ category: 'dresses', sizeSystem: 'SHOE_EU', sizeValue: '38' }), ['size']);
});

test('material, style tags and subcategory come from the dictionaries', () => {
  assert.ok(ok({ material: 'Хлопок', styleTags: ['Vintage'], category: 'tshirts', subcategory: 'tshirt' }));
  assert.ok(!ok({ material: 'что угодно' }));
  assert.ok(!ok({ styleTags: ['свой тег'] }));
  assert.ok(!ok({ subcategory: 'not-a-subcategory' }));
  assert.deepEqual(fieldOf({ category: 'shoes', subcategory: 'tshirt' }), ['subcategory']);
});
