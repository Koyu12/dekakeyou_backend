-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rejectedReason" TEXT;
