-- Seals a brand chooses for each item (бренд, новинка, хит, оригинал), instead of «бренд» on every brand item.
ALTER TABLE "Listing" ADD COLUMN "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A varied start for the brands' items already on sale (asked for by the owner): about one in five gets «бренд»,
-- some «новинка» or «хит», a few «оригинал» or two seals at once, the rest none.
UPDATE "Listing" l SET "labels" = CASE
    WHEN r < 0.20 THEN ARRAY['brand']
    WHEN r < 0.32 THEN ARRAY['new']
    WHEN r < 0.44 THEN ARRAY['hit']
    WHEN r < 0.50 THEN ARRAY['original']
    WHEN r < 0.55 THEN ARRAY['brand', 'new']
    WHEN r < 0.59 THEN ARRAY['hit', 'original']
    ELSE ARRAY[]::TEXT[]
  END
FROM (SELECT l2.id, random() AS r FROM "Listing" l2 JOIN "User" u ON u.id = l2."sellerId" WHERE u."brandVerifiedAt" IS NOT NULL) x
WHERE l.id = x.id;
