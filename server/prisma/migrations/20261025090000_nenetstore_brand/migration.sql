-- ne net store sells new items made to order (nobody has worn them): it stands with the brands, not on «Вторичка».
UPDATE "User" SET "brandVerifiedAt" = CURRENT_TIMESTAMP, "brandName" = 'ne net store' WHERE "username" = 'nenetstore' AND "brandVerifiedAt" IS NULL;
