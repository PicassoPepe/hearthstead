-- CreateTable
CREATE TABLE "StatementSend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StatementSend_organizationId_period_idx" ON "StatementSend"("organizationId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "StatementSend_ownerId_period_key" ON "StatementSend"("ownerId", "period");
