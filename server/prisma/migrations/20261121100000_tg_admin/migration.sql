-- The admin bot in Telegram: its password-unlocked session, failed attempts and journal notification settings.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "tgAdmin" JSONB;
