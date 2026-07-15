-- Multi-tenancy: associate each site with the user who connected it.
ALTER TABLE "Site" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Site" ADD CONSTRAINT "Site_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Site_ownerId_idx" ON "Site"("ownerId");
