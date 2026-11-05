import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { categoryBySlug, COLOR_VALUES, MATERIALS, SIZES, sizeRequired, STYLE_TAGS } from '../../src/catalog/catalog.js';
import { BATCHES } from '../../src/listings/hand-batches.js';

const SEED = resolve(import.meta.dirname, '../../seed-data');

test('every hand-listed item fits the catalogue and has its photos', () => {
  for (const batch of BATCHES) {
    const titles = new Set<string>();
    const photos = new Set<string>();
    if (batch.account?.logo) assert.ok(existsSync(resolve(SEED, batch.folder, batch.account.logo)), `${batch.username}: logo missing`);
    for (const item of batch.items) {
      const i = item.input;
      const where = `${batch.username} «${i.title}»`;
      assert.ok(i.title && i.title.length <= 80, `${where}: title`);
      assert.ok(!titles.has(i.title!), `${where}: title repeated`);
      titles.add(i.title!);
      const category = categoryBySlug(i.category);
      assert.ok(category, `${where}: category ${i.category}`);
      assert.ok(category!.subcategories.some((s) => s.slug === i.subcategory), `${where}: subcategory ${i.subcategory}`);
      if (sizeRequired(i.category)) assert.ok(i.sizeSystem && i.sizeValue, `${where}: size required`);
      if (i.sizeSystem && i.sizeSystem !== 'OTHER') {
        assert.ok(category!.sizeSystems.includes(i.sizeSystem), `${where}: grid ${i.sizeSystem} for ${i.category}`);
        assert.ok((SIZES[i.sizeSystem] as string[]).includes(i.sizeValue!), `${where}: size ${i.sizeValue}`);
      }
      assert.ok(i.price != null ? i.price >= 1 && Number.isInteger(i.price) : i.priceNegotiable, `${where}: price`);
      assert.ok(i.condition, `${where}: condition`);
      assert.ok(i.condition !== 'NEW_WITH_TAGS' || typeof i.hasTags === 'boolean', `${where}: new says whether the tags are on`);
      assert.ok(!i.defectsPresent || i.defectsDescription, `${where}: defects described`);
      if (i.color) assert.ok(COLOR_VALUES.includes(i.color), `${where}: colour ${i.color}`);
      if (i.material) assert.ok(MATERIALS.includes(i.material), `${where}: material ${i.material}`);
      for (const tag of i.styleTags ?? []) assert.ok(STYLE_TAGS.includes(tag), `${where}: style ${tag}`);
      assert.ok((i.styleTags ?? []).length <= 3, `${where}: style tags`);
      assert.ok(!i.description || i.description.length <= 2000, `${where}: description`);
      // A channel's post decorations (star lines, «info/buy», «наличие») are not an item's text.
      assert.ok(!/[⭐]|info\/buy|наличие\.$/mu.test(i.description ?? ''), `${where}: channel decoration in the description`);
      assert.ok(!item.retext || i.description, `${where}: retext without a description`);
      assert.ok(item.photos.length >= 1 && item.photos.length <= 10, `${where}: photo count`);
      if (item.cover) assert.ok(item.photos.includes(item.cover), `${where}: cover ${item.cover} not among the photos`);
      for (const p of item.photos) {
        assert.ok(!photos.has(p), `${where}: photo ${p} used twice`);
        photos.add(p);
        assert.ok(existsSync(resolve(SEED, batch.folder, p)), `${where}: photo ${p} missing`);
      }
    }
  }
});
