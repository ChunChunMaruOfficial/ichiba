-- How often an item was shown to a person in a feed: scrolled past many times without a click, it gives way in «Для вас».
-- CreateTable
CREATE TABLE "FeedImpression" (
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedImpression_pkey" PRIMARY KEY ("userId","listingId")
);

-- CreateIndex
CREATE INDEX "FeedImpression_lastAt_idx" ON "FeedImpression"("lastAt");

-- AddForeignKey
ALTER TABLE "FeedImpression" ADD CONSTRAINT "FeedImpression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedImpression" ADD CONSTRAINT "FeedImpression_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same rule as every other table (see 20261012091000_supabase_rls): closed to Supabase's REST roles.
ALTER TABLE "FeedImpression" ENABLE ROW LEVEL SECURITY;
