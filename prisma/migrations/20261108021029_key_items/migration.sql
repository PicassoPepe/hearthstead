-- CreateTable
CREATE TABLE "KeyItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "leaseId" TEXT,
    "holderName" TEXT,
    "assignedAt" TIMESTAMP(3),
    "monthlyFeeCents" INTEGER NOT NULL DEFAULT 0,
    "recurringChargeId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KeyItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeyItem_organizationId_propertyId_idx" ON "KeyItem"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "KeyItem_organizationId_leaseId_idx" ON "KeyItem"("organizationId", "leaseId");
