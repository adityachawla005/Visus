-- AlterTable: add pagePath to Hypothesis
ALTER TABLE "Hypothesis" ADD COLUMN "pagePath" TEXT NOT NULL DEFAULT '/';

-- CreateTable: DiscoveredPage
CREATE TABLE "DiscoveredPage" (
    "id"          SERIAL       NOT NULL,
    "siteId"      TEXT         NOT NULL,
    "url"         TEXT         NOT NULL,
    "path"        TEXT         NOT NULL,
    "title"       TEXT         NOT NULL DEFAULT '',
    "importance"  INTEGER      NOT NULL DEFAULT 0,
    "category"    TEXT         NOT NULL DEFAULT 'other',
    "status"      TEXT         NOT NULL DEFAULT 'pending',
    "selectorMap" JSONB        NOT NULL DEFAULT '{}',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredPage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DiscoveredPage" ADD CONSTRAINT "DiscoveredPage_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- UniqueIndex
CREATE UNIQUE INDEX "DiscoveredPage_siteId_path_key" ON "DiscoveredPage"("siteId", "path");
