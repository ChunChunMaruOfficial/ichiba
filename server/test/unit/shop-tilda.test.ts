import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ShopImportService } from '../../src/shops/shop-import.service.js';
import { SHOP_SOURCES } from '../../src/shops/sources.js';
import { fromTilda, tildaText } from '../../src/shops/tilda.js';

const bomber = {
  uid: 322152777083,
  title: 'BOMBER BLACK',
  text: '<br />Куртка до -16°C.<br /><br />Материал: нейлон',
  descr: 'предзаказ: отправка 2-3 недели',
  price: '12990.0000',
  priceold: '',
  quantity: '',
  gallery: '[{"img":"https://static.tildacdn.com/a.webp"},{"img":"https://static.tildacdn.com/b.jpg"}]',
  json_options: '[{"title":"SIZE","values":["S","М","L"]}]',
  editions: [
    { price: '12 990.00', priceold: '17 900.00', quantity: '9', SIZE: 'S' },
    { price: '12 990.00', priceold: '17 900.00', quantity: '0', SIZE: 'М' },
    { price: '12 990.00', priceold: '17 900.00', quantity: '', SIZE: 'L' },
  ],
};

test('a Tilda product comes out in the importer shape', () => {
  const p = fromTilda(bomber);
  assert.equal(p.id, '322152777083');
  assert.equal(p.price, 12990);
  // The old price lives on the editions, written with spaces.
  assert.equal(p.oldPrice, 17900);
  // An empty quantity means «not counted», i.e. in stock.
  assert.deepEqual(p.stock, [{ size: 'S', quantity: 9 }, { size: 'М', quantity: 0 }, { size: 'L', quantity: 1 }]);
  assert.equal(p.inStock, true);
  assert.deepEqual(p.images?.map((i) => i.image?.url), ['https://static.tildacdn.com/a.webp', 'https://static.tildacdn.com/b.jpg']);
  assert.equal(p.descriptionText, 'Куртка до -16°C.\n\nМатериал: нейлон');
  assert.equal(p.shippingText, 'предзаказ: отправка 2-3 недели');
});

test('entities and stock without options', () => {
  const hat = fromTilda({ uid: 1, title: 'HAT “i&lt;3redhead” black', price: '1590.0000', priceold: '2290', quantity: '0', editions: [{ quantity: '0' }] });
  assert.equal(hat.name_ru, 'HAT “i<3redhead” black');
  assert.deepEqual(hat.stock, []);
  assert.equal(hat.inStock, false);
  assert.equal(tildaText('<p>Раз&nbsp;&amp;&nbsp;два</p><p>три</p>'), 'Раз & два\nтри');
});

test('a product that moved to new shop ids keeps its listing', async () => {
  const cfg = SHOP_SOURCES.find((s) => s.key === 'iloveredhead')!;
  const updates: Array<{ id: string; productId: string }> = [];
  const prisma = {
    listing: {
      findMany: async () => [
        { id: 'L1', title: 'Бомбер I LOVE REDHEAD BLACK' },
        { id: 'L2', title: 'Шапка «I<3REDHEAD» BLACK' },
        { id: 'L3', title: 'Шапка I LOVE REDHEAD «HEAD» RED' },
        // Renamed in the shop: «HAT “I<3REDHEAD” CAMO» is now «HAT “CAMO”».
        { id: 'L4', title: 'Шапка «I<3REDHEAD» CAMO' },
      ],
    },
    shopProduct: {
      update: async ({ where, data }: { where: { id: string }; data: { productId: string } }) => {
        updates.push({ id: where.id, productId: data.productId });
        return { ...rows.get([...rows.values()].find((r) => r.id === where.id)!.productId)!, productId: data.productId };
      },
    },
  };
  const row = (id: string, productId: string, listingId: string) => ({ id, productId, listingId, sourceId: 's', status: 'LISTED', reason: null, fingerprint: null, createdAt: new Date(), updatedAt: new Date() });
  const rows = new Map([row('r1', '11', 'L1'), row('r2', '12', 'L2'), row('r3', '13', 'L3'), row('r4', '14', 'L4')].map((r) => [r.productId, r]));
  const svc = new ShopImportService(prisma as never, null as never, null as never, null as never, null as never, null as never);
  const products = [fromTilda(bomber), fromTilda({ uid: 900, title: 'HAT “i&lt;3redhead” black', price: '1590' }), fromTilda({ uid: 901, title: 'HAT “NEW ONE”', price: '1590' }), fromTilda({ uid: 902, title: 'HAT “CAMO”', price: '1590' })];
  await (svc as unknown as { adoptMoved: (...a: unknown[]) => Promise<void> }).adoptMoved(cfg, products, rows);

  assert.deepEqual(updates, [
    { id: 'r1', productId: '322152777083' },
    { id: 'r2', productId: '900' },
    { id: 'r4', productId: '902' },
  ]);
  assert.deepEqual([...rows.keys()].sort(), ['13', '322152777083', '900', '902']);
});
