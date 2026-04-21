-- Secondary match hash for price-on-request ("cena na dotaz") listings.
--
-- The primary match_hash (0004_add_match_hash.sql) requires all four of
-- geo / size / price / transaction_type to be non-null. Luxury listings,
-- commercial properties, and high-end rentals frequently show price as
-- "on request" — the scraper records them with price = NULL — and those
-- rows get NULL match_hash and stay unclustered forever.
--
-- Production audit 2026-04-21 found 40,967 active rows with NULL price.
-- Using a heuristic geo+size+transaction key, 3,199 likely-duplicate
-- groups span 8,055 rows, 2,558 groups cross-source. ~4,856 rows would
-- be hidden as non-canonical duplicates once clustered.
--
-- Why this is safe to relax here but NOT in the primary hash:
--   - Scoped to price IS NULL → only fires on "price on request" rows.
--   - Same-building different-unit collisions are flagged by DIFFERENT
--     PRICES in the primary path; a same-building same-size price-on-
--     request pair is almost always the same listing cross-posted.
--   - Prefix 'geo-np|' guarantees the hash space is disjoint from the
--     primary 'geo|' space — no accidental merge across regimes.
--
-- A row has at most one hash populated at a time: when price transitions
-- from NULL to non-NULL (e.g. landlord answers and portal updates the
-- listing), Postgres recomputes both generated columns: primary becomes
-- non-null, secondary becomes null. The next daily --dedupe rebuild
-- migrates the row into the correct primary cluster.
--
-- CREATE INDEX CONCURRENTLY cannot run in a transaction; psql -f runs
-- each statement as its own implicit transaction. Do not wrap this file
-- in BEGIN/COMMIT.

ALTER TABLE "listings"
ADD COLUMN IF NOT EXISTS "match_hash_no_price" text GENERATED ALWAYS AS (
  CASE
    WHEN price IS NULL
     AND latitude IS NOT NULL AND longitude IS NOT NULL
     -- `size_m2 > 0` guards against a parser bug on ereality: when the
     -- size can't be extracted it stores 0 instead of NULL. A size-0 row
     -- would otherwise collide with every other size-0 row in the same
     -- geo block (preview showed 10 different warehouses — 1000m² /
     -- 2000m² / 3000m² — all merging because the DB value was 0).
     AND size_m2 IS NOT NULL AND size_m2 > 0
    THEN md5(
      'geo-np|' || transaction_type || '|' ||
      ROUND(latitude::numeric, 4)::text || '|' ||
      ROUND(longitude::numeric, 4)::text || '|' ||
      ROUND(size_m2::numeric, 2)::text
    )
    ELSE NULL
  END
) STORED;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_listings_match_hash_no_price"
ON "listings" ("match_hash_no_price")
WHERE "match_hash_no_price" IS NOT NULL;
