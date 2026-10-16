import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type pg from 'pg';
import { resetAndMigrate, TEST_DB_URL, withClient } from './helpers/testdb.js';

/**
 * The two catalogue migrations against rows shaped as production had them: nothing is deleted, every item keeps
 * the section it was shown in, an admin's earlier move is remembered, the rest gets safe defaults.
 */

const ids = { brand: randomUUID(), person: randomUUID(), buyer: randomUUID(), admin: randomUUID(), brandItem: randomUUID(), brandGone: randomUUID(), personItem: randomUUID(), movedItem: randomUUID(), deal: randomUUID() };
let before0: { users: number; listings: number; deals: number; items: number };

const counts = (c: pg.Client) =>
  c.query(`SELECT (SELECT count(*) FROM "User")::int users, (SELECT count(*) FROM "Listing")::int listings, (SELECT count(*) FROM "BuyRequest")::int deals, (SELECT count(*) FROM "BuyRequestItem")::int items`).then((r) => r.rows[0]);

before(async () => {
  await resetAndMigrate({
    before: {
      // As the data stood before the section became the listing's own field.
      '20261101090000_listing_market': async (c) => {
        const user = (id: string, name: string, brand: boolean) =>
          c.query(`INSERT INTO "User" (id, username, "brandVerifiedAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())`, [id, name, brand ? new Date() : null]);
        await user(ids.brand, 'brand1', true);
        await user(ids.person, 'person1', false);
        await user(ids.buyer, 'buyer1', false);
        await user(ids.admin, 'admin1', false);
        const listing = (id: string, seller: string, status: string, condition: string) =>
          c.query(`INSERT INTO "Listing" (id, "sellerId", status, title, condition, price, "updatedAt") VALUES ($1, $2, $3::"ListingStatus", 't', $4::"Condition", 100, now())`, [id, seller, status, condition]);
        await listing(ids.brandItem, ids.brand, 'PUBLISHED', 'NEW_WITH_TAGS');
        await listing(ids.brandGone, ids.brand, 'DELETED', 'GOOD');
        await listing(ids.personItem, ids.person, 'PUBLISHED', 'GOOD');
        await listing(ids.movedItem, ids.person, 'PUBLISHED', 'NEW_WITH_TAGS');
        await c.query(`INSERT INTO "BuyRequest" (id, "buyerId", "sellerId", "priceTotal", "deliveryMethod", status, "updatedAt") VALUES ($1, $2, $3, 100, 'IN_PERSON', 'COMPLETED', now())`, [ids.deal, ids.buyer, ids.person]);
        await c.query(`INSERT INTO "BuyRequestItem" ("requestId", "listingId", price) VALUES ($1, $2, 100)`, [ids.deal, ids.personItem]);
        before0 = await counts(c);
      },
      // Between the two: an admin moved one private seller's item into the catalogue (the first version's tool).
      '20261102090000_catalog_rules': async (c) => {
        await c.query(`UPDATE "Listing" SET market = 'CATALOG' WHERE id = $1`, [ids.movedItem]);
        await c.query(`INSERT INTO "ModerationAction" (id, "moderatorId", "targetType", "targetId", action) VALUES ($1, $2, 'LISTING', $3, 'market_brands')`, [randomUUID(), ids.admin, ids.movedItem]);
      },
    },
  });
});

test('no user, listing or deal is lost', async () => {
  const now = await withClient(counts);
  assert.deepEqual(now, before0);
});

test('every listing keeps the section it was shown in', async () => {
  const rows = await withClient((c) => c.query(`SELECT id, market::text, "marketByAdmin", "hiddenByBlock", status::text FROM "Listing"`).then((r) => r.rows));
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by[ids.brandItem].market, 'CATALOG');
  assert.equal(by[ids.brandGone].market, 'CATALOG');
  assert.equal(by[ids.brandGone].status, 'DELETED');
  assert.equal(by[ids.personItem].market, 'RESALE');
  // The admin's move is remembered as the admin's choice; nothing else is.
  assert.equal(by[ids.movedItem].market, 'CATALOG');
  assert.equal(by[ids.movedItem].marketByAdmin, true);
  assert.deepEqual(rows.filter((r) => r.marketByAdmin).map((r) => r.id), [ids.movedItem]);
  assert.ok(rows.every((r) => r.hiddenByBlock === false));
  // Items listed «Новое с биркой» before keep their tags; worn ones have no answer.
  const tags = await withClient((c) => c.query(`SELECT id, "hasTags" FROM "Listing"`).then((r) => Object.fromEntries(r.rows.map((x) => [x.id, x.hasTags]))));
  assert.equal(tags[ids.brandItem], true);
  assert.equal(tags[ids.personItem], null);
});

test('statuses get safe defaults: nobody is admitted to the catalogue by the migration', async () => {
  const users = await withClient((c) => c.query(`SELECT username, "catalogApprovedAt", "brandVerifiedAt" FROM "User"`).then((r) => r.rows));
  assert.ok(users.every((u) => u.catalogApprovedAt === null));
  assert.ok(users.find((u) => u.username === 'brand1').brandVerifiedAt);
});

test('the migrations give exactly the schema in schema.prisma', async () => {
  const out = execFileSync('npx', ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script'], {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, DIRECT_URL: TEST_DB_URL },
    encoding: 'utf8',
    shell: true,
  });
  // The test marker table is ours, not the app's; anything else would be a gap between migrations and schema.
  const statements = out.split('\n').filter((l) => l.trim() && !l.startsWith('--') && !l.includes('_ichiba_test_marker'));
  assert.deepEqual(statements, []);
});

after(async () => {
  await resetAndMigrate();
});
