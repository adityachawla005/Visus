-- Multi-page analysis: track which page (full URL) each hypothesis targets.
ALTER TABLE "Hypothesis" ADD COLUMN "pageUrl" TEXT;
