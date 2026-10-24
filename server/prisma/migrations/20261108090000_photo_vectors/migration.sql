-- Image embeddings of listing photos for search by photo (one per photo file and model).
CREATE TABLE "PhotoVector" (
    "key" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vec" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoVector_pkey" PRIMARY KEY ("key","model")
);

CREATE INDEX "PhotoVector_model_createdAt_idx" ON "PhotoVector"("model", "createdAt");

-- Same rule as every other table (see 20261012091000_supabase_rls): closed to Supabase's REST roles.
ALTER TABLE "PhotoVector" ENABLE ROW LEVEL SECURITY;
