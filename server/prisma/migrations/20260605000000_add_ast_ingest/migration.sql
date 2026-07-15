-- Add AST ingestion support: per-site ingest mode + parsed component map.
ALTER TABLE "Site" ADD COLUMN "ingestMode" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "SiteProfile" ADD COLUMN "componentMap" JSONB NOT NULL DEFAULT '{}';
