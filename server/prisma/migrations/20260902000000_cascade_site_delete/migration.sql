-- Deleting a Site should take its whole subtree with it, so the delete route
-- stays a single statement instead of hand-rolled ordering in app code.

ALTER TABLE "SiteProfile" DROP CONSTRAINT IF EXISTS "SiteProfile_siteId_fkey";
ALTER TABLE "SiteProfile" ADD CONSTRAINT "SiteProfile_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Experiment" DROP CONSTRAINT IF EXISTS "Experiment_siteId_fkey";
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveredPage" DROP CONSTRAINT IF EXISTS "DiscoveredPage_siteId_fkey";
ALTER TABLE "DiscoveredPage" ADD CONSTRAINT "DiscoveredPage_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PageElement" DROP CONSTRAINT IF EXISTS "PageElement_siteId_fkey";
ALTER TABLE "PageElement" ADD CONSTRAINT "PageElement_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Hypothesis" DROP CONSTRAINT IF EXISTS "Hypothesis_experimentId_fkey";
ALTER TABLE "Hypothesis" ADD CONSTRAINT "Hypothesis_experimentId_fkey"
  FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Variant" DROP CONSTRAINT IF EXISTS "Variant_hypothesisId_fkey";
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_hypothesisId_fkey"
  FOREIGN KEY ("hypothesisId") REFERENCES "Hypothesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
