/**
 * Data for looking at the admin screens in a browser against the isolated test database (never the working one):
 *   npx tsx test/int/seed-browser.ts
 * then run the API with that database (`.claude/launch.json` → server-test) and sign in at /admin with the test
 * admin below. The password is a test value for this throwaway database only.
 */
import * as bcrypt from 'bcryptjs';
import { resetAndMigrate, useTestDatabaseForApp } from './helpers/testdb.js';

export const TEST_ADMIN = { email: 'admin@ichiba.test', password: 'test-admin-pass-51300' };

useTestDatabaseForApp();
const { PrismaService } = await import('../../src/prisma/prisma.service.js');

await resetAndMigrate();
const prisma = new PrismaService();
const at = new Date();
const admin = await prisma.user.create({ data: { username: 'test_admin', email: TEST_ADMIN.email, emailVerifiedAt: at, role: 'ADMIN', passwordHash: await bcrypt.hash(TEST_ADMIN.password, 10), privacyAcceptedAt: at } });
const brand = await prisma.user.create({ data: { username: 'test_brand', brandVerifiedAt: at, brandName: 'Test Brand', privacyAcceptedAt: at } });
const reseller = await prisma.user.create({ data: { username: 'test_reseller', privacyAcceptedAt: at } });
const buyer = await prisma.user.create({ data: { username: 'test_buyer', privacyAcceptedAt: at } });

const item = (sellerId: string, title: string, over: Record<string, unknown> = {}) =>
  prisma.listing.create({ data: { sellerId, title, status: 'PUBLISHED', category: 'tshirts', sizeValue: 'M', condition: 'NEW_WITH_TAGS', price: 120, defectsPresent: false, deliveryOptions: ['IN_PERSON'], publishedAt: at, liftedAt: at, ...over } });
await item(brand.id, 'Футболка бренда', { market: 'CATALOG' });
await item(brand.id, 'Худи бренда, договорная', { market: 'CATALOG', price: null, priceNegotiable: true });
await item(reseller.id, 'Кроссовки перекупа, новые', { market: 'RESALE' });
await item(reseller.id, 'Куртка перекупа, ношеная', { market: 'RESALE', condition: 'GOOD' });
const disputed = await item(reseller.id, 'Джинсы в споре', { status: 'RESERVED', market: 'RESALE' });

await prisma.brandApplication.create({
  data: { userId: reseller.id, kind: 'CATALOG', brandName: 'Test Resale Shop', legalForm: 'IP', unp: '123456789', contactName: 'Тест', email: 'shop@ichiba.test', description: 'Оригиналы из официальных магазинов, чеки к каждой вещи' },
});
await prisma.buyRequest.create({
  data: {
    buyerId: buyer.id,
    sellerId: reseller.id,
    priceTotal: 120,
    deliveryMethod: 'IN_PERSON',
    status: 'DISPUTED',
    items: { create: [{ listingId: disputed.id, price: 120 }] },
    events: {
      create: [
        { status: 'PENDING_SELLER', byUserId: buyer.id },
        { status: 'WAITING_HANDOVER', byUserId: reseller.id },
        { status: 'DISPUTED', byUserId: buyer.id, reason: 'Продавец не пришёл на встречу и не отвечает' },
      ],
    },
  },
});
console.log(`seeded test database: admin @${admin.username} (${TEST_ADMIN.email})`);
await prisma.$disconnect();
