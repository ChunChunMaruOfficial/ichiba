import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { JwtService } from '@nestjs/jwt';
import { resetAndMigrate, useTestDatabaseForApp } from './helpers/testdb.js';

/**
 * Business rules against a real database (the isolated test one): the app's own services and controllers, with
 * stubs only for what talks to the outside world (notifications, AI moderation, statistics, media, chat).
 */

useTestDatabaseForApp();
const { PrismaService } = await import('../../src/prisma/prisma.service.js');
const { ListingsService } = await import('../../src/listings/listings.service.js');
const { RequestsService } = await import('../../src/requests/requests.service.js');
const { DisputesService, AdminDisputesController } = await import('../../src/requests/disputes.js');
const { BrandApplicationsService } = await import('../../src/brands/brand-applications.js');
const { AdminController, AdminGuard } = await import('../../src/moderation/moderation.js');
const { AdminDataController } = await import('../../src/moderation/admin-data.js');
const { CartController } = await import('../../src/cart/cart.js');
const { FavoritesController } = await import('../../src/favorites/favorites.controller.js');
const { SwipeController } = await import('../../src/swipe/swipe.js');

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const prisma = new PrismaService();
const sent: Array<{ to: string | string[]; type: string; payload: unknown }> = [];
const notifications: Any = {
  notify: async (to: string, type: string, payload: unknown) => void sent.push({ to, type, payload }),
  notifyMany: async (to: string[], type: string, payload: unknown) => void sent.push({ to, type, payload }),
};
const recs: Any = { record: async () => {}, hasProfile: async () => false, rankForUser: async () => [], rankPopular: async (p: { id: string }[]) => p.map((x) => x.id) };
const stats: Any = { track: () => {} };
const moderator: Any = { check: async () => ({ decision: 'pass', status: 'passed', reasons: [], fields: {} }), record: async () => {} };
const media: Any = { dhash: async (p: { dhash?: string | null }) => p.dhash ?? null };
const chat: Any = { open: async () => ({ id: 'x' }), send: async () => {} };

const listings = new ListingsService(prisma, recs, notifications, moderator, stats, media);
const requests = new RequestsService(prisma, listings, notifications, recs, stats, chat);
const disputes = new DisputesService(prisma, listings, notifications);
const brands = new BrandApplicationsService(prisma, notifications);
const admin = new AdminController(prisma, notifications, listings);
const adminData = new AdminDataController(prisma, { deleteAccount: async () => {} } as Any, listings);
const cart = new CartController(prisma, recs, stats);
const favorites = new FavoritesController(prisma, recs, stats);
const swipe = new SwipeController(prisma, recs, stats);

// ---------- fixtures ----------

let n = 0;
async function user(over: Record<string, unknown> = {}) {
  n += 1;
  const u = await prisma.user.create({ data: { username: `u${n}_${Date.now() % 100000}`, ...over } });
  return { ...u, auth: { id: u.id, username: u.username, role: u.role } as Any };
}
async function listing(sellerId: string, over: Record<string, unknown> = {}) {
  return prisma.listing.create({
    data: {
      sellerId,
      status: 'PUBLISHED',
      title: `Вещь ${randomUUID().slice(0, 6)}`,
      category: 'tshirts',
      sizeValue: 'M',
      condition: 'NEW_WITH_TAGS',
      hasTags: true,
      price: 100,
      defectsPresent: false,
      deliveryOptions: ['IN_PERSON'],
      publishedAt: new Date(),
      liftedAt: new Date(),
      ...over,
    },
  });
}
const statusOf = async (id: string) => (await prisma.listing.findUniqueOrThrow({ where: { id } })).status;
const marketOfRow = async (id: string) => (await prisma.listing.findUniqueOrThrow({ where: { id } })).market;
const rejects = (p: Promise<unknown>, status: number) => assert.rejects(p, (e: Any) => e?.getStatus?.() === status);

