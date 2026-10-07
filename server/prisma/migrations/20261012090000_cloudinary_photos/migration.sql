-- Listing photos can live in Cloudinary (uploaded straight from the browser).
CREATE TYPE "PhotoProvider" AS ENUM ('LOCAL', 'CLOUDINARY');

ALTER TABLE "Photo" ADD COLUMN "provider" "PhotoProvider" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN "url" TEXT,
ADD COLUMN "version" INTEGER,
ADD COLUMN "format" TEXT,
ADD COLUMN "bytes" INTEGER;

CREATE INDEX "Photo_key_idx" ON "Photo"("key");
