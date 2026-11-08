-- CreateTable
CREATE TABLE "RentReminder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dueOn" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentReminder_organizationId_createdAt_idx" ON "RentReminder"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RentReminder_leaseId_kind_dueOn_key" ON "RentReminder"("leaseId", "kind", "dueOn");
