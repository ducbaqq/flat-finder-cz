import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const listings = pgTable(
  "listings",
  {
    id: serial("id").primaryKey(),
    external_id: text("external_id").unique().notNull(),
    source: text("source").notNull(),
    property_type: text("property_type").notNull(),
    transaction_type: text("transaction_type").notNull(),
    title: text("title"),
    description: text("description"),
    price: doublePrecision("price"),
    currency: text("currency").default("CZK"),
    price_note: text("price_note"),
    address: text("address"),
    city: text("city"),
    district: text("district"),
    region: text("region"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    size_m2: doublePrecision("size_m2"),
    layout: text("layout"),
    floor: integer("floor"),
    total_floors: integer("total_floors"),
    condition: text("condition"),
    construction: text("construction"),
    ownership: text("ownership"),
    furnishing: text("furnishing"),
    energy_rating: text("energy_rating"),
    amenities: text("amenities"),
    image_urls: jsonb("image_urls").$type<string[]>().default([]),
    thumbnail_url: text("thumbnail_url"),
    source_url: text("source_url"),
    listed_at: timestamp("listed_at", { mode: "string" }),
    scraped_at: timestamp("scraped_at", { mode: "string" }).defaultNow(),
    created_at: timestamp("created_at", { mode: "string" }).defaultNow(),
    is_active: boolean("is_active").default(true),
    deactivated_at: timestamp("deactivated_at", { mode: "string" }),
    seller_name: text("seller_name"),
    seller_phone: text("seller_phone"),
    seller_email: text("seller_email"),
    seller_company: text("seller_company"),
    additional_params: jsonb("additional_params").$type<Record<string, unknown>>(),
    cluster_id: text("cluster_id"),
    is_canonical: boolean("is_canonical").default(true),
  },
  (table) => [
    // Index selection is data-driven. Production usage stats on 2026-04-11
    // (via scripts/index-usage-stats.ts) showed 12 of the original 24
    // indexes had zero scans since DB start. Pruning them roughly halves
    // the write amplification on listings UPDATE operations, which is the
    // dominant cost of the --dedupe pass.
    //
    // Dropped indexes (see perf/prune-listings-indexes branch for the
    // full rationale): idx_listings_city, idx_listings_price,
    // idx_listings_source, idx_listings_property_type,
    // idx_listings_transaction_type, idx_listings_external_id (was a
    // duplicate of the auto-generated listings_external_id_unique),
    // idx_listings_district, idx_listings_region, idx_listings_condition,
    // idx_listings_construction, idx_listings_ownership,
    // idx_listings_furnishing, idx_listings_energy_rating.
    //
    // If any of those queries regress, scripts/restore-listings-indexes.ts
    // re-creates them with CREATE INDEX CONCURRENTLY IF NOT EXISTS.

    // is_active alone: 105 scans at the time of the audit, used by
    // queries that filter only by active flag without needing the geo
    // or listed_at composites.
    index("idx_listings_is_active").on(table.is_active),

    // Geo: Supercluster loader + map bounding-box queries (1,217 scans).
    index("idx_listings_geo").on(table.is_active, table.latitude, table.longitude),
    // Default newest sort: WHERE is_active = true ORDER BY listed_at DESC (183 scans).
    index("idx_listings_active_listed").on(table.is_active, table.listed_at),
    // Price sort: WHERE is_active = true ORDER BY price (2 scans, but the
    // canonical path for price-sorted listings pages).
    index("idx_listings_active_price").on(table.is_active, table.price),
    // Filtered map: common map queries with property_type + transaction_type (2,787 scans).
    index("idx_listings_filtered_geo").on(
      table.is_active,
      table.property_type,
      table.transaction_type,
      table.latitude,
      table.longitude,
    ),
    // Stats aggregation: GROUP BY source, property_type, transaction_type, city
    // where is_active = true — covers the listing_stats materialization (1,398 scans).
    index("idx_listings_stats_agg").on(
      table.is_active,
      table.source,
      table.property_type,
      table.transaction_type,
      table.city,
    ),
    // Layout filter: used by the filter page (8 scans, 135K tup_read).
    // The other filter-column indexes (condition, construction, etc.) had
    // zero scans so they were dropped; layout is the heavy-hitter that
    // filter-page traffic actually uses.
    index("idx_listings_layout").on(table.layout),
    // Deduplication: cluster_id lookups + is_canonical search filter.
    index("idx_listings_cluster_id").on(table.cluster_id),
    index("idx_listings_canonical").on(table.is_active, table.is_canonical),
  ],
);

export type ListingRow = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
