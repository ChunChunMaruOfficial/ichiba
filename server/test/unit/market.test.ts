import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { catalogSeller, marketFor, marketOf, marketWhere, reclassifySeller } from '../../src/listings/market.js';

const brand = { brandVerifiedAt: new Date(), catalogApprovedAt: null };
const reseller = { brandVerifiedAt: null, catalogApprovedAt: new Date() };
const person = { brandVerifiedAt: null, catalogApprovedAt: null };

test('seller status and catalogue admission are separate facts', () => {
  assert.equal(catalogSeller(brand), true);
  assert.equal(catalogSeller(reseller), true);
  assert.equal(catalogSeller(person), false);
  assert.equal(catalogSeller(null), false);
});

test('admitted sellers list new items with tags in the catalogue', () => {
  assert.equal(marketFor(brand, 'NEW_WITH_TAGS'), 'CATALOG');
  assert.equal(marketFor(reseller, 'NEW_WITH_TAGS'), 'CATALOG');
});

test('worn items go to «Вторичка» whoever sells them — a brand status does not make an item new', () => {
  for (const c of ['LIKE_NEW', 'GOOD', 'VISIBLE_WEAR'] as const) {
    assert.equal(marketFor(brand, c), 'RESALE', c);
    assert.equal(marketFor(reseller, c), 'RESALE', c);
  }
});

test('a reseller without admission, or a private seller, is on «Вторичка» even with new items', () => {
  assert.equal(marketFor(person, 'NEW_WITH_TAGS'), 'RESALE');
  assert.equal(marketFor(null, 'NEW_WITH_TAGS'), 'RESALE');
});

test("new without tags: a brand's own goods stay in the catalogue, a reseller's go to «Вторичка»", () => {
  assert.equal(marketFor(brand, 'NEW_WITH_TAGS', false), 'CATALOG');
  assert.equal(marketFor(brand, 'NEW_WITH_TAGS', true), 'CATALOG');
  assert.equal(marketFor(reseller, 'NEW_WITH_TAGS', true), 'CATALOG');
  assert.equal(marketFor(reseller, 'NEW_WITH_TAGS', false), 'RESALE');
  assert.equal(marketFor(person, 'NEW_WITH_TAGS', true), 'RESALE');
});

test('a draft without a condition follows its seller until it is published', () => {
  assert.equal(marketFor(brand, null), 'CATALOG');
  assert.equal(marketFor(person, undefined), 'RESALE');
});

test('lists default to the catalogue and never mix the two sections', () => {
  assert.deepEqual(marketWhere(), { market: 'CATALOG' });
  assert.deepEqual(marketWhere('brands'), { market: 'CATALOG' });
  assert.deepEqual(marketWhere('resale'), { market: 'RESALE' });
  assert.deepEqual(marketWhere('all'), {});
});

test('the section is read off the listing itself, not its seller', () => {
  assert.equal(marketOf({ market: 'CATALOG' }), 'brands');
  assert.equal(marketOf({ market: 'RESALE' }), 'resale');
});

test('reclassifying a seller never touches items an admin placed by hand, nor deleted ones', async () => {
  const calls: Prisma.ListingUpdateManyArgs[] = [];
  const db = { listing: { updateMany: async (a: Prisma.ListingUpdateManyArgs) => (calls.push(a), { count: 0 }) } };
  await reclassifySeller(db, 's1', brand);
  await reclassifySeller(db, 's1', person);
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.equal(c.where?.sellerId, 's1');
    assert.equal(c.where?.marketByAdmin, false);
    assert.deepEqual(c.where?.status, { not: 'DELETED' });
  }
  assert.deepEqual(calls[2].data, { market: 'RESALE' });
});
