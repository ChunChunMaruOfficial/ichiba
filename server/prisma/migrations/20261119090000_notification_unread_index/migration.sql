-- The unread count (/auth/me on every page and its 30-second poll, the notifications badge) reads one user's rows
-- WHERE "readAt" IS NULL: with only (userId, createdAt) Postgres walked all of a user's notifications to count them.
-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
