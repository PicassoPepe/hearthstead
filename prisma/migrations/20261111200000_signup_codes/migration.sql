ALTER TABLE "User" ADD COLUMN "phone" TEXT, ADD COLUMN "phoneVerified" TIMESTAMP(3);

CREATE TABLE "PendingSignup" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "phone" TEXT,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sends" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PendingSignup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PendingSignup_email_idx" ON "PendingSignup"("email");
