-- Chat: replies, edits, deletion (for me / for both), pins (for me / for both), reactions, photo and video messages.
ALTER TYPE "MessageKind" ADD VALUE 'MEDIA';

ALTER TABLE "Message" ADD COLUMN "replyToId" TEXT,
ADD COLUMN "editedAt" TIMESTAMP(3),
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "hiddenFor" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Photo" ADD COLUMN "messageId" TEXT;
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Photo_messageId_idx" ON "Photo"("messageId");

ALTER TABLE "Video" ADD COLUMN "messageId" TEXT;
ALTER TABLE "Video" ADD CONSTRAINT "Video_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Video_messageId_idx" ON "Video"("messageId");

CREATE TABLE "MessageReaction" (
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("messageId","userId")
);
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MessagePin" (
    "messageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "forAll" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessagePin_pkey" PRIMARY KEY ("messageId","userId")
);
CREATE INDEX "MessagePin_threadId_idx" ON "MessagePin"("threadId");
ALTER TABLE "MessagePin" ADD CONSTRAINT "MessagePin_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same rule as every other table (see 20261012091000_supabase_rls): closed to Supabase's REST roles.
ALTER TABLE "MessageReaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessagePin" ENABLE ROW LEVEL SECURITY;
