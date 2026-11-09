ALTER TABLE "Subscription" ADD COLUMN "compReason" TEXT, ADD COLUMN "compUntil" TIMESTAMP(3);

CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- Companies that existed before billing was switched on are free until the owner decides otherwise.
INSERT INTO "Subscription" ("id", "orgId", "status", "compReason", "updatedAt")
SELECT 'sub_' || o."id", o."id", 'COMPLIMENTARY', 'Existed before billing was switched on', CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."orgId" = o."id");
