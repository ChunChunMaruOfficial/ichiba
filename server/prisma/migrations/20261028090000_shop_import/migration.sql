-- CreateTable
CREATE TABLE "ShopSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopProduct" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "listingId" TEXT,
    "fingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSource_key_key" ON "ShopSource"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ShopProduct_sourceId_productId_key" ON "ShopProduct"("sourceId", "productId");

-- AddForeignKey
ALTER TABLE "ShopSource" ADD CONSTRAINT "ShopSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopProduct" ADD CONSTRAINT "ShopProduct_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ShopSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same rule as every other table (see 20261012091000_supabase_rls): closed to Supabase's REST roles.
ALTER TABLE "ShopSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopProduct" ENABLE ROW LEVEL SECURITY;
