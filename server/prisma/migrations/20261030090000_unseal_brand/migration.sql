-- The «бренд» seal is off for now: taken off every item. Brands can still put it back on an item themselves.
UPDATE "Listing" SET "labels" = array_remove("labels", 'brand') WHERE 'brand' = ANY("labels");
