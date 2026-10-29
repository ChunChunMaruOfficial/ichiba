import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATEGORIES } from '../../src/catalog/catalog.js';
import { buildLandings, emptyLanding, landingCrumbs, landingLinks, landingText, MIN_ITEMS, normalizeLandingPath, plural, subcategoryName, type LiveRow } from '../../src/seo/landing.js';
import { DESCRIPTION_MAX, TITLE_MAX } from '../../src/seo/seo.js';

let n = 0;
const row = (r: Partial<LiveRow>): LiveRow => ({
  id: `id-${++n}`,
  brand: null,
  category: 'jeans',
  subcategory: 'flare',
  market: 'RESALE',
  gender: null,
  condition: 'GOOD',
  price: 50,
  priceNegotiable: false,
  city: 'Минск',
  deliveryOptions: ['IN_PERSON'],
  updatedAt: new Date('2026-10-01'),
  ...r,
});
const many = (k: number, r: Partial<LiveRow>) => Array.from({ length: k }, () => row(r));

test('every catalogue subcategory has a plural name for its page', () => {
  for (const c of CATEGORIES) for (const s of c.subcategories) assert.notEqual(subcategoryName(s.slug), s.slug, s.slug);
});

test('a page is indexed only with enough live items', () => {
  const pages = buildLandings([...many(MIN_ITEMS, { subcategory: 'flare' }), ...many(MIN_ITEMS - 1, { subcategory: 'wide' })]);
  assert.equal(pages.get('c/jeans')?.indexable, true);
  assert.equal(pages.get('c/jeans/flare')?.indexable, true);
  assert.equal(pages.get('c/jeans/wide')?.indexable, false);
});

test('a narrower page that shows the same items as its parent is not indexed', () => {
  // A brand that only sells flared jeans: its brand page, not three copies of it.
  const pages = buildLandings([...many(8, { brand: 'Levi’s', subcategory: 'flare' }), ...many(8, { subcategory: 'wide' })]);
  const levis = [...pages.values()].find((p) => p.kind === 'brand');
  assert.ok(levis?.indexable);
  assert.equal(pages.get(`${levis.path}/jeans`)?.indexable, false);
  assert.equal(pages.get(`${levis.path}/jeans/flare`)?.indexable, false);
  assert.equal(pages.get('c/jeans/flare')?.indexable, true);
});

test('brand spellings are one brand, at an address in Latin letters', () => {
  const pages = buildLandings([...many(4, { brand: 'COS' }), ...many(3, { brand: 'Cos' }), ...many(6, { brand: 'H&M' })]);
  const brands = [...pages.values()].filter((p) => p.kind === 'brand');
  assert.deepEqual(brands.map((b) => b.path).sort(), ['brands/cos', 'brands/h-and-m']);
  assert.equal(pages.get('brands/cos')?.rows.length, 7);
  assert.equal(pages.get('brands/cos')?.brand?.name, 'COS');
});

test('no brand field, or a placeholder, makes no brand page', () => {
  const pages = buildLandings([...many(6, { brand: 'No name' }), ...many(6, { brand: null })]);
  assert.equal([...pages.values()].filter((p) => p.brand).length, 0);
});

test('a subcategory that is its category under another name has no page of its own', () => {
  const pages = buildLandings(many(8, { category: 'tshirts', subcategory: 'tshirt' }));
  assert.ok(pages.get('c/tshirts')?.indexable);
  assert.equal(pages.has('c/tshirts/tshirt'), false);
  assert.equal(normalizeLandingPath('c/tshirts/tshirt'), null);
});

test('only addresses in the catalogue’s shape are pages', () => {
  assert.equal(normalizeLandingPath('c/jeans/flare'), 'c/jeans/flare');
  assert.equal(normalizeLandingPath('/c/Jeans/'), 'c/jeans');
  assert.equal(normalizeLandingPath('brands/levis/jeans/flare'), 'brands/levis/jeans/flare');
  assert.equal(normalizeLandingPath('c/jeans/jacket'), null);
  assert.equal(normalizeLandingPath('c/nothing'), null);
  assert.equal(normalizeLandingPath('brands/levis/jeans/flare/more'), null);
  assert.equal(normalizeLandingPath('brands/лeвис'), null);
  assert.equal(normalizeLandingPath('search'), null);
});

test('Russian plurals', () => {
  assert.deepEqual(
    [1, 2, 5, 11, 21, 24, 112].map((k) => plural(k, ['вещь', 'вещи', 'вещей'])),
    ['вещь', 'вещи', 'вещей', 'вещей', 'вещь', 'вещи', 'вещей'],
  );
});

