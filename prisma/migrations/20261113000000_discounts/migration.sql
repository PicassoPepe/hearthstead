-- CreateTable
CREATE TABLE "Discount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "target" TEXT NOT NULL,
    "chargeId" TEXT,
    "chargeKinds" TEXT[],
    "duration" TEXT NOT NULL,
    "months" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "delivery" TEXT NOT NULL,
    "leaseId" TEXT,
    "code" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "perTenantLimit" INTEGER,
    "propertyId" TEXT,
    "unitId" TEXT,
    "reasonKey" TEXT NOT NULL,
    "reasonText" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountRedemption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "tenantId" TEXT,
    "redeemedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountApplication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "chargeCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "afterCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Discount_organizationId_status_idx" ON "Discount"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Discount_organizationId_leaseId_idx" ON "Discount"("organizationId", "leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Discount_organizationId_code_key" ON "Discount"("organizationId", "code");

-- CreateIndex
CREATE INDEX "DiscountRedemption_organizationId_leaseId_idx" ON "DiscountRedemption"("organizationId", "leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRedemption_discountId_leaseId_key" ON "DiscountRedemption"("discountId", "leaseId");

-- CreateIndex
CREATE INDEX "DiscountApplication_organizationId_chargeId_idx" ON "DiscountApplication"("organizationId", "chargeId");

-- CreateIndex
CREATE INDEX "DiscountApplication_organizationId_createdAt_idx" ON "DiscountApplication"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountApplication_discountId_chargeId_key" ON "DiscountApplication"("discountId", "chargeId");

-- CreateIndex
CREATE INDEX "DiscountEvent_organizationId_discountId_createdAt_idx" ON "DiscountEvent"("organizationId", "discountId", "createdAt");

-- AddForeignKey
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountApplication" ADD CONSTRAINT "DiscountApplication_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountEvent" ADD CONSTRAINT "DiscountEvent_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- "Concessions & Discounts" (contra-income) for every existing company.
INSERT INTO "Account" ("id","organizationId","code","name","type","isSystem","systemKey","updatedAt")
SELECT 'acct_conc_' || o."id",
       o."id",
       CASE WHEN EXISTS (SELECT 1 FROM "Account" a WHERE a."organizationId" = o."id" AND a."code" = '4050') THEN '4059' ELSE '4050' END,
       'Concessions & Discounts', 'INCOME', true, 'CONCESSIONS', CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."organizationId" = o."id" AND a."systemKey" = 'CONCESSIONS');

-- New permission area "discounts": Admin = full (approve), anyone who could edit accounting = edit (create), else view/none.
UPDATE "Role" SET "permissions" = jsonb_set("permissions"::jsonb, '{discounts}', to_jsonb(
  CASE WHEN "key" = 'ADMIN' THEN 'delete'
       WHEN "permissions"->>'accounting' = 'delete' AND "key" IS DISTINCT FROM 'BOOKKEEPER' THEN 'delete'
       WHEN "key" = 'BOOKKEEPER' THEN 'view'
       WHEN "permissions"->>'accounting' = 'edit' THEN 'edit'
       WHEN "permissions"->>'accounting' = 'view' THEN 'view'
       ELSE 'none' END))
WHERE NOT ("permissions"::jsonb ? 'discounts');