before(async () => {
  await resetAndMigrate();
  await prisma.$connect();
});
after(async () => {
  await prisma.$disconnect();
});
beforeEach(() => {
  sent.length = 0;
});

// ---------- classification ----------

describe('catalogue and «Вторичка»', () => {
  test('new listings are classified by seller status and condition, never by the seller alone', async () => {
    const brand = await user({ brandVerifiedAt: new Date(), brandName: 'B' });
    const person = await user();
    const reseller = await user({ catalogApprovedAt: new Date() });
    const make = async (u: { id: string }, condition: Any) => (await prisma.listing.findUniqueOrThrow({ where: { id: (await listings.create(u.id, { title: 'x', condition }) as Any).id } })).market;
    assert.equal(await make(brand, 'NEW_WITH_TAGS'), 'CATALOG');
    assert.equal(await make(brand, 'GOOD'), 'RESALE');
    assert.equal(await make(reseller, 'NEW_WITH_TAGS'), 'CATALOG');
    assert.equal(await make(reseller, 'LIKE_NEW'), 'RESALE');
    assert.equal(await make(person, 'NEW_WITH_TAGS'), 'RESALE');
  });

  test("«Новое» needs the tags answered to be published; a reseller's untagged new item stays on «Вторичка»", async () => {
    const reseller = await user({ catalogApprovedAt: new Date() });
    const draft = await listing(reseller.id, { status: 'DRAFT', publishedAt: null, hasTags: null, market: 'CATALOG' });
    await prisma.photo.create({ data: { ownerId: reseller.id, listingId: draft.id, key: 'k2', width: 800, height: 1000, isCover: true, dhash: '1' } });
    await assert.rejects(listings.publish(reseller.id, draft.id), (e: Any) => e?.getResponse?.().fields?.hasTags === 'Укажите, есть ли бирка');
    await listings.update(reseller.id, draft.id, { hasTags: false });
    await listings.publish(reseller.id, draft.id);
    assert.equal(await marketOfRow(draft.id), 'RESALE');
    await listings.update(reseller.id, draft.id, { hasTags: true });
    assert.equal(await marketOfRow(draft.id), 'CATALOG');
    // Worn: the tags answer is dropped.
    await listings.update(reseller.id, draft.id, { condition: 'GOOD' });
    const row = await prisma.listing.findUniqueOrThrow({ where: { id: draft.id } });
    assert.equal(row.hasTags, null);
    assert.equal(row.market, 'RESALE');
  });

  test('a draft is classified again when published; a re-shown hidden item keeps its section', async () => {
    const brand = await user({ brandVerifiedAt: new Date() });
    const draft = await listing(brand.id, { status: 'DRAFT', condition: 'GOOD', market: 'CATALOG', publishedAt: null });
    await prisma.photo.create({ data: { ownerId: brand.id, listingId: draft.id, key: 'k', width: 800, height: 1000, isCover: true, dhash: '0' } });
    await listings.publish(brand.id, draft.id);
    assert.equal(await marketOfRow(draft.id), 'RESALE');
    await listings.hide(brand.id, draft.id);
    await prisma.listing.update({ where: { id: draft.id }, data: { market: 'CATALOG' } });
    await listings.publish(brand.id, draft.id);
    assert.equal(await marketOfRow(draft.id), 'CATALOG');
  });

  test('a worn condition moves a live item out of the catalogue, unless an admin placed it', async () => {
    const brand = await user({ brandVerifiedAt: new Date() });
    const a = await listing(brand.id, { market: 'CATALOG' });
    const b = await listing(brand.id, { market: 'CATALOG', marketByAdmin: true });
    await listings.update(brand.id, a.id, { condition: 'GOOD' });
    await listings.update(brand.id, b.id, { condition: 'GOOD' });
    assert.equal(await marketOfRow(a.id), 'RESALE');
    assert.equal(await marketOfRow(b.id), 'CATALOG');
  });

  test('search, feed, similar and the item page use the section of the item', async () => {
    const brand = await user({ brandVerifiedAt: new Date() });
    const person = await user();
    const c = await listing(brand.id, { market: 'CATALOG', category: 'jeans' });
    const r = await listing(person.id, { market: 'RESALE', category: 'jeans' });
    const ids = (x: { items: { id: string }[] }) => x.items.map((i) => i.id);
    const q = (market: Any) => ({ category: ['jeans'], available: '1', sort: 'new', offset: 0, limit: 48, market }) as Any;
    assert.ok(ids(await listings.search(q('brands'))).includes(c.id));
    assert.ok(!ids(await listings.search(q('brands'))).includes(r.id));
    assert.ok(ids(await listings.search(q('resale'))).includes(r.id));
    assert.ok(!ids(await listings.search(q('resale'))).includes(c.id));
    assert.ok(!ids(await listings.feed('new', 0, 48, undefined, 'brands')).includes(r.id));
    const similar = await listings.similar(c.id, 0, 48);
    assert.ok(!ids(similar).includes(r.id));
    assert.equal(((await listings.get(r.id, undefined, { trackView: false })) as Any).market, 'resale');
  });
});

