-- Test listings removed at the owner's request: «Серые джинсы» (666 BYN), «Фиолетовые тапочки с логотипом…»
-- (25 BYN, sold) and «Зелёная шапка» (200 BYN, reserved). Soft delete, like «Удалить» in the app; an open deal on
-- them is cancelled, pending offers are void and cart rows go.
CREATE TEMP TABLE gone AS
SELECT id FROM "Listing"
WHERE "status" <> 'DELETED'
  AND (("title" = 'Серые джинсы' AND "price" = 666)
    OR ("title" LIKE 'Фиолетовые тапочки с логотип%' AND "price" = 25)
    OR ("title" = 'Зелёная шапка' AND "price" = 200));

UPDATE "BuyRequest" r SET "status" = 'CANCELLED', "reason" = 'Объявление удалено', "expiresAt" = NULL
WHERE r."status" NOT IN ('COMPLETED', 'CANCELLED', 'DECLINED')
  AND EXISTS (SELECT 1 FROM "BuyRequestItem" i WHERE i."requestId" = r."id" AND i."listingId" IN (SELECT id FROM gone));

UPDATE "Offer" SET "status" = 'CANCELLED' WHERE "status" = 'PENDING' AND "listingId" IN (SELECT id FROM gone);
DELETE FROM "CartItem" WHERE "listingId" IN (SELECT id FROM gone);
UPDATE "Listing" SET "status" = 'DELETED' WHERE id IN (SELECT id FROM gone);

DROP TABLE gone;
