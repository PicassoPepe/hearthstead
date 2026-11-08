-- CreateTable
CREATE TABLE "UtilityBillback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "incomeAccountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "recoveryPct" INTEGER NOT NULL DEFAULT 100,
    "billCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "UtilityBillback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UtilityBillback_organizationId_period_idx" ON "UtilityBillback"("organizationId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "UtilityBillback_propertyId_period_expenseAccountId_key" ON "UtilityBillback"("propertyId", "period", "expenseAccountId");
