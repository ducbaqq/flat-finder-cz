-- Adds `match_hash` to listings as a GENERATED ALWAYS AS (md5(...)) STORED
-- column, plus a partial index on non-null values.
--
-- Motivation: the inline incremental dedup (clusterNewListings) computed the
-- match-key md5 per candidate on every watch cycle and probed
-- idx_listings_cluster_id. On a ~170K unclustered pool that reliably exceeded
-- the 90s statement_timeout safety net — 2 out of 3 cycles failed to cluster
-- anything. By storing the hash as a generated column, Postgres populates it
-- automatically on insert/update, and the inline pipeline does an O(log N)
-- lookup on the dedicated index instead of rehashing every row.
--
-- Formula: byte-identical to runClusteringOps's cluster_hash expression at
-- packages/db/src/queries/listings.ts. This is the invariant that lets the
-- inline pass (which reads match_hash) and the daily full rebuild (which
-- still computes md5 inline) agree on cluster_ids — an existing cluster_id
-- value equals the match_hash of any row in that cluster.
--
-- Applied in production 2026-04-20 via scripts/add-match-hash-column.ts.
-- The ALTER rewrites the table (~10–30 min on ~730K rows) under an
-- ACCESS EXCLUSIVE lock; the scraper must be paused during this window.

ALTER TABLE "listings"
ADD COLUMN IF NOT EXISTS "match_hash" text GENERATED ALWAYS AS (
  CASE
    WHEN latitude IS NOT NULL AND longitude IS NOT NULL
     AND size_m2 IS NOT NULL AND price IS NOT NULL
    THEN md5(
      'geo|' || transaction_type || '|' ||
      ROUND(latitude::numeric, 4)::text || '|' ||
      ROUND(longitude::numeric, 4)::text || '|' ||
      ROUND(size_m2::numeric, 2)::text || '|' ||
      ROUND(price::numeric, 0)::text
    )
    ELSE NULL
  END
) STORED;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_listings_match_hash"
ON "listings" ("match_hash")
WHERE "match_hash" IS NOT NULL;
