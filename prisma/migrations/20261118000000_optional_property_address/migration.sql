-- A property can be recorded with a name and no address (or a partial address).
ALTER TABLE "Property" ALTER COLUMN "addressLine1" DROP NOT NULL;
ALTER TABLE "Property" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "Property" ALTER COLUMN "state" DROP NOT NULL;
ALTER TABLE "Property" ALTER COLUMN "postalCode" DROP NOT NULL;

UPDATE "Property" SET "addressLine1" = NULL WHERE "addressLine1" = '';
UPDATE "Property" SET "city" = NULL WHERE "city" = '';
UPDATE "Property" SET "state" = NULL WHERE "state" = '';
UPDATE "Property" SET "postalCode" = NULL WHERE "postalCode" = '';
