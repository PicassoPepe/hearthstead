-- AlterTable
ALTER TABLE "InspectionItem" ADD COLUMN     "photos" TEXT[] DEFAULT ARRAY[]::TEXT[];
