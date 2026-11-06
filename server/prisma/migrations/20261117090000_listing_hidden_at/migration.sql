-- When the seller took the item off sale: brought back after a day, it is lifted in the feed and everyone who saved
-- it hears «снова в продаже» (listings.service publish).
ALTER TABLE "Listing" ADD COLUMN "hiddenAt" TIMESTAMP(3);
