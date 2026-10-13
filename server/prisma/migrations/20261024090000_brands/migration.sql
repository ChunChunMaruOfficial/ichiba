-- «Бренд» status: sellers apply from Settings, an admin reviews.
ALTER TABLE "User" ADD COLUMN "brandVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "brandName" TEXT;

CREATE TABLE "BrandApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "legalForm" TEXT NOT NULL,
    "legalName" TEXT,
    "unp" TEXT,
    "contactName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "telegram" TEXT,
    "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BrandApplication_status_createdAt_idx" ON "BrandApplication"("status", "createdAt");
CREATE INDEX "BrandApplication_userId_idx" ON "BrandApplication"("userId");
ALTER TABLE "BrandApplication" ADD CONSTRAINT "BrandApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same rule as every other table (see 20261012091000_supabase_rls): closed to Supabase's REST roles.
ALTER TABLE "BrandApplication" ENABLE ROW LEVEL SECURITY;

-- MIRARWEAR is a brand from the start.
UPDATE "User" SET "brandVerifiedAt" = CURRENT_TIMESTAMP, "brandName" = 'MIRARWEAR' WHERE "username" = 'mirarwearfck';