describe('admin placement and seller status', () => {
  test('the admin move endpoint is behind AdminGuard and marks the item as the admin choice', async () => {
    assert.ok((Reflect.getMetadata(GUARDS_METADATA, AdminController) as unknown[]).includes(AdminGuard));
    const adminUser = await user({ role: 'ADMIN' });
    const person = await user();
    const item = await listing(person.id);
    await admin.setMarket(adminUser.auth, item.id, { market: 'brands' });
    const row = await prisma.listing.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(row.market, 'CATALOG');
    assert.equal(row.marketByAdmin, true);
    assert.equal(await prisma.moderationAction.count({ where: { targetId: item.id, action: 'market_brands' } }), 1);
  });

  test('granting and taking away the brand status re-sorts items by the rules but keeps the admin choices', async () => {
    const adminUser = await user({ role: 'ADMIN' });
    const seller = await user();
    const fresh = await listing(seller.id);
    const worn = await listing(seller.id, { condition: 'GOOD' });
    const pinned = await listing(seller.id, { market: 'RESALE', marketByAdmin: true });
    const gone = await listing(seller.id, { status: 'DELETED' });
    const app = await brands.apply(seller.id, { kind: 'BRAND', brandName: 'S', legalForm: 'PERSON', contactName: 'Имя', email: 'a@b.by', links: [], description: 'Шьём одежду в Минске с 2020 года' } as Any);
    await brands.review(adminUser.id, app.id, true, null);
    assert.equal(await marketOfRow(fresh.id), 'CATALOG');
    assert.equal(await marketOfRow(worn.id), 'RESALE');
    assert.equal(await marketOfRow(pinned.id), 'RESALE');
    assert.equal(await marketOfRow(gone.id), 'RESALE');
    // Reviewing the same application twice is refused.
    await rejects(brands.review(adminUser.id, app.id, true, null), 409);
    await prisma.listing.update({ where: { id: pinned.id }, data: { market: 'CATALOG' } });
    await brands.revoke(adminUser.id, seller.id, null);
    assert.equal(await marketOfRow(fresh.id), 'RESALE');
    assert.equal(await marketOfRow(pinned.id), 'CATALOG');
  });

  test('a reseller asks for the catalogue; after approval only new items with tags go there', async () => {
    const adminUser = await user({ role: 'ADMIN' });
    const reseller = await user();
    const fresh = await listing(reseller.id);
    const worn = await listing(reseller.id, { condition: 'LIKE_NEW' });
    const app = await brands.apply(reseller.id, { kind: 'CATALOG', brandName: 'Shop', legalForm: 'IP', unp: '123456789', contactName: 'Имя', email: 'a@b.by', links: [], description: 'Оригиналы из официальных магазинов, чеки есть' } as Any);
    await rejects(brands.apply(reseller.id, { kind: 'CATALOG', brandName: 'Shop', legalForm: 'PERSON', contactName: 'Имя', email: 'a@b.by', links: [], description: 'ещё одна заявка подряд' } as Any), 409);
    await brands.review(adminUser.id, app.id, true, null);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: reseller.id } });
    assert.ok(u.catalogApprovedAt);
    assert.equal(u.brandVerifiedAt, null);
    assert.equal(await marketOfRow(fresh.id), 'CATALOG');
    assert.equal(await marketOfRow(worn.id), 'RESALE');
    assert.equal(sent.at(-1)?.type, 'catalog_approved');
  });
});

