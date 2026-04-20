-- Adds `enriched_at` to separate "we saw this listing on the list page"
-- (scraped_at) from "we successfully fetched the detail page" (enriched_at).
--
-- Motivation: when detail enrichment silently failed (timeout, 429, parse
-- error on one listing) the previous design still stamped scraped_at, which
-- pinned the listing under the 24h IDNES_SKIP_ENRICHMENT_HOURS gate. Those
-- listings then stayed "Phase-1 only" forever — null description, null
-- seller, null floor — until a full rescrape bypassed the gate.
--
-- Split schema semantics:
--   scraped_at   — last time we confirmed the listing is live on the portal
--                  (list-page sighting OR successful detail fetch)
--   enriched_at  — last time detail enrichment populated at least one field
--                  (null = never successfully enriched → always try next cycle)
--
-- Skip-gate query now uses enriched_at, so partial/failed enrichments re-try
-- on the following cycle without blocking on the 24h cache.

ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "enriched_at" timestamp;

-- Backfill: mark rows that clearly have enrichment data as already enriched
-- at their current scraped_at. The heuristic is conservative — rows that
-- legitimately have no description but do have e.g. seller_phone still
-- count. Rows with all enrichment-filled fields null remain NULL and will
-- get re-enriched on the next watch cycle (that's the bug this migration
-- is fixing, so that behavior is correct).
UPDATE "listings"
SET "enriched_at" = "scraped_at"
WHERE "enriched_at" IS NULL
  AND (
    "description" IS NOT NULL
    OR "seller_name" IS NOT NULL
    OR "seller_phone" IS NOT NULL
    OR "seller_email" IS NOT NULL
    OR "floor" IS NOT NULL
    OR "energy_rating" IS NOT NULL
    OR "condition" IS NOT NULL
    OR "construction" IS NOT NULL
    OR "furnishing" IS NOT NULL
    OR "ownership" IS NOT NULL
    OR ("additional_params" IS NOT NULL AND "additional_params" <> '{}'::jsonb)
    OR ("image_urls" IS NOT NULL AND jsonb_array_length("image_urls") > 1)
  );

-- No index yet: the skip-gate query is `WHERE external_id IN (...) AND
-- enriched_at >= $cutoff`. With batches of ~100-1000 external_ids, the
-- unique index on external_id drives the plan; enriched_at is just a
-- post-filter. Add an index later if EXPLAIN shows otherwise.
