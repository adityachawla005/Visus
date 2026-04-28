-- AlterTable
ALTER TABLE "Site" ADD COLUMN "trackerPrUrl" TEXT;
ALTER TABLE "Site" ADD COLUMN "trackerPrNumber" INTEGER;
ALTER TABLE "Site" ADD COLUMN "trackerInjected" BOOLEAN NOT NULL DEFAULT false;
