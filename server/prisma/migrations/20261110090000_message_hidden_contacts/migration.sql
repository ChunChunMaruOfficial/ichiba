-- Kinds of contacts removed from a chat message before a deal (phone, email, link, handle). The contacts themselves are
-- not stored; the count of such messages per sender drives the warnings and the report to moderators.
-- AlterTable
ALTER TABLE "Message" ADD COLUMN "hiddenContacts" TEXT[] DEFAULT ARRAY[]::TEXT[];
