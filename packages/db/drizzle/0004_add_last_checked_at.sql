-- Freshness sweep: track when the runFreshnessSweep engine last hit a
-- listing's source_url. Drives the "oldest-checked first" priority order
-- in pickStaleForLiveness().
--
-- No backfill needed. NULL sorts first under NULLS FIRST, which is exactly
-- the desired behaviour on Day 1 (every existing row gets checked before
-- any previously-checked row is re-checked).
--
-- The companion index is created CONCURRENTLY so it doesn't ACCESS
-- EXCLUSIVE lock the table the way a vanilla CREATE INDEX would. Run this
-- file outside a transaction (psql -f or drizzle-kit migrate both do the
-- right thing for CONCURRENTLY); do not wrap it in BEGIN/COMMIT.

ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "last_checked_at" timestamp;

-- Audit trail for why a listing was deactivated: 'liveness_404', 'ttl',
-- 'missing_from_full', or NULL for legacy rows. Purely observational —
-- code can treat NULL as "unknown / legacy".
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "deactivation_reason" text;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_listings_liveness_queue"
  ON "listings" ("source", "last_checked_at" NULLS FIRST)
  WHERE "is_active" = true;
