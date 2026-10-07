-- AlterEnum
ALTER TYPE "Gender" ADD VALUE 'KIDS';

-- AlterEnum
ALTER TYPE "SizeSystem" ADD VALUE 'KIDS';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "autoAcceptPrice" INTEGER,
ADD COLUMN     "extraSizes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "likersOfferAt" TIMESTAMP(3),
ADD COLUMN     "originalPrice" INTEGER,
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "listingId" TEXT,
    "key" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Video_listingId_key" ON "Video"("listingId");

-- CreateIndex
CREATE INDEX "Video_ownerId_idx" ON "Video"("ownerId");

-- CreateIndex
CREATE INDEX "Listing_groupId_idx" ON "Listing"("groupId");

-- CreateIndex
CREATE INDEX "Listing_status_scheduledAt_idx" ON "Listing"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

