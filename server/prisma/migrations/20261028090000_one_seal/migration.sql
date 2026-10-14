-- One seal per item: two in a row took too much of the photo. Items with two keep the first.
UPDATE "Listing" SET "labels" = "labels"[1:1] WHERE cardinality("labels") > 1;
