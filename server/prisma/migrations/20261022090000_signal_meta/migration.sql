-- Searches and filters become recommendation signals: the traits looked for are kept with the signal.
ALTER TABLE "Signal" ADD COLUMN "meta" JSONB;

-- Popularity reads recent signals per listing.
CREATE INDEX "Signal_listingId_createdAt_idx" ON "Signal"("listingId", "createdAt");
