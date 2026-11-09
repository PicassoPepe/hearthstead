CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "tables" INTEGER NOT NULL DEFAULT 0,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BackupRun_createdAt_idx" ON "BackupRun"("createdAt");

CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "path" TEXT,
    "digest" TEXT,
    "orgId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ErrorEvent_createdAt_idx" ON "ErrorEvent"("createdAt");
CREATE INDEX "ErrorEvent_fingerprint_createdAt_idx" ON "ErrorEvent"("fingerprint", "createdAt");
