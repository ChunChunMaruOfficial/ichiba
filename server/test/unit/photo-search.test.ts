import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { cosine, normalise, vectorFromBytes, vectorToBytes } from '../../src/ai/embeddings.js';
import { type Candidate, combineLook, parseBox, rankCandidates, worthCutting } from '../../src/ai/photo-search.js';
import { colorPalette, decodePalette, PALETTE_BINS, paletteSimilarity } from '../../src/media/palette.js';

const solid = (r: number, g: number, b: number) => sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).png().toBuffer();
/** Black square with a red-orange blotch in the middle: a beanie with flames, roughly. */
const flames = async () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 15, g: 15, b: 15 } } })
    .composite([{ input: await sharp({ create: { width: 28, height: 28, channels: 3, background: { r: 230, g: 70, b: 20 } } }).png().toBuffer(), left: 18, top: 18 }])
    .png()
    .toBuffer();

test('a colour signature is 28 digits that decode to a histogram', async () => {
  const code = await colorPalette(await solid(200, 30, 30));
  assert.equal(code.length, PALETTE_BINS);
  const hist = decodePalette(code)!;
  assert.ok(Math.abs(hist.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('the same colours are similar, other colours are not', async () => {
  const red = await colorPalette(await solid(200, 30, 30));
  const red2 = await colorPalette(await solid(190, 40, 35));
  const blue = await colorPalette(await solid(30, 60, 200));
  assert.ok(paletteSimilarity(red, red2) > 0.9);
  assert.ok(paletteSimilarity(red, blue) < 0.1);
  assert.equal(paletteSimilarity(red, null), 0);
});

test('a black beanie with flames is closer to another one with flames than to a plain black one', async () => {
  const query = await colorPalette(await flames());
  const another = await colorPalette(await flames());
  const plain = await colorPalette(await solid(15, 15, 15));
  assert.ok(paletteSimilarity(query, another) > paletteSimilarity(query, plain));
});

const vote = (value: Record<string, unknown>, provider = 'gemini') => ({ provider, model: 'm', weight: 1, latencyMs: 1, value: value as never });

test('the look is decided by majority: type, colours, pattern and words', () => {
  const base = { category: 'accessories', category_confidence: 0.9, subcategory: 'beanie', colors: ['black', 'red'], pattern: 'flames', keywords: ['пламя'], brand: '', brand_confidence: 0, not_clothing: false };
  const { look, label, notClothing } = combineLook([vote(base), vote({ ...base, keywords: ['огонь', 'вязаная'] }, 'mistral'), vote({ ...base, colors: ['black'], pattern: 'print' }, 'glm')]);
  assert.equal(notClothing, false);
  assert.equal(look.category, 'accessories');
  assert.equal(look.subcategory, 'beanie');
  assert.deepEqual(look.colors, ['black', 'red']);
  assert.equal(look.pattern, 'flames');
  assert.deepEqual(look.keywords, ['пламя', 'огонь', 'вязаная']);
  assert.equal(label, 'Шапка, чёрный, с пламенем');
});

test('the item box is the median of the votes of the model that can outline; other boxes are ignored', () => {
  const base = { category: 'accessories', category_confidence: 0.9, subcategory: 'beanie', colors: ['black'], pattern: 'solid', keywords: [], brand: '', brand_confidence: 0, not_clothing: false };
  const { box } = combineLook([
    vote({ ...base, box_2d: [100, 200, 300, 400] }),
    vote({ ...base, box_2d: [120, 220, 320, 420] }),
    vote({ ...base, box_2d: [0, 0, 1000, 1000] }, 'mistral'),
  ]);
  assert.deepEqual(box, [110, 210, 310, 410]);
  assert.equal(combineLook([vote({ ...base, box_2d: [1, 2, 3, 4] }, 'glm')]).box, null);
});

test('a box is read from whatever the model wrote', () => {
  assert.deepEqual(parseBox([100, 200, 500, 600]), [0.1, 0.2, 0.5, 0.6]);
  assert.deepEqual(parseBox([[100, 200, 500, 600]]), [0.1, 0.2, 0.5, 0.6]);
  assert.deepEqual(parseBox([0.1, 0.2, 0.5, 0.6]), [0.1, 0.2, 0.5, 0.6]);
  assert.deepEqual(parseBox([-5, 0, 1200, 900]), [0, 0, 1, 0.9]);
  assert.equal(parseBox([500, 200, 100, 600]), null, 'upside down');
  assert.equal(parseBox([1, 2, 3]), null);
  assert.equal(parseBox('рамка'), null);
  assert.equal(parseBox(undefined), null);
  assert.ok(worthCutting([0.1, 0.4, 0.3, 0.6]), 'a beanie on a head');
  assert.ok(!worthCutting([0, 0, 1, 0.95]), 'the item fills the photo');
});

const unit = (...xs: number[]) => normalise(xs);
const noLook = { category: null, subcategory: null, colors: [], pattern: null, keywords: [], brand: null };
const listing = (id: string, keys: string[], extra: Partial<Candidate> = {}): Candidate => ({
  id,
  title: id,
  category: 'tops',
  subcategory: 'tshirt',
  color: 'black',
  brand: null,
  photos: keys.map((key) => ({ key, dhash: null, palette: null })),
  ...extra,
});

test('a listing scores by its closest photo, not only by the cover', () => {
  const space = new Map([
    ['a-cover', unit(1, 0, 0)],
    ['a-back', unit(0, 1, 0)],
    ['b-cover', unit(0.6, 0.8, 0)],
    ['c-cover', unit(0, 0, 1)],
  ]);
  const query = { byModel: new Map([['siglip@q8', { whole: unit(0, 1, 0.05) }]]), dhash: null, palette: null };
  const ranked = rankCandidates([listing('b', ['b-cover']), listing('a', ['a-cover', 'a-back']), listing('c', ['c-cover'])], query, noLook, new Map([['siglip@q8', space]]));
  assert.deepEqual(
    ranked.map((x) => x.id),
    ['a', 'b', 'c'],
  );
});

test('two embedders are averaged; a listing one of them has not indexed yet is ranked by the other', () => {
  const g = new Map([
    ['a', unit(1, 0)],
    ['b', unit(0.8, 0.6)],
    ['c', unit(0, 1)],
  ]);
  const s = new Map([
    ['b', unit(1, 0)],
    ['c', unit(0, 1)],
  ]);
  const query = { byModel: new Map([['gemini-embedding-2@768', { whole: unit(1, 0) }], ['siglip@q8', { whole: unit(1, 0) }]]), dhash: null, palette: null };
  const ranked = rankCandidates([listing('c', ['c']), listing('b', ['b']), listing('a', ['a'])], query, noLook, new Map([['gemini-embedding-2@768', g], ['siglip@q8', s]]));
  assert.equal(ranked.at(-1)!.id, 'c');
  assert.ok(ranked.some((x) => x.id === 'a'), 'not indexed by siglip yet, still a candidate');
});

test('a near-identical photo comes first, the subcategory and the brand add a little', () => {
  const space = new Map([
    ['a', unit(1, 0)],
    ['b', unit(0.9, 0.44)],
    ['c', unit(0.7, 0.71)],
  ]);
  const query = { byModel: new Map([['siglip@q8', { whole: unit(1, 0) }]]), dhash: 'ffff0000ffff0000', palette: null };
  const shot = listing('c', [], { photos: [{ key: 'c', dhash: 'ffff0000ffff0001', palette: null }] });
  const ranked = rankCandidates([listing('a', ['a'], { subcategory: 'longsleeve' }), listing('b', ['b']), shot], query, { ...noLook, subcategory: 'tshirt' }, new Map([['siglip@q8', space]]));
  assert.equal(ranked[0].id, 'c');
});

test('without vectors the colour signature and the look rank, as before', async () => {
  const red = await colorPalette(await solid(200, 30, 30));
  const blue = await colorPalette(await solid(30, 60, 200));
  const cands = [listing('blue', [], { photos: [{ key: 'b', dhash: null, palette: blue }] }), listing('red', [], { photos: [{ key: 'r', dhash: null, palette: red }] })];
  const ranked = rankCandidates(cands, { byModel: new Map(), dhash: null, palette: red }, noLook, new Map());
  assert.equal(ranked[0].id, 'red');
});

test('vectors survive the database round trip', () => {
  const v = unit(3, 4, 0);
  assert.deepEqual(Array.from(vectorFromBytes(vectorToBytes(v))), Array.from(v));
  assert.ok(Math.abs(cosine(v, v) - 1) < 1e-6);
});