// ---------- admin rights ----------

describe('admin rights come from the database', () => {
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const ctx = (req: unknown) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;
  const guard = new AdminGuard(jwt, prisma);

  test('an admin with a valid admin session passes', async () => {
    const a = await user({ role: 'ADMIN' });
    const cookie = await jwt.signAsync({ sub: a.id, purpose: 'admin' });
    assert.equal(await guard.canActivate(ctx({ user: { id: a.id, username: a.username, role: 'ADMIN' }, cookies: { ichiba_admin: cookie } })), true);
  });

  test('after the role is taken away, a token that still says ADMIN is refused', async () => {
    const a = await user({ role: 'ADMIN' });
    const cookie = await jwt.signAsync({ sub: a.id, purpose: 'admin' });
    const stale = { user: { id: a.id, username: a.username, role: 'ADMIN' }, cookies: { ichiba_admin: cookie } };
    await adminData.editUser({ id: randomUUID(), username: 'root', role: 'ADMIN' }, a.id, { role: 'USER' });
    await rejects(guard.canActivate(ctx(stale)), 403);
  });

  test('a blocked admin is refused too; no admin session cookie is refused', async () => {
    const a = await user({ role: 'ADMIN', blockedAt: new Date() });
    const cookie = await jwt.signAsync({ sub: a.id, purpose: 'admin' });
    await rejects(guard.canActivate(ctx({ user: { id: a.id, role: 'ADMIN' }, cookies: { ichiba_admin: cookie } })), 403);
    const b = await user({ role: 'ADMIN' });
    await rejects(guard.canActivate(ctx({ user: { id: b.id, role: 'ADMIN' }, cookies: {} })), 401);
  });

  test('disputes and the database tools are admin-only', () => {
    for (const c of [AdminDisputesController, AdminDataController]) assert.ok((Reflect.getMetadata(GUARDS_METADATA, c) as unknown[]).includes(AdminGuard));
  });
});

// ---------- blocking ----------

