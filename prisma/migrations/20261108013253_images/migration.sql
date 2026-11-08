-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "public" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "photos" TEXT[] DEFAULT ARRAY[]::TEXT[];
