-- An admin can hide every listing of an account (not delete), and bring them back.
ALTER TABLE "User" ADD COLUMN "listingsHiddenAt" TIMESTAMP(3);
ALTER TABLE "Listing" ADD COLUMN "hiddenByAdmin" BOOLEAN NOT NULL DEFAULT false;