describe('blocking and unblocking a user', () => {
  test('unblock brings back only what the block hid; individual decisions stay', async () => {
    const adminUser = await user({ role: 'ADMIN' });
    const buyer = await user();
    const seller = await user();
    const onSale = await listing(seller.id);
    const later = await listing(seller.id);
    const selfHidden = await listing(seller.id, { status: 'HIDDEN' });
    const deleted = await listing(seller.id, { status: 'DELETED' });
    const sold = await listing(seller.id, { status: 'SOLD' });
    const auctioned = await listing(seller.id, { saleType: 'AUCTION', auctionHours: 24 });
    const auction = await prisma.auction.create({ data: { listingId: auctioned.id, startPrice: 100, step: 5, endsAt: new Date(Date.now() + 3600_000) } });
    await prisma.bid.create({ data: { auctionId: auction.id, bidderId: buyer.id, amount: 110 } });
    const offer = await prisma.offer.create({ data: { listingId: onSale.id, buyerId: buyer.id, sellerId: seller.id, round: 1, amount: 80, from: 'BUYER', expiresAt: new Date(Date.now() + 3600_000) } });

    await adminData.blockUser(adminUser.auth, seller.id, { reason: 'тест' });
    for (const l of [onSale, later, auctioned]) {
      const row = await prisma.listing.findUniqueOrThrow({ where: { id: l.id } });
      assert.equal(row.status, 'HIDDEN');
      assert.equal(row.hiddenByBlock, true);
    }
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status, 'CANCELLED');
    assert.equal((await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } })).status, 'CANCELLED');
    assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: auctioned.id } })).saleType, 'FIXED');
    assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: selfHidden.id } })).hiddenByBlock, false);

    // While blocked, a moderator blocks one of the hidden items for its own reason.
    await prisma.listing.update({ where: { id: later.id }, data: { status: 'BLOCKED', blockedReason: 'подделка' } });

    const res = await adminData.unblockUser(adminUser.auth, seller.id);
    assert.equal(res.restored, 2);
    assert.equal(await statusOf(onSale.id), 'PUBLISHED');
    assert.equal(await statusOf(auctioned.id), 'PUBLISHED');
    assert.equal(await statusOf(later.id), 'BLOCKED');
    assert.equal(await statusOf(selfHidden.id), 'HIDDEN');
    assert.equal(await statusOf(deleted.id), 'DELETED');
    assert.equal(await statusOf(sold.id), 'SOLD');
    assert.equal(await prisma.listing.count({ where: { sellerId: seller.id, hiddenByBlock: true } }), 0);
  });

  test('items of an account an admin also hid wait for «Показать объявления»', async () => {
    const adminUser = await user({ role: 'ADMIN' });
    const seller = await user();
    const item = await listing(seller.id);
    await adminData.blockUser(adminUser.auth, seller.id, { reason: 'тест' });
    await adminData.hideListings(adminUser.auth, seller.id);
    // Shown while still blocked: nothing goes on sale yet.
    await adminData.showListings(adminUser.auth, seller.id);
    assert.equal(await statusOf(item.id), 'HIDDEN');
    await adminData.hideListings(adminUser.auth, seller.id);
    await adminData.unblockUser(adminUser.auth, seller.id);
    assert.equal(await statusOf(item.id), 'HIDDEN');
    await adminData.showListings(adminUser.auth, seller.id);
    assert.equal(await statusOf(item.id), 'PUBLISHED');
  });

  test('blocking one item cancels its pending offers and running auction', async () => {
    const adminUser = await user({ role: 'ADMIN' });
    const buyer = await user();
    const seller = await user();
    const item = await listing(seller.id, { saleType: 'AUCTION', auctionHours: 24 });
    const auction = await prisma.auction.create({ data: { listingId: item.id, startPrice: 100, step: 5, endsAt: new Date(Date.now() + 3600_000) } });
    const offer = await prisma.offer.create({ data: { listingId: item.id, buyerId: buyer.id, sellerId: seller.id, round: 1, amount: 80, from: 'BUYER', expiresAt: new Date(Date.now() + 3600_000) } });
    await admin.block(adminUser.auth, item.id, { reason: 'тестовая причина' });
    assert.equal(await statusOf(item.id), 'BLOCKED');
    assert.equal((await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } })).status, 'CANCELLED');
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status, 'CANCELLED');
  });
});

// ---------- deals ----------

