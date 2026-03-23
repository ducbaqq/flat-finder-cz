import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Pre-aggregated listing statistics.
 *
 * Instead of running COUNT/GROUP BY over 560K rows on every /api/stats request,
 * a background job periodically computes the aggregates and writes them here.
 * The stats endpoint then reads from this tiny table (~31 rows) in <50ms.
 *
 * Row layout (per-dimension aggregation, ~31 total rows):
 *   - '__total__': 1 row with total_all and total_active counts
 *   - 'by_source': ~10 rows, one per source
 *   - 'by_type': ~7 rows, one per property_type
 *   - 'by_transaction': ~3 rows, one per transaction_type
 *   - 'by_city': 10 rows, top 10 cities by listing count
 */
export const listingStats = pgTable("listing_stats", {
  id: serial("id").primaryKey(),
  dimension: text("dimension").notNull(),       // '__total__', 'by_source', 'by_type', 'by_transaction', 'by_city'
  source: text("source"),
  property_type: text("property_type"),
  transaction_type: text("transaction_type"),
  city: text("city"),
  cnt: integer("cnt").notNull().default(0),
  total_all: integer("total_all"),              // only set on '__total__' row
  total_active: integer("total_active"),        // only set on '__total__' row
  refreshed_at: timestamp("refreshed_at", { mode: "string" }).defaultNow(),
});

export type ListingStatsRow = typeof listingStats.$inferSelect;
