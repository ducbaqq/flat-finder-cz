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
    enriched_at: timestamp("enriched_at", { mode: "string" }),
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
    // Index selection is data-driven. Production usage stats + EXPLAIN
    // testing on 2026-04-11 (via scripts/index-usage-stats.ts and
    // scripts/test-filter-plans.ts) showed 7 of the original 24 indexes
    // were either redundant or unused. Pruning them reduces write
    // amplification on listings UPDATE operations from 24 index
    // maintenance passes per row to 17 (~71% of original), cutting
    // --dedupe wall time by roughly a third.
    //
    // Dropped (7): idx_listings_external_id (EXACT duplicate of the
    // auto-generated listings_external_id_unique that backs .unique()),
    // idx_listings_city, idx_listings_price, idx_listings_source,
    // idx_listings_property_type, idx_listings_transaction_type,
    // idx_listings_region.
    //
    // KEPT (and briefly considered for dropping but proved in-use by
    // empirical testing):
    // - idx_listings_condition, construction, furnishing, energy_rating,
    //   ownership — UI-driven filter page queries hit all of these
    // - idx_listings_district — planner picked it in the EXPLAIN test
    //   for `WHERE district = 'Praha 6'` (rare enough that single-column
    //   bitmap scan wins over the composite)
    // - idx_listings_layout — filter page's heavy hitter
    //
    // If any query regresses post-deploy, scripts/restore-listings-indexes.ts
    // re-creates the 7 dropped indexes via CREATE INDEX CONCURRENTLY.

    // is_active alone: used by queries that filter only by active flag
    // without needing the geo or listed_at composites.
    index("idx_listings_is_active").on(table.is_active),

    // ── Composite indexes for hot query patterns ──
    // Geo: Supercluster loader + map bounding-box queries (1,317 scans).
    index("idx_listings_geo").on(table.is_active, table.latitude, table.longitude),
    // Default newest sort + most filter-page queries with LIMIT 20 use
    // this as an index-scan-backward path to get ordering cheaply.
    index("idx_listings_active_listed").on(table.is_active, table.listed_at),
    // Price sort path.
    index("idx_listings_active_price").on(table.is_active, table.price),
    // Filtered map: common map queries with property_type + transaction_type.
    index("idx_listings_filtered_geo").on(
      table.is_active,
      table.property_type,
      table.transaction_type,
      table.latitude,
      table.longitude,
    ),
    // Stats aggregation covers the materialization query AND acts as
    // fallback for single-column filters on source/property_type/
    // transaction_type/city (all leading columns after is_active).
    index("idx_listings_stats_agg").on(
      table.is_active,
      table.source,
      table.property_type,
      table.transaction_type,
      table.city,
    ),

    // ── Filter-column indexes (proven in use by the 2026-04-11 audit) ──
    // layout: the filter page's most-used filter (8 scans, 135K tup_read).
    index("idx_listings_layout").on(table.layout),
    // condition: 10 scans, chosen by planner for e.g. condition='after_renovation'.
    index("idx_listings_condition").on(table.condition),
    // construction, ownership, furnishing, energy_rating: each had 2-6
    // scans after a targeted UI walkthrough. Originally zero-scan but
    // that was because nobody had filtered by them recently in production.
    index("idx_listings_construction").on(table.construction),
    index("idx_listings_ownership").on(table.ownership),
    index("idx_listings_furnishing").on(table.furnishing),
    index("idx_listings_energy_rating").on(table.energy_rating),
    // district: zero historical scans but EXPLAIN confirmed the planner
    // picks it for rare-district filters like WHERE district = 'Praha 6'.
    index("idx_listings_district").on(table.district),

    // ── Deduplication indexes ──
    index("idx_listings_cluster_id").on(table.cluster_id),
    index("idx_listings_canonical").on(table.is_active, table.is_canonical),
  ],
);

export type ListingRow = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