describe('deals with a picked size', () => {
  test('a request for a size the seller took off can no longer be accepted', async () => {
    const buyer = await user();
    const seller = await user();
    const item = await listing(seller.id, { sizes: ['S', 'M'], sizeValue: 'S' });
    const forM = await requests.create(buyer.id, { listingIds: [item.id], source: 'BUY', sizes: { [item.id]: 'M' }, deliveryMethod: 'IN_PERSON' });
    await prisma.listing.update({ where: { id: item.id }, data: { sizes: ['S'] } });
    await rejects(requests.accept(seller.id, forM.id), 409);
    assert.equal((await prisma.buyRequest.findUniqueOrThrow({ where: { id: forM.id } })).status, 'PENDING_SELLER');
  });

  test('a size still in stock is accepted and the listing stays on sale for the other sizes', async () => {
    const buyer = await user();
    const seller = await user();
    const item = await listing(seller.id, { sizes: ['S', 'M'], sizeValue: 'S' });
    const forS = await requests.create(buyer.id, { listingIds: [item.id], source: 'BUY', sizes: { [item.id]: 'S' }, deliveryMethod: 'IN_PERSON' });
    const res = (await requests.accept(seller.id, forS.id)) as Any;
    assert.equal(res.status, 'WAITING_HANDOVER');
    assert.equal(await statusOf(item.id), 'PUBLISHED');
  });

  test('an accepted offer for a removed size does not become a deal; for a size in stock it does', async () => {
    const buyer = await user();
    const seller = await user();
    const item = await listing(seller.id, { sizes: ['S', 'M'], sizeValue: 'S' });
    const offer = { listingId: item.id, buyerId: buyer.id, sellerId: seller.id, amount: 80, acceptedBy: seller.id };
    await rejects(prisma.$transaction((tx) => requests.createFromOffer(tx, { ...offer, size: 'L' })), 409);
    const deal = await prisma.$transaction((tx) => requests.createFromOffer(tx, { ...offer, size: 'M' }));
    assert.equal(deal.status, 'ACCEPTED');
  });

  test('a one-of-a-kind item is reserved on accept; a negotiable or reserved one cannot be requested', async () => {
    const buyer = await user();
    const seller = await user();
    const item = await listing(seller.id);
    const r = await requests.create(buyer.id, { listingIds: [item.id], source: 'BUY', deliveryMethod: 'IN_PERSON' });
    await requests.accept(seller.id, r.id);
    assert.equal(await statusOf(item.id), 'RESERVED');
    await rejects(requests.create((await user()).id, { listingIds: [item.id], source: 'BUY', deliveryMethod: 'IN_PERSON' }), 409);
    const negotiable = await listing(seller.id, { price: null, priceNegotiable: true });
    await rejects(requests.create(buyer.id, { listingIds: [negotiable.id], source: 'BUY', deliveryMethod: 'IN_PERSON' }), 400);
  });
});

// ---------- disputes ----------

