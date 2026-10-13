-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "priceNegotiable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TgSource" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgPost" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "postId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "listingIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TgSource_channel_key" ON "TgSource"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "TgPost_sourceId_postId_key" ON "TgPost"("sourceId", "postId");

-- AddForeignKey
ALTER TABLE "TgSource" ADD CONSTRAINT "TgSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgPost" ADD CONSTRAINT "TgPost_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "TgSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same rule as every other table (see 20261012091000_supabase_rls): closed to Supabase's REST roles.
ALTER TABLE "TgSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TgPost" ENABLE ROW LEVEL SECURITY;
