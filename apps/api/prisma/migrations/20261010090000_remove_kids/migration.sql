-- Children's section removed: existing values fall back to "fits anyone" and a free-form size.
UPDATE "Listing" SET "gender" = NULL WHERE "gender" = 'KIDS';
UPDATE "Listing" SET "sizeSystem" = 'OTHER' WHERE "sizeSystem" = 'KIDS';

-- AlterEnum
BEGIN;
CREATE TYPE "Gender_new" AS ENUM ('MALE', 'FEMALE', 'UNISEX');
ALTER TABLE "Listing" ALTER COLUMN "gender" TYPE "Gender_new" USING ("gender"::text::"Gender_new");
ALTER TYPE "Gender" RENAME TO "Gender_old";
ALTER TYPE "Gender_new" RENAME TO "Gender";
DROP TYPE "public"."Gender_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "SizeSystem_new" AS ENUM ('ALPHA', 'SHOE_EU', 'JEANS_W', 'OTHER');
ALTER TABLE "Listing" ALTER COLUMN "sizeSystem" TYPE "SizeSystem_new" USING ("sizeSystem"::text::"SizeSystem_new");
ALTER TYPE "SizeSystem" RENAME TO "SizeSystem_old";
ALTER TYPE "SizeSystem_new" RENAME TO "SizeSystem";
DROP TYPE "public"."SizeSystem_old";
COMMIT;

