-- Rules of the main catalogue, all additive: new nullable or defaulted columns, no row deleted, no section changed.

-- Seller status and catalogue admission are separate facts about an account.
ALTER TABLE "User" ADD COLUMN "catalogApprovedAt" TIMESTAMP(3);

-- An admin's choice of section for one item survives later changes of the seller's status.
ALTER TABLE "Listing" ADD COLUMN "marketByAdmin" BOOLEAN NOT NULL DEFAULT false;
-- Items an admin already moved by hand (logged as market_brands / market_resale since 20261101090000_listing_market).
UPDATE "Listing" l SET "marketByAdmin" = true
  WHERE EXISTS (SELECT 1 FROM "ModerationAction" m WHERE m."targetType" = 'LISTING' AND m."targetId" = l.id AND m."action" LIKE 'market\_%');

-- Hidden because the seller was blocked (restored on unblock). Earlier blocks weren't marked, so nothing is set here.
ALTER TABLE "Listing" ADD COLUMN "hiddenByBlock" BOOLEAN NOT NULL DEFAULT false;

-- «Новое с биркой» becomes «Новое» with a separate «бирка есть / нет» switch. Every item listed so far as new was
-- listed «с биркой», so they keep exactly that.
ALTER TABLE "Listing" ADD COLUMN "hasTags" BOOLEAN;
UPDATE "Listing" SET "hasTags" = true WHERE "condition" = 'NEW_WITH_TAGS';

-- Catalogue admission requests reuse the brand application flow.
ALTER TABLE "BrandApplication" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'BRAND';
