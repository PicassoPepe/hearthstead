CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "unitMin" INTEGER NOT NULL DEFAULT 0,
    "unitMax" INTEGER,
    "monthlyFlatCents" INTEGER,
    "monthlyPerUnitCents" INTEGER,
    "monthlyMinCents" INTEGER,
    "annualFlatCents" INTEGER,
    "annualPerUnitCents" INTEGER,
    "annualMinCents" INTEGER,
    "volumeAboveUnits" INTEGER,
    "volumeMonthlyCents" INTEGER,
    "volumeAnnualCents" INTEGER,
    "addOnAnnualCents" INTEGER,
    "stripeProductId" TEXT,
    "stripePriceMonthId" TEXT,
    "stripePriceYearId" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "smsIncluded" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'HOSTED',
    "planKey" TEXT NOT NULL DEFAULT 'hosted_starter',
    "interval" TEXT NOT NULL DEFAULT 'month',
    "status" TEXT NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "betaUntil" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "pastDueSince" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "billedUnits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subscription_orgId_key" ON "Subscription"("orgId");
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "planKey" TEXT NOT NULL DEFAULT 'local_annual',
    "maxUnits" INTEGER NOT NULL,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 14,
    "releaseChannel" TEXT NOT NULL DEFAULT 'stable',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "lastCheckInAt" TIMESTAMP(3),
    "lastCheckInVersion" TEXT,
    "lastCheckInUnits" INTEGER,
    "token" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "License_customerEmail_idx" ON "License"("customerEmail");

CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Entitlement_orgId_featureKey_idx" ON "Entitlement"("orgId", "featureKey");
