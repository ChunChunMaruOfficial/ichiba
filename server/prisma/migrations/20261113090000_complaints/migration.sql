-- «Жалобы и обращения»: the electronic complaint form with an answer (Правила дистанционной торговли, п. 14.4).
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "about" TEXT,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Complaint_number_key" ON "Complaint"("number");
CREATE INDEX "Complaint_status_createdAt_idx" ON "Complaint"("status", "createdAt");
