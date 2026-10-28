import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSeo, contentHash, slugify, tidyTitle, TITLE_MAX, DESCRIPTION_MAX, type SeoListing } from '../../src/seo/seo.js';
import { checkBlurb, SeoWriter } from '../../src/seo/seo-writer.js';

const base: SeoListing = {
  id: '00000000-0000-4000-8000-000000000000',
  status: 'PUBLISHED',
  title: '',
  description: null,
  category: 'outerwear',
  subcategory: 'jacket',
  brand: null,
  color: null,
  material: null,
  gender: null,
  condition: 'GOOD',
  hasTags: null,
  sizeSystem: 'ALPHA',
  sizeValue: 'M',
  sizes: [],
  price: 120,
  priceNegotiable: false,
  city: 'Минск',
  deliveryOptions: ['IN_PERSON', 'DELIVERY'],
  market: 'RESALE',
};
const seo = (l: Partial<SeoListing>) => buildSeo({ ...base, ...l });

test('the colour agrees with the item word in gender and number', () => {
  assert.equal(seo({ title: 'Куртка', color: 'black' }).name, 'Чёрная куртка');
  assert.equal(seo({ title: 'Свитер', category: 'knitwear', subcategory: 'sweater', color: 'black' }).name, 'Чёрный свитер');
  assert.equal(seo({ title: 'Пальто', subcategory: 'coat', color: 'blue' }).name, 'Синее пальто');
  assert.equal(seo({ title: 'Джинсы', category: 'jeans', subcategory: 'wide', color: 'lightblue' }).name, 'Голубые джинсы');
  // The seller's own adjective decides: «меховая зип-худи» stays feminine.
  assert.equal(seo({ title: 'Меховая зип-худи', category: 'knitwear', subcategory: 'zip-hoodie', color: 'black' }).name, 'Чёрная меховая зип-худи');
});

test("the seller's title stays the name; only what it lacks is added", () => {
  // Brand from the field, colour in front, gender at the end.
  assert.equal(seo({ title: 'Куртка Detroit', brand: 'Carhartt', color: 'black', gender: 'MALE' }).name, 'Чёрная куртка Detroit Carhartt мужская');
  // A colour or shade already in the title is not repeated.
  assert.equal(seo({ title: 'Молочный свитер', category: 'knitwear', subcategory: 'sweater', color: 'white' }).name, 'Молочный свитер');
  // A brand the title already names, even partly («Hilfiger» for Tommy Hilfiger), is not added again.
  assert.equal(seo({ title: 'Синяя футболка Hilfiger Denim', category: 'tshirts', subcategory: 'tshirt', brand: 'Tommy Hilfiger', color: 'blue' }).name, 'Синяя футболка Hilfiger Denim');
  // After «с вышивкой» an adjective can't go at the end: the gender goes to the description instead.
  const open = seo({ title: 'Топ с кружевом', category: 'tshirts', subcategory: 'top', color: 'pink', gender: 'FEMALE' });
  assert.equal(open.name, 'Розовый топ с кружевом');
  assert.match(open.description, /для женщин/i);
  // Skirts need no «женская».
  assert.equal(seo({ title: 'Юбка', category: 'skirts', subcategory: 'mini', gender: 'FEMALE' }).name, 'Юбка');
});

test('a title that is only a brand or a model gets the item word in front', () => {
  assert.equal(seo({ title: 'MIRAR «Тень»', category: 'trousers', subcategory: 'cargo', color: 'brown' }).name, 'Коричневые брюки карго MIRAR «Тень»');
});

test('the title carries size, condition, price and place within the length budget', () => {
  const s = seo({ title: 'Куртка Carhartt', color: 'black' });
  assert.equal(s.title, 'Чёрная куртка Carhartt, размер M, б/у — 120 р.');
  assert.ok(s.title.length <= TITLE_MAX);
  // No price: «купить в Минске» takes its place.
  assert.match(seo({ title: 'Куртка', priceNegotiable: true }).title, /купить в Минске$/);
  // A size the title already has is not repeated, an unknown one («Уточняйте») never shown.
  assert.doesNotMatch(seo({ title: 'Рубашка Gap, размер M', category: 'shirts', subcategory: 'shirt' }).title, /размер M.*размер M/);
  assert.doesNotMatch(seo({ title: 'Брюки', sizeSystem: 'OTHER', sizeValue: 'Уточняйте' }).title + seo({ title: 'Брюки', sizeSystem: 'OTHER', sizeValue: 'Уточняйте' }).description, /Уточняйте/);
  // A new item on «Вторичка»: «новая с биркой» when the tags are on; the place goes first when room runs out.
  assert.equal(seo({ title: 'Куртка', condition: 'NEW_WITH_TAGS', hasTags: true, price: 99 }).title, 'Куртка, размер M, новая с биркой — 99 р.');
});

