import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromMechta } from '../../src/shops/mechta.js';
import type { PayloadProduct } from '../../src/shops/payload.js';
import { colorFromName, listingTitle, SHOP_SOURCES } from '../../src/shops/sources.js';

const source = (key: string) => SHOP_SOURCES.find((s) => s.key === key)!;
const named = (name_ru: string, descriptionText = ''): PayloadProduct => ({ id: 1, name_ru, descriptionText });
const title = (key: string, p: PayloadProduct) => {
  const cfg = source(key);
  const kind = cfg.kind(p);
  return kind && listingTitle(cfg, p, kind);
};

test('a Mechta product: prices of the sizes on sale, pre-orders out of stock, fabric as «Состав»', () => {
  const p = fromMechta({
    id: 59,
    name: ' Джинсы Dreaming? ',
    description: 'Широкие джинсы.',
    compound: '72% хлопок, 26% полиэстер\n\n• ручная стирка',
    sizes: [
      { name: 'S-M', price: 200, original_price: null, stock_status: 'Предзаказ', sold_out: true },
      { name: 'M-L', price: 160, original_price: 200, stock_status: 'Осталось мало', sold_out: false },
      { name: 'L-XL', price: 160, original_price: 200, stock_status: 'Предзаказ', sold_out: false },
    ],
    media: [{ url: 'https://api.mechtastore.by/storage/1/a.jpg', thumb_600: 'https://api.mechtastore.by/storage/1/a-600.webp' }, { url: null }],
    categories: [{ name: 'Брюки/шорты' }, { name: 'Все товары' }, { name: 'SALE' }],
  });
  assert.equal(p.id, '59');
  assert.equal(p.name_ru, 'Джинсы Dreaming?');
  assert.equal(p.price, 160);
  assert.equal(p.oldPrice, 200);
  assert.deepEqual(p.stock, [{ size: 'S-M', quantity: 0 }, { size: 'M-L', quantity: 1 }, { size: 'L-XL', quantity: 0 }]);
  assert.equal(p.inStock, true);
  assert.deepEqual(p.category, { name: 'Брюки/шорты' });
  assert.equal(p.descriptionText, 'Широкие джинсы.\n\nСостав: 72% хлопок, 26% полиэстер\n\n• ручная стирка');
  assert.deepEqual(p.images, [{ image: { url: 'https://api.mechtastore.by/storage/1/a.jpg', sizes: { product: { url: 'https://api.mechtastore.by/storage/1/a-600.webp' } } } }]);
});

test('every size on pre-order: nothing to buy now', () => {
  const p = fromMechta({ id: 7, name: 'Лонгслив Base logo white', sizes: [{ name: 'S', price: 170, stock_status: 'Предзаказ', sold_out: false }] });
  assert.equal(p.inStock, false);
  assert.equal(p.price, 170);
});

test('Mechta titles: the kind in Russian, the brand once, the model as the shop names it', () => {
  assert.equal(title('mechtastreetwear', named('Бомбер Haze black')), 'Бомбер Mechta Haze black');
  assert.equal(title('mechtastreetwear', named('Zip-худи Base logo pink')), 'Зип-худи Mechta Base logo pink');
  assert.equal(title('mechtastreetwear', named('Худи Zip blue')), 'Зип-худи Mechta blue');
  assert.equal(source('mechtastreetwear').kind(named('Худи Main pink'))?.subcategory, 'hoodie');
  assert.equal(source('mechtastreetwear').kind(named('Олимпийка Base'))?.subcategory, 'windbreaker');
  assert.equal(source('mechtastreetwear').kind(named('Джинсы Dreaming?', 'Широкие джинсы'))?.subcategory, 'wide');
  assert.equal(source('mechtastreetwear').kind(named('Джинсы Base', 'Классические джинсы'))?.subcategory, 'straight');
  assert.equal(source('mechtastreetwear').kind(named('Подарочный сертификат')), null);
});

test('KLTR titles: capitals in normal case except the model in «», non-clothing skipped', () => {
  assert.equal(title('kulturabrand', named('КРОП ЗИП-ХУДИ "FRAME" ЧЕРНЫЙ')), 'Кроп зип-худи KLTR «FRAME» черный');
  assert.equal(title('kulturabrand', named('ФУТБОЛКА КРОП "BLOOM" БЕЛАЯ')), 'Кроп-футболка KLTR «BLOOM» белая');
  assert.equal(title('kulturabrand', named('ФУТБОЛКА "INNER KINDNESS" СИНЯЯ')), 'Футболка KLTR «INNER KINDNESS» синяя');
  assert.equal(title('kulturabrand', named('РАБОЧАЯ КУРТКА "FRAME" DENIM')), 'Рабочая куртка KLTR «FRAME» DENIM');
  assert.equal(source('kulturabrand').kind(named('ЗИП-ХУДИ "FRAME" ЧЕРНЫЙ'))?.subcategory, 'zip-hoodie');
  for (const skip of ['ПАРФЮМ "KLTR" НАБОР', 'ХОЛСТ "WILD FLOWER"', 'ПОДВЕС "ПАЗЛ" Алексей Кривдин', '3D СТИКЕРЫ TENEBRA', 'СЕРТИФИКАТ']) {
    assert.equal(source('kulturabrand').kind(named(skip)), null, skip);
  }
});

test('a Russian word is matched whole: «Худи» is not the start of «Худиный»', () => {
  assert.equal(source('kulturabrand').kind(named('ХУДИНЫЙ ПЛАКАТ')), null);
});

test('colours from Russian feminine and plural forms and the shops’ own words', () => {
  assert.equal(colorFromName('ФУТБОЛКА "BLOOM" БЕЛАЯ'), 'white');
  assert.equal(colorFromName('ШТАНЫ "FRAME" ЧЕРНЫЕ'), 'black');
  assert.equal(colorFromName('РУБАШКА "CLEAR" ХАКИ'), 'green');
  assert.equal(colorFromName('Футболка Base logo graphite'), 'gray');
  assert.equal(colorFromName('Шорты lemon'), 'yellow');
});
