-- CreateTable
CREATE TABLE "ParcelRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOOKED_UP',
    "error" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "countyFips" TEXT,
    "countyName" TEXT,
    "parcelId" TEXT,
    "ownerName" TEXT,
    "ownerMailing" TEXT,
    "situsAddress" TEXT,
    "legalDescription" TEXT,
    "acres" DOUBLE PRECISION,
    "landUse" TEXT,
    "assessedValueCents" INTEGER,
    "taxYear" INTEGER,
    "lastSaleDate" TEXT,
    "lastSalePriceCents" INTEGER,
    "deedBook" TEXT,
    "deedPage" TEXT,
    "geometry" JSONB,
    "links" JSONB NOT NULL DEFAULT '[]',
    "raw" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParcelRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParcelRecord_propertyId_key" ON "ParcelRecord"("propertyId");

-- CreateIndex
CREATE INDEX "ParcelRecord_organizationId_fetchedAt_idx" ON "ParcelRecord"("organizationId", "fetchedAt");
