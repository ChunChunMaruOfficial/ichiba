import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ListingModerator } from '../../src/ai/moderation.js';

type Answer = Record<string, unknown>;
const clean = { title_is_item: true, title_matches_category: true, photos_show_item: true, photos_real: true, photos_inappropriate: false, bad_photos: [], photos_match_title: true, prohibited_item: false, counterfeit: false, offensive_text: false, contacts_in_text: false, confidence: 0.9, reason: '' };

/**
 * A moderator over a fake ensemble: `answers(feature, images)` gives each provider's answer (null = no answer),
 * `blocked` lists providers refusing for safety.
 */
function moderator(answers: (feature: string, images: number) => Array<Answer | null>, blocked: (feature: string) => string[] = () => [], available = true) {
  const ensemble = {
    available,
    async run(opts: { feature: string; images: Buffer[] }) {
      const votes = answers(opts.feature, opts.images.length)
        .map((value, i) => (value ? { provider: `p${i}`, model: 'm', weight: 1, value, latencyMs: 1 } : null))
        .filter((v) => v !== null);
      return { votes, failures: [], blocked: blocked(opts.feature), latencyMs: 1 };
    },
  };
  const media = { imageForAi: async () => Buffer.from('jpeg') };
  return new ListingModerator({} as never, media as never, ensemble as never);
}

const listing = { id: 'l1', sellerId: 'u1', title: 'Футболка Nike чёрная', description: null, brand: 'Nike', defectsDescription: null, category: 'tshirts', subcategory: 'tshirt' };
const photos = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);
const three = (a: Answer) => [a, a, a];

test('clean photos pass', async () => {
  const v = await moderator(() => three(clean)).check(listing, photos(3));
  assert.equal(v.decision, 'allow');
});

test('one model seeing explicit content is enough to stop the listing', async () => {
  const v = await moderator(() => [clean, clean, { ...clean, photos_inappropriate: true, bad_photos: [1] }]).check(listing, photos(1));
  assert.equal(v.decision, 'reject');
  assert.ok(v.fields.photos);
});

test('a provider refusing the images for safety stops the listing', async () => {
  const v = await moderator(() => [clean, clean], () => ['gemini']).check(listing, photos(1));
  assert.equal(v.decision, 'reject');
  assert.ok(v.fields.photos);
});

test('a drawing instead of a photo is rejected, even by a lone model', async () => {
  const v = await moderator(() => [{ ...clean, photos_real: false }]).check(listing, photos(1));
  assert.equal(v.decision, 'reject');
  assert.match(v.fields.photos, /настоящие фото/);
});

test('a bad picture hidden past the fifth photo is still looked at', async () => {
  const v = await moderator((feature) => (feature === 'listing_photo_moderation' ? three({ ...clean, photos_inappropriate: true, bad_photos: [2] }) : three(clean))).check(listing, photos(8));
  assert.equal(v.decision, 'reject');
  assert.ok(v.reasons.some((r) => r.includes('фото 7')), v.reasons.join('; '));
});

test('no model answering keeps a seller listing from going live, imports go out unchecked', async () => {
  const silent = moderator(() => [null, null]);
  const seller = await silent.check(listing, photos(2));
  assert.equal(seller.decision, 'reject');
  assert.equal(seller.retry, true);
  const imported = await silent.check(listing, photos(2), { allowUnchecked: true });
  assert.notEqual(imported.decision, 'reject');
  assert.equal(imported.checked, false);
});

test('ensemble switched off entirely: same rule', async () => {
  const v = await moderator(() => [], () => [], false).check(listing, photos(1));
  assert.equal(v.decision, 'reject');
  assert.equal(v.retry, true);
});
