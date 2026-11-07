-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'PAID_OUT', 'CANCELED');

-- CreateTable
CREATE TABLE "TenantUser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TenantUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessorAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutBankMask" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProcessorAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "bankName" TEXT,
    "last4" TEXT NOT NULL,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "providerRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "tenantId" TEXT,
    "paymentMethodId" TEXT,
    "methodType" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "leaseTransactionId" TEXT,
    "failureReason" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'PORTAL',
    "expectedPayoutDate" DATE,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Autopay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "amountMode" TEXT NOT NULL DEFAULT 'FULL_BALANCE',
    "fixedCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Autopay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopayRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "autopayId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "tenantId" TEXT,
    "carrier" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "liabilityCents" INTEGER,
    "effectiveDate" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'UPLOADED',
    "attachmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantUser_userId_idx" ON "TenantUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantUser_tenantId_userId_key" ON "TenantUser"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessorAccount_organizationId_key" ON "ProcessorAccount"("organizationId");

-- CreateIndex
CREATE INDEX "PaymentMethod_organizationId_tenantId_idx" ON "PaymentMethod"("organizationId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_providerRef_key" ON "PaymentIntent"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_leaseTransactionId_key" ON "PaymentIntent"("leaseTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_idempotencyKey_key" ON "PaymentIntent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentIntent_organizationId_status_idx" ON "PaymentIntent"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PaymentIntent_organizationId_leaseId_idx" ON "PaymentIntent"("organizationId", "leaseId");

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentIntentId_idx" ON "PaymentEvent"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Autopay_leaseId_tenantId_key" ON "Autopay"("leaseId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AutopayRun_autopayId_period_key" ON "AutopayRun"("autopayId", "period");

-- CreateIndex
CREATE INDEX "InsurancePolicy_organizationId_leaseId_idx" ON "InsurancePolicy"("organizationId", "leaseId");

-- AddForeignKey
ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
