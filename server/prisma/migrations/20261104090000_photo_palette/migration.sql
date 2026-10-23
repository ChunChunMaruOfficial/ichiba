-- Colour signature of a photo, for search by photo (computed at upload, lazily for older photos).
ALTER TABLE "Photo" ADD COLUMN "palette" TEXT;
