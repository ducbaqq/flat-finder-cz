import {
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Pre-computed marker clusters for the map endpoint.
 *
 * Instead of loading 400K rows into a Supercluster in-memory index (107s+),
 * a background job periodically computes ROUND(lat, precision)/ROUND(lng, precision)
 * clusters at each zoom tier and stores them here.
 *
 * The markers endpoint reads from this table filtered by viewport bounds — instant.
 *
 * Zoom tier mapping:
 *   precision 0 → zoom 1-8   (~111 km grid, ~3K rows)
 *   precision 1 → zoom 9-10  (~11 km grid, ~15K rows)
 *   precision 2 → zoom 11-13 (~1.1 km grid, ~60K rows)
 *   precision 3 → zoom 14-16 (~110 m grid, ~180K rows)
 *
 * Total rows: ~260K — still much smaller than 400K listings with wide columns,
 * and queries filter by precision + viewport bounds so they scan very few rows.
 */
export const markerClusters = pgTable(
  "marker_clusters",
  {
    id: serial("id").primaryKey(),
    precision: integer("precision").notNull(), // 0, 1, 2, 3
    lat: doublePrecision("lat").notNull(),     // ROUND(latitude, precision)
    lng: doublePrecision("lng").notNull(),      // ROUND(longitude, precision)
    count: integer("count").notNull(),
    avg_price: doublePrecision("avg_price"),
    /** Smallest listing id in the cluster — useful for single-point clusters */
    min_id: integer("min_id"),
    /** Price of the min_id listing (for single-point display) */
    min_price: doublePrecision("min_price"),
    refreshed_at: timestamp("refreshed_at", { mode: "string" }).defaultNow(),
  },
  (table) => [
    // Primary lookup: precision + viewport bounds (lat/lng range scan)
    index("idx_mc_precision_lat_lng").on(table.precision, table.lat, table.lng),
  ],
);

export type MarkerClusterRow = typeof markerClusters.$inferSelect;
