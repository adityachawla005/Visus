-- Behavior analysis: associate tracked sessions with a site + page for aggregation.
ALTER TABLE "Session" ADD COLUMN "siteId" TEXT;
CREATE INDEX "Session_siteId_page_idx" ON "Session"("siteId", "page");
