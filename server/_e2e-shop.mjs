// E2E for the brand shop import (src/shops): a fake Payload CMS shop is served locally and synced three times.
// Run after `npm run build`, against an empty or test database: node _e2e-shop.mjs
// With SHOP_FIXTURE=<products.json> (a saved /api/products answer) the real catalogue is imported once instead.
import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import { NestFactory } from '@nestjs/core';
import sharp from 'sharp';
import { AppModule } from './dist/app.module.js';
import { PrismaService } from './dist/prisma/prisma.service.js';
import { RatesService } from './dist/rates/rates.js';
import { ShopImportService } from './dist/shops/shop-import.service.js';
import { SHOP_SOURCES } from './dist/shops/sources.js';

let failures = 0;
const ok = (c, m) => (console.log(`${c ? 'PASS' : 'FAIL'} ${m}`), c || failures++);

const PORT = 4555;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const img = (name) => ({ image: { url: `/api/media/file/${encodeURIComponent(name)}` } });
const text = (s) => ({ root: { type: 'root', children: s.split('\n').map((l) => ({ type: 'paragraph', children: [{ type: 'text', text: l }] })) } });
const product = (id, name, extra = {}) => ({
  id,
  name_ru: name,
  price: 1790,
  oldPrice: null,
  description_ru: text('Материал: хлопок, акрил \nСтирка при 30 °C'),
  stock: [{ size: 'ONE SIZE', quantity: 5 }],
  images: [img(`${id}-a.jpeg`), img(`${id}-b.jpeg`)],
  inStock: true,
  hidden: false,
  isNew: false,
  shippingText: 'отправка 1-3 дня ',
  createdAt: new Date(Date.now() - (100 - id) * 86400_000).toISOString(),
  ...extra,
});

let products = process.env.SHOP_FIXTURE
  ? JSON.parse(fs.readFileSync(process.env.SHOP_FIXTURE, 'utf8')).docs.map((p) => ({
      ...p,
      images: (p.images ?? []).map((i) => img(decodeURIComponent(i.image.url.split('/').pop()))),
      sizeChart: p.sizeChart ? { url: `/api/media/file/${p.sizeChart.url.split('/').pop()}` } : null,
    }))
  : [
      product(1, 'HAT “I<3REDHEAD” CAMO', { oldPrice: 2290 }),
      product(2, 'BOMBER BLACK', { price: 12990, stock: [{ size: 'S', quantity: 2 }, { size: ' XL', quantity: 1 }, { size: 'M', quantity: 0 }], isNew: true }),
      product(3, 'FUR COAT "ЙЕТТИ" BLACK', { price: 16000, oldPrice: 17900, stock: [{ size: 'S-М', quantity: 1 }, { size: 'L-XL', quantity: 0 }] }),
      product(4, 'KEYCHAIN CONDOM', { price: 590, stock: [{ size: 'PINK', quantity: 2 }, { size: 'RED', quantity: 0 }] }),
      product(5, 'BIG BOX', { price: 4900 }),
      product(6, 'T-SHIRT "MESSY LINES" WHITE', { hidden: true, stock: [{ size: 'S', quantity: 3 }] }),
      product(7, 'SHORTS "I <3REDHEAD" CAMO', { stock: [{ size: 'S', quantity: 0 }] }),
      // The original of the second photo never answers: its 800 px copy is taken instead.
      product(8, 'HAT “FLAIM”', { images: [img('8-a.jpeg'), { image: { url: '/api/media/file/broken.jpeg', sizes: { product: { url: '/api/media/file/8-b-800x1000.jpeg' } } } }] }),
    ];

