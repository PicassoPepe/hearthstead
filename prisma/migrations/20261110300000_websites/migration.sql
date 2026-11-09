CREATE TABLE "Website" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "publishedAt" TIMESTAMP(3),
    "live" BOOLEAN NOT NULL DEFAULT true,
    "customDomain" TEXT,
    "template" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Website_organizationId_key" ON "Website"("organizationId");
CREATE UNIQUE INDEX "Website_customDomain_key" ON "Website"("customDomain");

CREATE TABLE "WebsiteVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "note" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    CONSTRAINT "WebsiteVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebsiteVersion_organizationId_publishedAt_idx" ON "WebsiteVersion"("organizationId", "publishedAt");
