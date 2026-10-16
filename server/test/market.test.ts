import assert from 'node:assert/strict';
import { test } from 'node:test';
import { marketFor, marketOf, marketWhere } from '../src/listings/market.js';

test('a confirmed brand lists in the catalogue, everyone else on «Вторичка»', () => {
  assert.equal(marketFor({ brandVerifiedAt: new Date() }), 'CATALOG');
  assert.equal(marketFor({ brandVerifiedAt: null }), 'RESALE');
  assert.equal(marketFor(null), 'RESALE');
});

test('lists default to the catalogue and never mix the two sections', () => {
  assert.deepEqual(marketWhere(), { market: 'CATALOG' });
  assert.deepEqual(marketWhere('brands'), { market: 'CATALOG' });
  assert.deepEqual(marketWhere('resale'), { market: 'RESALE' });
  // Both only when asked for on purpose.
  assert.deepEqual(marketWhere('all'), {});
});

test('the section is read off the listing itself, not its seller', () => {
  assert.equal(marketOf({ market: 'CATALOG' }), 'brands');
  assert.equal(marketOf({ market: 'RESALE' }), 'resale');
});
