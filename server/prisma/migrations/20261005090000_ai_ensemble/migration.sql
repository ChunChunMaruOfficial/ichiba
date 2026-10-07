
-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_reporterId_fkey";

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "moderation" JSONB;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "risk" JSONB;

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "quality" JSONB;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "details" JSONB,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'user',
ALTER COLUMN "reporterId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "calls" JSONB NOT NULL,
    "votes" JSONB,
    "result" JSONB,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiRun_feature_createdAt_idx" ON "AiRun"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_subjectType_subjectId_idx" ON "AiRun"("subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

