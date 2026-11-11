-- The Telegram link remembers the account's sessionVersion at the moment it was made: a password reset, a block or
-- «выйти везде» moves sessionVersion on, and the bot stops acting for (and writing to) that chat until it is linked
-- again. Chats linked before this column existed keep working: they are stamped with the current version.
ALTER TABLE "User" ADD COLUMN "tgSessionVersion" INTEGER;
UPDATE "User" SET "tgSessionVersion" = "sessionVersion" WHERE "tgChatId" IS NOT NULL;
