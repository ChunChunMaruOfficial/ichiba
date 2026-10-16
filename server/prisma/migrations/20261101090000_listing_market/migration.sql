-- The section a listing is shown in becomes the listing's own field instead of being read off its seller.
-- Additive and reversible: nothing is deleted, every existing item keeps the section it is shown in today
-- (a brand's items in the catalogue, everyone else's on «Вторичка»).
CREATE TYPE "ListingMarket" AS ENUM ('CATALOG', 'RESALE');
ALTER TABLE "Listing" ADD COLUMN "market" "ListingMarket" NOT NULL DEFAULT 'RESALE';

UPDATE "Listing" l SET "market" = 'CATALOG'
  FROM "User" u
  WHERE u.id = l."sellerId" AND u."brandVerifiedAt" IS NOT NULL;

CREATE INDEX "Listing_market_status_liftedAt_idx" ON "Listing"("market", "status", "liftedAt");
