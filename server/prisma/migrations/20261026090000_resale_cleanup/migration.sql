-- One-off cleanup asked for by the owner (2026-10-14).
-- Deleted outright, with their chats, deals, offers, photos and notifications:
--   ff2e5659-… «Синие прямые джинсы» (@serafim), 539dad26-… «Чёрная сумка-шоппер» (@bodrowa2007).
-- Hidden by the admin (reversible from Admin → user): the Gap shirt and Colin's sweater (@dudareok), @yan's T-shirt.

CREATE TEMP TABLE _gone (id TEXT PRIMARY KEY);
INSERT INTO _gone VALUES ('ff2e5659-2f06-4089-84d6-7ca8de798c00'), ('539dad26-977c-4f79-aeff-49c709cda3d5');

CREATE TEMP TABLE _gone_requests AS
  SELECT DISTINCT "requestId" AS id FROM "BuyRequestItem" WHERE "listingId" IN (SELECT id FROM _gone);

DELETE FROM "Notification" n
  WHERE EXISTS (SELECT 1 FROM _gone g WHERE n."payload"::text LIKE '%' || g.id || '%')
     OR EXISTS (SELECT 1 FROM _gone_requests r WHERE n."payload"::text LIKE '%' || r.id || '%');
-- Chats about these items (their messages, reactions and pins go with them).
DELETE FROM "Thread" WHERE "listingId" IN (SELECT id FROM _gone) OR "requestId" IN (SELECT id FROM _gone_requests);
UPDATE "Offer" SET "requestId" = NULL WHERE "requestId" IN (SELECT id FROM _gone_requests);
UPDATE "Auction" SET "requestId" = NULL WHERE "requestId" IN (SELECT id FROM _gone_requests);
DELETE FROM "BuyRequestItem" WHERE "listingId" IN (SELECT id FROM _gone);
-- The deals themselves, when nothing else is left in them (items, events and reviews cascade).
DELETE FROM "BuyRequest" b WHERE b.id IN (SELECT id FROM _gone_requests)
  AND NOT EXISTS (SELECT 1 FROM "BuyRequestItem" i WHERE i."requestId" = b.id);
-- Photos and videos would otherwise only lose their link.
DELETE FROM "Photo" WHERE "listingId" IN (SELECT id FROM _gone);
DELETE FROM "Video" WHERE "listingId" IN (SELECT id FROM _gone);
DELETE FROM "Review" WHERE "listingId" IN (SELECT id FROM _gone);
DELETE FROM "Listing" WHERE id IN (SELECT id FROM _gone);

UPDATE "Listing" SET "status" = 'HIDDEN', "hiddenByAdmin" = true
  WHERE id IN ('2a931579-9604-4964-ad02-aa80a49899eb', 'aa35ccaa-1020-4193-b692-fffa6f201cf9', '27f4fccf-7e72-482d-8fea-2c8a7175c8b3')
    AND "status" = 'PUBLISHED';

DROP TABLE _gone_requests;
DROP TABLE _gone;
