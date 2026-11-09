-- Files the media backup (backup/media-backup.ts) found gone from the server and from the database: kept in the backup
-- for a grace period in case the deletion was a mistake, then erased from it too, so a deleted account's photos leave
-- every copy within the 15 days the privacy policy promises.
-- CreateTable
CREATE TABLE "MediaBackupErasure" (
    "key" TEXT NOT NULL,
    "missingSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaBackupErasure_pkey" PRIMARY KEY ("key")
);
