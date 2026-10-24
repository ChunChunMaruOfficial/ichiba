import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalise } from '../../src/ai/embeddings.js';
import { buildProfile, kindOf, rankForYou, score, SIGNAL_WEIGHTS, type TasteEvent, type TasteInput, type Traits } from '../../src/recommendations/taste.js';

const now = Date.UTC(2026, 9, 24);
const DAY = 24 * 3600 * 1000;

/** A look direction in 8 dimensions, with a little of its own so no two items are the same. */
const look = (axis: number, i = 0) => normalise(Array.from({ length: 8 }, (_, d) => (d === axis ? 1 : 0) + (d === (axis + 1 + (i % 6)) % 8 ? 0.15 : 0)));

let n = 0;
const item = (over: Partial<Traits> = {}): Traits => ({
  id: `i${n++}`,
  sellerId: `s${n % 7}`,
  category: 'tshirts',
  subcategory: null,
  brand: null,
  color: null,
  sizeValue: 'M',
  sizes: [],
  styleTags: [],
  gender: null,
  price: 50,
  publishedAt: new Date(now - 30 * DAY),
  ...over,
});
const ev = (type: keyof typeof SIGNAL_WEIGHTS, listing: Traits, daysAgo = 1): TasteEvent => ({ type, weight: SIGNAL_WEIGHTS[type], at: now - daysAgo * DAY, listing });
const input = (events: TasteEvent[], vectors: Map<string, Float32Array>, extra: Partial<TasteInput> = {}): TasteInput => ({
  now,
  events,
  vectors,
  followed: new Set(),
  sizes: [],
  popularity: new Map(),
  ...extra,
});

test('items that look like the liked ones come first, though their traits say nothing', () => {
  const liked = [0, 1, 2].map(() => item());
  const alike = [0, 1, 2].map(() => item());
  const other = Array.from({ length: 12 }, () => item());
  const vectors = new Map<string, Float32Array>();
  liked.forEach((l, i) => vectors.set(l.id, look(0, i)));
  alike.forEach((l, i) => vectors.set(l.id, look(0, i + 3)));
  other.forEach((l, i) => vectors.set(l.id, look(4, i)));
  const ranked = score(input(liked.map((l) => ev('favorite', l)), vectors), buildProfile(input(liked.map((l) => ev('favorite', l)), vectors)), [...other, ...alike]);
  assert.deepEqual(new Set(ranked.slice(0, 3).map((r) => r.item.id)), new Set(alike.map((a) => a.id)));
});

test('two tastes are both served, not their middle', () => {
  const [grunge, office] = [[0, 1, 2].map(() => item()), [0, 1, 2].map(() => item())];
  const [moreGrunge, moreOffice, middle] = [item(), item(), item()];
  const vectors = new Map<string, Float32Array>();
  grunge.forEach((l, i) => vectors.set(l.id, look(0, i)));
  office.forEach((l, i) => vectors.set(l.id, look(4, i)));
  vectors.set(moreGrunge.id, look(0, 4));
  vectors.set(moreOffice.id, look(4, 4));
  // Halfway between the two looks: what an average of the profile would pick.
  vectors.set(middle.id, normalise(look(0).map((x, d) => x + look(4)[d])));
  const events = [...grunge, ...office].map((l) => ev('favorite', l));
  const ranked = score(input(events, vectors), buildProfile(input(events, vectors)), [middle, moreGrunge, moreOffice]).map((r) => r.item.id);
  assert.equal(ranked.at(-1), middle.id);
});

test('a look the person turned down is pushed down', () => {
  const liked = [item(), item()];
  const [disliked, copy, fine] = [item(), item(), item()];
  const vectors = new Map<string, Float32Array>([
    [liked[0].id, look(0)],
    [liked[1].id, look(2)],
    [disliked.id, look(1)],
    [copy.id, look(1, 1)],
    [fine.id, look(1, 5)],
  ]);
  vectors.set(fine.id, normalise(look(0).map((x, d) => x + look(1)[d] * 0.3)));
  const events = [ev('favorite', liked[0]), ev('favorite', liked[1]), ev('view', disliked), ev('not_interested', disliked)];
  const ranked = score(input(events, vectors), buildProfile(input(events, vectors)), [copy, fine]).map((r) => r.item.id);
  assert.deepEqual(ranked, [fine.id, copy.id]);
});

test('a bounce cancels the view it followed', () => {
  const l = item();
  const p = buildProfile(input([ev('view', l), ev('bounce', l)], new Map([[l.id, look(0)]])));
  assert.equal(p.liked.length, 0);
  assert.equal(p.disliked.length, 0);
});

test('an item scrolled past again and again gives way to an equal one', () => {
  const liked = item({ brand: 'Nike' });
  const [seen, unseen] = [item({ brand: 'Nike' }), item({ brand: 'Nike' })];
  const base = input([ev('favorite', liked)], new Map());
  const order = (ignored: Map<string, number>) => score({ ...base, ignored }, buildProfile(base), [seen, unseen]).map((r) => r.item.id);
  assert.equal(order(new Map())[0], seen.id);
  assert.deepEqual(order(new Map([[seen.id, 4]])), [unseen.id, seen.id]);
});

test('the feed mixes kinds and never shows 4 of one seller in a row', () => {
  const liked = item({ sellerId: 'a', category: 'jeans' });
  const pool = [
    ...Array.from({ length: 8 }, () => item({ sellerId: 'a', category: 'jeans' })),
    ...Array.from({ length: 8 }, (_, i) => item({ sellerId: `b${i}`, category: i % 2 ? 'shoes' : 'knitwear' })),
  ];
  const feed = rankForYou(input([ev('favorite', liked), ev('favorite', liked), ev('favorite', liked)], new Map()), pool);
  // Four in a row only once nobody else is left.
  for (let i = 3; i < feed.length; i++)
    if (feed.slice(i - 3, i + 1).every((f) => f.sellerId === 'a')) assert.ok(feed.slice(i).every((f) => f.sellerId === 'a'), 'four in a row from one seller');
  assert.ok(new Set(feed.slice(0, 6).map(kindOf)).size >= 2);
});

test('what happened in this session counts more than the same a week ago', () => {
  const [old, now1] = [item({ brand: 'Adidas' }), item({ brand: 'Puma' })];
  const p = buildProfile(input([ev('favorite', old, 7), { ...ev('favorite', now1), at: now - 5 * 60_000 }], new Map()));
  assert.ok(p.traits.brand.get('Puma')! > 2 * p.traits.brand.get('Adidas')!);
});
