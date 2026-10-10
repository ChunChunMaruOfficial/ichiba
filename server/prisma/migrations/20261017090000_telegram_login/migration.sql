-- Sign-in with Telegram (Login Widget): the Telegram user id.
ALTER TABLE "User" ADD COLUMN "telegramId" TEXT;

CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
