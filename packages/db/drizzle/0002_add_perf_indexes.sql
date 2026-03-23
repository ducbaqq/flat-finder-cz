-- Performance indexes for 400K+ row listings table
-- Run this migration to add missing indexes and drop duplicates.
-- These indexes target the specific query patterns in the API:
--   1. Stats aggregation (single-query GROUP BY)
--   2. Listings default sort (is_active + listed_at)
--   3. Listings price sort (is_active + price)
--   4. Location filter (region)
--   5. Supercluster loader (is_active + lat + lng — already exists)

-- Drop duplicate index (idx_listings_city_lower is identical to idx_listings_city)
DROP INDEX IF EXISTS "idx_listings_city_lower";

-- Add region index for location filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_listings_region"
  ON "listings" USING btree ("region");

-- Add composite index for price sort: WHERE is_active = true ORDER BY price
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_listings_active_price"
  ON "listings" USING btree ("is_active", "price");

-- Add composite index for stats aggregation query:
-- GROUP BY source, property_type, transaction_type, city WHERE is_active = true
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_listings_stats_agg"
  ON "listings" USING btree ("is_active", "source", "property_type", "transaction_type", "city");