test('the text says only what the items are: count, condition, prices, cities', () => {
  const pages = buildLandings([
    ...many(5, { price: 40, deliveryOptions: ['IN_PERSON', 'DELIVERY'] }),
    ...many(3, { price: 120, city: 'Гродно' }),
  ]);
  const t = landingText(pages.get('c/jeans/flare')!);
  assert.match(t.title, /^Джинсы клёш б\/у — купить в Минске/);
  assert.ok(t.title.length <= TITLE_MAX, t.title);
  assert.ok(t.description.length <= DESCRIPTION_MAX, t.description);
  assert.equal(t.intro[0], 'В разделе «Джинсы клёш» сейчас 8 вещей, все — б/у.');
  assert.equal(t.intro[1], 'Цены от 40 до 120 р.');
  assert.equal(t.intro.at(-1), 'Продают в Минске и Гродно; 5 из 8 — с доставкой по Беларуси.');
});

test('new and worn items are counted by condition, not by section', () => {
  const pages = buildLandings([...many(4, { condition: 'NEW_WITH_TAGS', market: 'RESALE' }), ...many(3, { market: 'RESALE' })]);
  const t = landingText(pages.get('c/jeans')!);
  assert.match(t.intro[0], /7 вещей: 4 новых и 3 б\/у\.$/);
  assert.match(t.title, /новые и б\/у/);
});

test('links and breadcrumbs lead only to indexed pages', () => {
  const pages = buildLandings([...many(7, { brand: 'Carhartt', category: 'outerwear', subcategory: 'jacket' }), ...many(7, { brand: 'Carhartt', category: 'knitwear', subcategory: 'hoodie' }), ...many(7, { category: 'outerwear', subcategory: 'coat' })]);
  const jackets = pages.get('brands/carhartt/outerwear')!;
  assert.ok(jackets.indexable);
  assert.deepEqual(landingCrumbs(pages.get('brands/carhartt/outerwear/jacket')!, pages).map((c) => c.path), ['brands/carhartt', 'brands/carhartt/outerwear', 'brands/carhartt/outerwear/jacket']);
  const outerwear = landingLinks(pages.get('c/outerwear')!, pages);
  assert.deepEqual(outerwear.find((g) => g.title === 'Бренды')?.links.map((l) => l.name), ['Carhartt']);
  for (const g of outerwear) for (const l of g.links) assert.ok(pages.get(l.path)?.indexable, l.path);
});

test('pages for women and men: indexed when they differ from the page for everyone', () => {
  const pages = buildLandings([...many(6, { gender: 'FEMALE', subcategory: 'wide' }), ...many(4, { gender: 'MALE', subcategory: 'wide' }), ...many(3, { subcategory: 'wide' })]);
  // For women: their 6 and the 3 not marked for anyone, which fit anyone (as search reads «Женщинам»).
  assert.equal(pages.get('c/women/jeans')?.rows.length, 9);
  assert.equal(pages.get('c/women/jeans')?.name, 'Женские джинсы');
  assert.ok(pages.get('c/women/jeans')?.indexable);
  assert.equal(pages.get('c/men/jeans')?.rows.length, 7);
  assert.equal(pages.get('c/men/jeans/wide')?.name, 'Мужские широкие джинсы');
  // Every jean here is wide: the narrower page would repeat «Женские джинсы».
  assert.equal(pages.get('c/women/jeans/wide')?.indexable, false);
  assert.equal(buildLandings(many(8, { category: 'shoes', subcategory: 'boots', gender: 'FEMALE' })).get('c/women/shoes')?.name, 'Женская обувь');
});

test('no audience pages where nobody is marked, nor for categories already meant for one audience', () => {
  const pages = buildLandings([...many(8, { subcategory: 'wide' }), ...many(8, { category: 'skirts', subcategory: 'mini', gender: 'FEMALE' })]);
  assert.equal(pages.get('c/women/jeans')?.indexable, false);
  assert.equal(pages.has('c/women/skirts'), false);
  assert.equal(normalizeLandingPath('c/women/skirts'), null);
  assert.equal(normalizeLandingPath('c/men/jeans/flare'), 'c/men/jeans/flare');
});

test('a catalogue category with nothing on sale still has a page, out of search', () => {
  const p = emptyLanding('c/skirts/midi');
  assert.equal(p?.name, 'Юбки миди');
  assert.equal(p?.indexable, false);
  assert.match(landingText(p!).intro[0], /нет вещей в продаже/);
  assert.equal(emptyLanding('brands/zara'), null);
  assert.equal(emptyLanding('c/tshirts/tshirt'), null);
});
