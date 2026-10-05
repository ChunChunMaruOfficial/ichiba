-- CreateIndex
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationCode_target_createdAt_idx" ON "VerificationCode"("target", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationCode_createdAt_idx" ON "VerificationCode"("createdAt");

