-- «Пошив по меркам»: a brand marks a model it sews to measure; a buyer's order carries their body measurements.
ALTER TABLE "Listing" ADD COLUMN "madeToMeasure" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Listing" ADD COLUMN "madeToMeasureDays" INTEGER;
ALTER TABLE "BuyRequestItem" ADD COLUMN "bodyMeasurements" JSONB;
