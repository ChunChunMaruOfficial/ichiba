-- «Несколько размеров» is one listing with every size in stock, instead of a copy per size.
ALTER TABLE "Listing" ADD COLUMN "sizes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "BuyRequestItem" ADD COLUMN "size" TEXT;
ALTER TABLE "Offer" ADD COLUMN "size" TEXT;
ALTER TABLE "CartItem" ADD COLUMN "size" TEXT;

-- Fold existing size copies into the group's first listing: its sizes become the sizes of every member still on
-- sale (in the order they were listed); those other members are removed. Members in a deal or sold stay as they are.
WITH live AS (
  SELECT l."groupId" AS gid, array_agg(l."sizeValue" ORDER BY l."createdAt") AS sizes
  FROM "Listing" l
  JOIN "Listing" base ON base."id" = l."groupId" AND base."status" IN ('PUBLISHED', 'HIDDEN')
  WHERE l."groupId" IS NOT NULL AND l."status" IN ('PUBLISHED', 'HIDDEN') AND l."sizeValue" IS NOT NULL
  GROUP BY l."groupId"
  HAVING count(*) > 1
)
UPDATE "Listing" b SET "sizes" = live.sizes, "sizeValue" = live.sizes[1], "extraSizes" = ARRAY[]::TEXT[]
FROM live WHERE b."id" = live.gid;

UPDATE "Listing" c SET "status" = 'DELETED'
FROM "Listing" b
WHERE c."groupId" = b."id" AND c."id" <> b."id" AND cardinality(b."sizes") > 1 AND c."status" IN ('PUBLISHED', 'HIDDEN');

UPDATE "Offer" o SET "status" = 'CANCELLED'
FROM "Listing" c WHERE o."listingId" = c."id" AND c."status" = 'DELETED' AND o."status" = 'PENDING';

DELETE FROM "CartItem" ci USING "Listing" c WHERE ci."listingId" = c."id" AND c."status" = 'DELETED';
