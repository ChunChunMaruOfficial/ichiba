-- "Самовывоз" is no longer offered: listings that had it are handed over in person instead.
-- The enum value stays for deals made with it earlier.
UPDATE "Listing"
SET "deliveryOptions" = ARRAY(
  SELECT DISTINCT m FROM unnest(array_replace("deliveryOptions", 'PICKUP'::"DeliveryMethod", 'IN_PERSON'::"DeliveryMethod")) AS m ORDER BY m
)
WHERE 'PICKUP'::"DeliveryMethod" = ANY("deliveryOptions");
