import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { resetAndMigrate, useTestDatabaseForApp } from './helpers/testdb.js';

/**
 * Account deletion against a real database (the isolated test one) and real files: everything the person uploaded or
 * wrote leaves — listing photos and videos (sold items included), journal articles, looks, brand applications — and
 * the nightly media cleanup then deletes the files and their search vectors.
 */

useTestDatabaseForApp();
const mediaDir = await mkdtemp(join(tmpdir(), 'ichiba-privacy-'));
process.env.MEDIA_DRIVER = 'local';
process.env.MEDIA_DIR = mediaDir;
const { PrismaService } = await import('../../src/prisma/prisma.service.js');
const { PrivacyService } = await import('../../src/privacy/privacy.js');
const { MediaService } = await import('../../src/media/media.service.js');

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const prisma = new PrismaService();
const redis: Any = { client: null };
const privacy = new PrivacyService(prisma, redis);
const media = new MediaService(prisma, redis);

const at = new Date(Date.now() - 3 * 24 * 3600_000);
let seller: { id: string };
let buyer: { id: string };
let soldId: string;
let liveId: string;

const files = (key: string) => [320, 640, 1280].map((w) => join(mediaDir, `${key}_${w}.webp`));

before(async () => {
  await resetAndMigrate();
  seller = await prisma.user.create({ data: { username: 'privacy_seller', email: 'seller@privacy.test', privacyAcceptedAt: at } });
  buyer = await prisma.user.create({ data: { username: 'privacy_buyer', privacyAcceptedAt: at } });
  const listing = (title: string, status: 'SOLD' | 'PUBLISHED') =>
    prisma.listing.create({ data: { sellerId: seller.id, title, status, category: 'tshirts', sizeValue: 'M', condition: 'GOOD', price: 50, defectsPresent: false, deliveryOptions: ['IN_PERSON'], publishedAt: at } });
  soldId = (await listing('Проданная футболка', 'SOLD')).id;
  liveId = (await listing('Футболка в продаже', 'PUBLISHED')).id;
  const photo = (key: string, listingId: string | null) => prisma.photo.create({ data: { ownerId: seller.id, listingId, key, width: 800, height: 1000, order: 0, createdAt: at } });
  await photo('s1/sold', soldId);
  await photo('s1/live', liveId);
  const keep = await prisma.photo.create({ data: { ownerId: buyer.id, key: 'b1/avatar', width: 400, height: 400, order: 0, createdAt: at } });
  await prisma.user.update({ where: { id: buyer.id }, data: { avatarId: keep.id } });
  for (const key of ['s1/sold', 's1/live', 'b1/avatar']) {
    await mkdir(join(mediaDir, key.split('/')[0]), { recursive: true });
    for (const f of files(key)) await writeFile(f, 'webp');
  }
  // Search vectors: the seller's two photos, the buyer's avatar, and one left from a photo deleted long ago.
  for (const key of ['s1/sold', 's1/live', 'b1/avatar', 'old/gone']) await prisma.photoVector.create({ data: { key, model: 'test', vec: new Uint8Array(4) } });

  await prisma.journalArticle.create({ data: { authorId: seller.id, slug: 'privacy-test', rubric: 'sell', title: 'Как продать', description: 'Текст', body: 'Текст статьи' } });
  const look = await prisma.look.create({ data: { userId: seller.id, title: 'Образ' } });
  await prisma.lookItem.create({ data: { lookId: look.id, listingId: liveId } });
  await prisma.brandApplication.create({ data: { userId: seller.id, brandName: 'Privacy Brand', legalForm: 'IP', contactName: 'Иван Иванов', description: 'Свои вещи', email: 'brand@privacy.test' } });
});

after(async () => {
  await prisma.$disconnect();
  await rm(mediaDir, { recursive: true, force: true });
});

test('deleting an account detaches every photo of its listings and removes its articles, looks and applications', async () => {
  await privacy.deleteAccount(seller.id);
  const photos = await prisma.photo.findMany({ where: { ownerId: seller.id }, select: { key: true, listingId: true } });
  assert.equal(photos.length, 2);
  assert.ok(photos.every((p) => p.listingId === null), 'the sold item loses its photo too');
  assert.equal(await prisma.journalArticle.count({ where: { authorId: seller.id } }), 0);
  assert.equal(await prisma.look.count({ where: { userId: seller.id } }), 0);
  assert.equal(await prisma.brandApplication.count({ where: { userId: seller.id } }), 0);
  // The buyer's history keeps the sold item (title and price), without the picture.
  const sold = await prisma.listing.findUniqueOrThrow({ where: { id: soldId } });
  assert.equal(sold.status, 'SOLD');
  assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: liveId } })).status, 'DELETED');
});

test('the nightly cleanup then deletes the files and the search vectors, and leaves what is still in use', async () => {
  const r = await (media as Any).purgeOrphansNow(0);
  assert.equal(r.failed, 0);
  assert.equal(await prisma.photo.count({ where: { ownerId: seller.id } }), 0);
  for (const f of [...files('s1/sold'), ...files('s1/live')]) assert.equal(existsSync(f), false, `${f} deleted`);
  const vectors = (await prisma.photoVector.findMany({ select: { key: true } })).map((v) => v.key);
  assert.deepEqual(vectors, ['b1/avatar'], 'only the vector of a photo still in use stays');
  for (const f of files('b1/avatar')) assert.equal(existsSync(f), true, 'the buyer’s avatar stays');
});
