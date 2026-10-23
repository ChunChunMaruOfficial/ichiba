-- Notifications in Telegram: the chat an account linked through the bot, which groups it wants, and the one-time
-- /start token of «Подключить Telegram» (only its hash).
ALTER TABLE "User" ADD COLUMN "tgChatId" TEXT,
ADD COLUMN "tgUsername" TEXT,
ADD COLUMN "tgLinkedAt" TIMESTAMP(3),
ADD COLUMN "tgPrefs" JSONB,
ADD COLUMN "tgLinkTokenHash" TEXT,
ADD COLUMN "tgLinkTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_tgLinkTokenHash_key" ON "User"("tgLinkTokenHash");
CREATE INDEX "User_tgChatId_idx" ON "User"("tgChatId");
