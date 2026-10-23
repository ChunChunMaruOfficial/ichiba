-- A seller or brand binds one confirmed address for notification emails (a buy request, an offer…).
ALTER TYPE "CodePurpose" ADD VALUE 'NOTIFY';
ALTER TABLE "User" ADD COLUMN "notifyEmail" TEXT;
