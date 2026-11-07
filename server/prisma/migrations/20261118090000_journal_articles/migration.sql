-- Readers' journal articles: written by any signed-in user, the topic checked by AI, then read and published by an
-- admin (journal/journal.ts). The editorial articles stay MDX files in the client.
-- CreateEnum
CREATE TYPE "JournalArticleStatus" AS ENUM ('DRAFT', 'AI_REJECTED', 'PENDING', 'REJECTED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "JournalArticle" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "rubric" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "coverId" TEXT,
    "status" "JournalArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "aiVerdict" JSONB,
    "rejectReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JournalArticle_slug_key" ON "JournalArticle"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "JournalArticle_coverId_key" ON "JournalArticle"("coverId");

-- CreateIndex
CREATE INDEX "JournalArticle_authorId_updatedAt_idx" ON "JournalArticle"("authorId", "updatedAt");

-- CreateIndex
CREATE INDEX "JournalArticle_status_submittedAt_idx" ON "JournalArticle"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "JournalArticle_status_publishedAt_idx" ON "JournalArticle"("status", "publishedAt");

-- AddForeignKey
ALTER TABLE "JournalArticle" ADD CONSTRAINT "JournalArticle_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalArticle" ADD CONSTRAINT "JournalArticle_coverId_fkey" FOREIGN KEY ("coverId") REFERENCES "Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

