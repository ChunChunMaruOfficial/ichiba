-- Sessions end for real: password resets, blocks and deletions bump the account's session version.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- A password registration lives in its verification code until the address owner confirms it.
ALTER TABLE "VerificationCode" ADD COLUMN "payload" JSONB;

-- Carts are cleared by listing at checkout and dispute resolution; videos are looked up by key.
CREATE INDEX "CartItem_listingId_idx" ON "CartItem"("listingId");
CREATE INDEX "Video_key_idx" ON "Video"("key");

-- A listing has at most one running auction, even when two publishes race.
CREATE UNIQUE INDEX "Auction_one_active_per_listing" ON "Auction"("listingId") WHERE "status" = 'ACTIVE';
CREATE INDEX "Thread_requestId_idx" ON "Thread"("requestId");
CREATE INDEX "CollectionItem_listingId_idx" ON "CollectionItem"("listingId");
CREATE INDEX "Review_listingId_idx" ON "Review"("listingId");
CREATE INDEX "Photo_ownerId_idx" ON "Photo"("ownerId");

-- One pending offer per buyer and listing, even when two taps race (partial: Prisma can't express it, so `migrate dev`
-- reports it as drift; `migrate deploy` is unaffected).
CREATE UNIQUE INDEX "Offer_one_pending_per_buyer" ON "Offer"("listingId", "buyerId") WHERE "status" = 'PENDING';
