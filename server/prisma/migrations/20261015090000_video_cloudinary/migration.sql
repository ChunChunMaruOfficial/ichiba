-- Videos can live on Cloudinary (uploaded straight from the browser), like photos.
ALTER TABLE "Video" ADD COLUMN "provider" "PhotoProvider" NOT NULL DEFAULT 'LOCAL';
