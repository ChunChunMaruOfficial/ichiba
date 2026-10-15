-- The owner wants these back on «Вторичка» (2026-10-15): the three items hidden by 20261026090000_resale_cleanup
-- (the Gap shirt and Colin's sweater by @dudareok, @yan's T-shirt) are published again.
UPDATE "Listing" SET "status" = 'PUBLISHED', "hiddenByAdmin" = false
  WHERE id IN ('2a931579-9604-4964-ad02-aa80a49899eb', 'aa35ccaa-1020-4193-b692-fffa6f201cf9', '27f4fccf-7e72-482d-8fea-2c8a7175c8b3')
    AND "status" = 'HIDDEN' AND "hiddenByAdmin" = true;
