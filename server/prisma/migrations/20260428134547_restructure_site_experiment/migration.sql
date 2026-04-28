/*
  Warnings:

  - You are about to drop the column `siteProfile` on the `Experiment` table. All the data in the column will be lost.
  - You are about to drop the column `url` on the `Experiment` table. All the data in the column will be lost.
  - Added the required column `siteId` to the `Experiment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Experiment" DROP COLUMN "siteProfile",
DROP COLUMN "url",
ADD COLUMN     "cooldownUntil" TIMESTAMP(3),
ADD COLUMN     "siteId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Hypothesis" ADD COLUMN     "liftPct" DOUBLE PRECISION,
ADD COLUMN     "prNumber" INTEGER,
ADD COLUMN     "prUrl" TEXT,
ALTER COLUMN "status" SET DEFAULT 'queued';

-- AlterTable
ALTER TABLE "PageElement" ADD COLUMN     "siteId" TEXT;

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "githubRepo" TEXT,
    "githubToken" TEXT,
    "autoMerge" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteProfile" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT '',
    "primaryColors" JSONB NOT NULL DEFAULT '[]',
    "fontStyle" TEXT NOT NULL DEFAULT '',
    "layoutPattern" TEXT NOT NULL DEFAULT '',
    "targetAudience" TEXT NOT NULL DEFAULT '',
    "conversionGoal" TEXT NOT NULL DEFAULT '',
    "copy" TEXT NOT NULL DEFAULT '',
    "weaknesses" JSONB NOT NULL DEFAULT '[]',
    "screenshotB64" TEXT,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Site_url_key" ON "Site"("url");

-- CreateIndex
CREATE UNIQUE INDEX "SiteProfile_siteId_key" ON "SiteProfile"("siteId");

-- AddForeignKey
ALTER TABLE "SiteProfile" ADD CONSTRAINT "SiteProfile_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageElement" ADD CONSTRAINT "PageElement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
