-- Chat: location messages (a shared point on the map).
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'LOCATION');

ALTER TABLE "Message" ADD COLUMN "kind" "MessageKind" NOT NULL DEFAULT 'TEXT',
ADD COLUMN "lat" DOUBLE PRECISION,
ADD COLUMN "lng" DOUBLE PRECISION,
ADD COLUMN "accuracy" DOUBLE PRECISION;
