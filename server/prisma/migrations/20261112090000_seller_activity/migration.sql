-- The admin «Журнал»: every seller action, brands and «Вторичка» alike.
CREATE TABLE "SellerActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "listingId" TEXT,
    "market" "ListingMarket",
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SellerActivity_at_idx" ON "SellerActivity"("at");
CREATE INDEX "SellerActivity_userId_at_idx" ON "SellerActivity"("userId", "at");
CREATE INDEX "SellerActivity_market_at_idx" ON "SellerActivity"("market", "at");
CREATE INDEX "SellerActivity_action_at_idx" ON "SellerActivity"("action", "at");

-- The past, from what the database already keeps: items listed, published and sold, the sellers' steps in deals,
-- their counter-offers and brand applications. Edits, price changes, hiding and deleting left no trace before.
INSERT INTO "SellerActivity" ("id", "userId", "action", "listingId", "market", "detail", "at")
SELECT gen_random_uuid()::text, l."sellerId", 'listing_created', l."id", l."market", NULL, l."createdAt" FROM "Listing" l;

INSERT INTO "SellerActivity" ("id", "userId", "action", "listingId", "market", "detail", "at")
SELECT gen_random_uuid()::text, l."sellerId", 'listing_published', l."id", l."market", NULL, l."publishedAt" FROM "Listing" l WHERE l."publishedAt" IS NOT NULL;

INSERT INTO "SellerActivity" ("id", "userId", "action", "listingId", "market", "detail", "at")
SELECT gen_random_uuid()::text, l."sellerId", 'listing_sold', l."id", l."market", NULL, l."soldAt" FROM "Listing" l WHERE l."soldAt" IS NOT NULL;

INSERT INTO "SellerActivity" ("id", "userId", "action", "listingId", "market", "detail", "at")
SELECT gen_random_uuid()::text, r."sellerId", 'deal_' || lower(e."status"::text), i."listingId", l."market", e."reason", e."at"
FROM "BuyRequestEvent" e
JOIN "BuyRequest" r ON r."id" = e."requestId"
LEFT JOIN LATERAL (SELECT "listingId" FROM "BuyRequestItem" WHERE "requestId" = r."id" LIMIT 1) i ON TRUE
LEFT JOIN "Listing" l ON l."id" = i."listingId"
WHERE e."byUserId" = r."sellerId";

INSERT INTO "SellerActivity" ("id", "userId", "action", "listingId", "market", "detail", "at")
SELECT gen_random_uuid()::text, o."sellerId", 'offer_countered', o."listingId", l."market", o."amount"::text || ' BYN', o."createdAt"
FROM "Offer" o JOIN "Listing" l ON l."id" = o."listingId" WHERE o."from" = 'SELLER';

INSERT INTO "SellerActivity" ("id", "userId", "action", "listingId", "market", "detail", "at")
SELECT gen_random_uuid()::text, b."userId", 'brand_applied', NULL, NULL, b."brandName", b."createdAt" FROM "BrandApplication" b;