// Distinct product shots, so nothing looks like a duplicate; the logo is a wide SVG like the real one.
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  if (url.pathname === '/api/products') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ docs: products, hasNextPage: false, totalDocs: products.length }));
  }
  if (url.pathname === '/logo.svg') {
    res.setHeader('content-type', 'image/svg+xml');
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60"><text x="10" y="45" font-size="40">REDHEAD</text></svg>');
  }
  if (url.pathname === '/api/media/file/broken.jpeg') {
    res.statusCode = 503;
    return res.end();
  }
  if (url.pathname.startsWith('/api/media/file/')) {
    let h = 0;
    for (const ch of url.pathname) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const body = await sharp({ create: { width: 900, height: 1100, channels: 3, background: { r: h & 255, g: (h >> 8) & 255, b: (h >> 16) & 255 } } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100"><circle cx="${200 + (h % 500)}" cy="${300 + (h % 400)}" r="${80 + (h % 120)}" fill="#fff"/><rect x="${h % 300}" y="${(h >> 4) % 600}" width="240" height="90" fill="#000"/></svg>`) }])
      .jpeg()
      .toBuffer();
    res.setHeader('content-type', 'image/jpeg');
    return res.end(body);
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
const prisma = app.get(PrismaService);
app.get(RatesService).get = async () => ({ perByn: { USD: 0.3, EUR: 0.27, RUB: 28 }, source: 'open', at: new Date().toISOString() });
const shop = app.get(ShopImportService);
const cfg = { ...SHOP_SOURCES[0], origin: ORIGIN, logoUrl: `${ORIGIN}/logo.svg` };

const listings = async () => {
  const user = await prisma.user.findUnique({ where: { username: cfg.key } });
  return prisma.listing.findMany({ where: { sellerId: user.id }, orderBy: { createdAt: 'asc' }, include: { photos: true } });
};
const byTitle = (rows, re) => rows.find((l) => re.test(l.title));

await shop.syncSource(cfg);
const user = await prisma.user.findUnique({ where: { username: cfg.key } });
ok(user && user.brandVerifiedAt && user.brandName === 'I LOVE REDHEAD', 'brand account made and verified');
ok(!!user?.avatarId, 'profile photo from the logo');
let rows = await listings();
const visible = products.filter((p) => !p.hidden && cfg.kind(p) && (p.stock ?? []).some((s) => s.quantity > 0)).length;
ok(rows.filter((l) => l.status === 'PUBLISHED').length === visible, `${visible} products listed (got ${rows.filter((l) => l.status === 'PUBLISHED').length})`);
for (const l of rows) console.log(`   ${l.status} ${l.price} BYN (${l.originalPrice ?? '-'}) | ${l.title} | ${l.category}/${l.subcategory} | ${l.sizeSystem ?? ''} ${l.sizes.join(',') || l.sizeValue || ''} | ${l.color ?? ''} | ${l.labels.join(',')} | ${l.photos.length} фото`);
const failed = await prisma.shopProduct.findMany({ where: { status: 'FAILED' } });
ok(!failed.length, `no failed products ${failed.map((f) => `${f.productId}: ${f.reason}`).join('; ')}`);

if (!process.env.SHOP_FIXTURE) {
  const hat = byTitle(rows, /CAMO$/);
  ok(hat?.title === 'Шапка «I<3REDHEAD» CAMO' && hat.price === 64 && hat.originalPrice === 82 && hat.material === 'Хлопок, акрил', 'hat: title, BYN price, old price, material');
  ok(hat?.publishedAt < new Date(Date.now() - 86400_000), 'first import keeps the product date');
  const bomber = byTitle(rows, /Бомбер/);
  ok(bomber?.title === 'Бомбер I LOVE REDHEAD BLACK' && bomber.sizes.join() === 'S,XL' && bomber.sizeSystem === 'ALPHA' && bomber.color === 'black' && bomber.labels.join() === 'new', 'bomber: brand in title, sizes in stock, colour, «новинка»');
  const coat = byTitle(rows, /Шуба/);
  ok(coat?.sizeSystem === 'OTHER' && coat.sizeValue === 'S-M', 'fur coat: S-М (Cyrillic) → S-M');
  const key = byTitle(rows, /Брелок/);
  ok(key?.sizeValue === null && /В наличии: pink\./.test(key.description), 'keychain: colours in the text, no size');
  ok(!byTitle(rows, /BOX/), 'mystery box skipped');
  const flaim = byTitle(rows, /FLAIM/);
  ok(flaim?.photos.length === 2, 'a photo whose original fails comes from the shop\'s smaller copy');
  // A photo lost on the way (the shop timed out) is topped up by the next sync.
  await prisma.photo.updateMany({ where: { listingId: flaim.id, order: 1 }, data: { listingId: null } });

  // The shop changes: a price drop, a sold-out item, a deleted item, a product shown again.
  products = products
    .filter((p) => p.id !== 3)
    .map((p) => (p.id === 1 ? { ...p, price: 1490 } : p.id === 2 ? { ...p, stock: p.stock.map((s) => ({ ...s, quantity: 0 })), inStock: false } : p.id === 6 ? { ...p, hidden: false } : p));
  await shop.syncSource(cfg);
  rows = await listings();
  ok(byTitle(rows, /FLAIM/)?.photos.length === 2, 'missing photos topped up on the next sync');
  ok(byTitle(rows, /CAMO$/)?.price === 53 && byTitle(rows, /CAMO$/)?.previousPrice === 64, 'price change copied (a price drop)');
  ok(byTitle(rows, /Бомбер/)?.status === 'HIDDEN', 'sold out → hidden');
  ok(byTitle(rows, /Шуба/)?.status === 'DELETED', 'gone from the shop → removed');
  const tee = byTitle(rows, /MESSY/);
  ok(tee?.status === 'PUBLISHED' && tee.publishedAt > new Date(Date.now() - 600_000), 'shown in the shop → listed now');

  // Back in stock; the brand removes one listing by hand — it is not brought back.
  products = products.map((p) => (p.id === 2 ? { ...p, stock: [{ size: 'M', quantity: 4 }], inStock: true } : p));
  await prisma.listing.update({ where: { id: byTitle(rows, /Брелок/).id }, data: { status: 'DELETED' } });
  await shop.syncSource(cfg);
  rows = await listings();
  const b = byTitle(rows, /Бомбер/);
  ok(b?.status === 'PUBLISHED' && b.sizeValue === 'M' && b.sizes.length === 0, 'back in stock → shown again with the new size');
  ok(rows.filter((l) => /Брелок/.test(l.title)).every((l) => l.status === 'DELETED'), 'a listing the brand removed stays removed');
  await shop.syncSource(cfg);
  ok((await listings()).length === rows.length, 'a sync with no changes lists nothing new');
}

await app.close();
server.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