describe('dispute resolution', () => {
  async function disputed(opts: { shipped?: boolean } = {}) {
    const buyer = await user();
    const seller = await user();
    const item = await listing(seller.id);
    const r = await requests.create(buyer.id, { listingIds: [item.id], source: 'BUY', deliveryMethod: 'IN_PERSON' });
    await requests.accept(seller.id, r.id);
    if (opts.shipped) await requests.handedOver(seller.id, r.id);
    await requests.dispute(buyer.id, r.id, 'Вещь не соответствует описанию');
    return { buyer, seller, item, r };
  }
  const adminP = () => user({ role: 'ADMIN' });

  test('complete: the deal is done once, the item sold; a repeat changes nothing', async () => {
    const a = await adminP();
    const { r, item, buyer, seller } = await disputed({ shipped: true });
    await disputes.resolve(a.id, r.id, 'complete', 'Покупатель получил вещь');
    const deal = await prisma.buyRequest.findUniqueOrThrow({ where: { id: r.id }, include: { events: true } });
    assert.equal(deal.status, 'COMPLETED');
    assert.equal(await statusOf(item.id), 'SOLD');
    const events = deal.events.length;
    await rejects(disputes.resolve(a.id, r.id, 'complete', 'ещё раз'), 409);
    await rejects(disputes.resolve(a.id, r.id, 'cancel', 'передумали'), 409);
    assert.equal(await prisma.buyRequestEvent.count({ where: { requestId: r.id } }), events);
    assert.equal(await prisma.moderationAction.count({ where: { targetId: r.id } }), 1);
    const told = sent.find((s) => s.type === 'dispute_resolved');
    assert.deepEqual([...(told!.to as string[])].sort(), [buyer.id, seller.id].sort());
  });

  test('cancel before handover: the item goes back on sale', async () => {
    const a = await adminP();
    const { r, item } = await disputed();
    const res = await disputes.resolve(a.id, r.id, 'cancel', 'Продавец не передал вещь');
    assert.equal((await prisma.buyRequest.findUniqueOrThrow({ where: { id: r.id } })).status, 'CANCELLED');
    assert.equal(await statusOf(item.id), 'PUBLISHED');
    assert.deepEqual(res.released, [item.id]);
  });

  test('cancel after handover: the item is with the buyer, so it is hidden, not put on sale', async () => {
    const a = await adminP();
    const { r, item } = await disputed({ shipped: true });
    await disputes.resolve(a.id, r.id, 'cancel', 'Возврат вещи продавцу');
    assert.equal(await statusOf(item.id), 'HIDDEN');
  });

  test('cancel never frees an item another live deal holds', async () => {
    const a = await adminP();
    const { r, item, seller } = await disputed();
    const other = await prisma.buyRequest.create({
      data: { buyerId: (await user()).id, sellerId: seller.id, priceTotal: 100, deliveryMethod: 'IN_PERSON', status: 'WAITING_HANDOVER', items: { create: [{ listingId: item.id, price: 100 }] } },
    });
    await disputes.resolve(a.id, r.id, 'cancel', 'Отмена');
    assert.equal(await statusOf(item.id), 'RESERVED');
    assert.ok(other.id);
  });

  test('keep: nothing changes but the note is in the history and the log', async () => {
    const a = await adminP();
    const { r, item } = await disputed();
    await disputes.resolve(a.id, r.id, 'keep', 'Ждём фото от покупателя');
    assert.equal((await prisma.buyRequest.findUniqueOrThrow({ where: { id: r.id } })).status, 'DISPUTED');
    assert.equal(await statusOf(item.id), 'RESERVED');
    assert.equal(await prisma.buyRequestEvent.count({ where: { requestId: r.id, reason: { contains: 'Ждём фото' } } }), 1);
    assert.equal(await prisma.moderationAction.count({ where: { targetId: r.id, action: 'dispute_keep' } }), 1);
    const list = await disputes.list('open');
    const row = list.items.find((x) => x.id === r.id)!;
    assert.equal(row.dispute?.by, 'buyer');
    assert.equal(row.decisions[0].action, 'keep');
  });
});

// ---------- what buyers see ----------

describe('unavailable items are not offered as available', () => {
  test('cart preview, favorites and swipe skip drafts and blocked items', async () => {
    const buyer = await user();
    const seller = await user();
    const ok = await listing(seller.id);
    const draft = await listing(seller.id, { status: 'DRAFT' });
    const blocked = await listing(seller.id, { status: 'BLOCKED' });
    const hidden = await listing(seller.id, { status: 'HIDDEN' });
    const preview = await cart.preview({ items: [ok, draft, blocked].map((l) => ({ listingId: l.id })) });
    const inCart = preview.groups.flatMap((g) => g.items.map((i) => i.id));
    assert.deepEqual(inCart, [ok.id]);
    await prisma.favorite.createMany({ data: [ok, blocked].map((l) => ({ userId: buyer.id, listingId: l.id })) });
    const favs = await favorites.list(buyer.auth, 'recent');
    assert.deepEqual(favs.items.map((i) => i.id), [ok.id]);
    await rejects(swipe.swipe(buyer.auth, { listingId: hidden.id, direction: 'right', context: 'swipe_mode' }), 404);
    await rejects(swipe.swipe(buyer.auth, { listingId: randomUUID(), direction: 'right', context: 'swipe_mode' }), 404);
    assert.equal(await prisma.favorite.count({ where: { userId: buyer.id, listingId: hidden.id } }), 0);
  });
});
