import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { combineLook } from '../../src/ai/photo-search.js';
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