test('the description leads with the facts and stays within the limit', () => {
  const s = seo({ title: 'Белая кофта', category: 'tshirts', subcategory: 'longsleeve', material: 'Хлопок', description: 'Мягкая кофта из хлопка. Сидит свободно, рукава длинные. '.repeat(5) });
  assert.ok(s.description.startsWith('Белая кофта — цена 120 р. Лонгслив, размер M, состояние: хорошее, материал: хлопок.'));
  assert.ok(s.description.length <= DESCRIPTION_MAX);
  assert.match(seo({ title: 'Куртка', auctionPrice: 40 }).description, /аукцион, ставка от 40 р\./);
});

test('promotion and shouting are taken out of titles', () => {
  assert.equal(tidyTitle('СРОЧНО!!! Куртка Zara ТОРГ'), 'Куртка Zara');
  assert.equal(tidyTitle('ДЖИНСЫ LEVIS 501 НОВЫЕ'), 'Джинсы LEVIS 501 новые');
  assert.equal(tidyTitle('Майка MIRARWEAR «GOD IS WITH US!»'), 'Майка MIRARWEAR «GOD IS WITH US!»');
  assert.equal(tidyTitle('Кроссовки 🔥 Nike'), 'Кроссовки Nike');
});

test('slugs are Latin words of the name', () => {
  assert.equal(slugify('Чёрная куртка Carhartt «Детройт»'), 'chernaya-kurtka-carhartt-detroyt');
  assert.equal(slugify('Шапка Hermès & Co'), 'shapka-hermes-and-co');
  assert.equal(seo({ title: 'Куртка Carhartt', color: 'black' }).slug, 'chernaya-kurtka-carhartt');
  assert.ok(slugify('очень '.repeat(30)).length <= 60);
});

test('what the AI found counts only while the seller still says it', () => {
  const l = { ...base, title: 'Кроссовки Nike Air Max 90', category: 'shoes', subcategory: 'sneakers', description: 'Классика.' };
  const ai = { hash: contentHash(l), model: 'Air Max 90', features: [], blurb: null };
  assert.match(buildSeo({ ...l, title: 'Кроссовки Nike', description: 'Модель Air Max 90.', ai }).name, /Air Max 90/);
  // A model the text doesn't have (an invention, or the seller edited it out) is ignored.
  assert.doesNotMatch(buildSeo({ ...l, title: 'Кроссовки Nike', description: 'Белые.', ai }).name, /Air Max/);
  // A line written for an older text is not used.
  const stale = buildSeo({ ...l, description: 'Другой текст.', ai: { ...ai, blurb: 'Классические кроссовки Nike Air Max 90 в отличном виде.' } });
  assert.doesNotMatch(stale.description, /в отличном виде/);
});

test('the line about the item passes only as a retelling of the seller text', () => {
  const l = { ...base, title: 'Брюки карго MIRAR', brand: 'MIRAR', color: 'brown', description: 'Оверсайз брюки карго в камуфляжной расцветке, шесть вместительных карманов и светящаяся вышивка.' };
  assert.ok(checkBlurb('Оверсайз брюки карго в камуфляжной расцветке с вместительными карманами и светящейся вышивкой.', l));
  assert.ok(!checkBlurb('Чёрные оверсайз брюки карго с вместительными карманами и светящейся вышивкой.', l), 'another colour');
  assert.ok(!checkBlurb('Оверсайз брюки карго Nike с вместительными карманами и светящейся вышивкой.', l), 'a brand the seller never named');
  assert.ok(!checkBlurb('Брюки карго в камуфляжной расцветке, 8 вместительных карманов и светящаяся вышивка.', l), 'a number the seller never wrote');
  assert.ok(!checkBlurb('Оригинальные брюки карго в камуфляжной расцветке с вместительными карманами.', l), 'an authenticity claim');
  assert.ok(!checkBlurb('Стильные модные трендовые штаны для прогулок, вечеринок и путешествий по городу.', l), 'mostly invented words');
});

test('the ensemble decides by weighted majority, and only on grounded values', () => {
  const writer = new SeoWriter({} as never);
  const l = { ...base, title: 'Кроссовки Nike Air Max 90', category: 'shoes', subcategory: 'sneakers', description: 'Белые, с сеткой.' };
  const vote = (value: object, provider = 'p', weight = 1) => ({ provider, model: 'm', weight, latencyMs: 1, value: { model: '', brand: '', features: [], blurb: '', ...value } });
  const two = writer.decide(l, [vote({ model: 'Air Max 90', features: ['с сеткой'] }, 'a'), vote({ model: 'Air Max 90', features: ['с сеткой', 'ретро'] }, 'b'), vote({ model: '' }, 'c')]);
  assert.equal(two.model, 'Air Max 90');
  // «ретро» is neither in the majority nor in the text.
  assert.deepEqual(two.features, ['с сеткой']);
  // A model only one of three providers saw is dropped, and so is one the text doesn't have.
  assert.equal(writer.decide(l, [vote({ model: 'Air Max 90' }, 'a'), vote({}, 'b'), vote({}, 'c')]).model, null);
  assert.equal(writer.decide(l, [vote({ model: 'Air Max 95' }, 'a'), vote({ model: 'Air Max 95' }, 'b')]).model, null);
});
