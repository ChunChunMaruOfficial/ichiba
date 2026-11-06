-- Device keys: one tap back into an account this browser signed out of (POST /auth/device-login). The key itself
-- lives in the browser's localStorage; only its SHA-256 is kept here. A key dies with the account's sessionVersion
-- (password reset, block) and after its expiry.
CREATE TABLE "DeviceKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceKey_keyHash_key" ON "DeviceKey"("keyHash");
CREATE INDEX "DeviceKey_userId_idx" ON "DeviceKey"("userId");

ALTER TABLE "DeviceKey" ADD CONSTRAINT "DeviceKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
