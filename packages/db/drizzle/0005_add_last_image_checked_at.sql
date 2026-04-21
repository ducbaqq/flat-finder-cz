-- Phase 2 image-rot sweep: track when `runImageRefreshSweep` last HEADed a
-- listing's thumbnail_url. Drives the "oldest-checked first" priority in
-- pickStaleForImageCheck().
--
-- No backfill — NULL sorts first under NULLS FIRST so every existing row
-- goes to the front of the queue the first time the sweep runs.
--
-- Partial index: only covers rows we'll actually check (active +
-- thumbnail present). Skips inactive rows and bezrealitky-style
-- no-detail-phase rows whose thumbnail_url is usually NULL or served by
-- their own CDN and isn't routed through the re-enrich path.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction; psql -f
-- runs each statement as its own implicit transaction so this file works
-- as-is. Do not wrap in BEGIN/COMMIT.

ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "last_image_checked_at" timestamp;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_listings_image_queue"
  ON "listings" ("source", "last_image_checked_at" NULLS FIRST)
  WHERE "is_active" = true AND "thumbnail_url" IS NOT NULL;
