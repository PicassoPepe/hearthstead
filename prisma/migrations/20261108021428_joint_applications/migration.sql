-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "primaryId" TEXT,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'PRIMARY';
