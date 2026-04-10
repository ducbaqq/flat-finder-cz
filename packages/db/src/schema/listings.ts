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
    // ── Single-column indexes for simple equality filters ──
    index("idx_listings_city").on(table.city),
    index("idx_listings_price").on(table.price),
    index("idx_listings_source").on(table.source),
    index("idx_listings_property_type").on(table.property_type),
    index("idx_listings_transaction_type").on(table.transaction_type),
    index("idx_listings_is_active").on(table.is_active),
    index("idx_listings_external_id").on(table.external_id),
    index("idx_listings_district").on(table.district),
    index("idx_listings_region").on(table.region),

    // ── Composite indexes for common query patterns ──
    // Geo: used by Supercluster loader and map bounding-box queries
    index("idx_listings_geo").on(table.is_active, table.latitude, table.longitude),
    // Default sort (newest): covers WHERE is_active = true ORDER BY listed_at DESC
    index("idx_listings_active_listed").on(table.is_active, table.listed_at),
    // Price sort: covers WHERE is_active = true ORDER BY price
    index("idx_listings_active_price").on(table.is_active, table.price),
    // Filtered map: covers common map queries with property_type + transaction_type
    index("idx_listings_filtered_geo").on(
      table.is_active,
      table.property_type,
      table.transaction_type,
      table.latitude,
      table.longitude,
    ),
    // Stats aggregation: covers GROUP BY source, property_type, transaction_type, city
    // where is_active = true — enables index-only scan for the stats query
    index("idx_listings_stats_agg").on(
      table.is_active,
      table.source,
      table.property_type,
      table.transaction_type,
      table.city,
    ),
    // ── Filter column indexes for bitmap index scan combining ──
    index("idx_listings_layout").on(table.layout),
    index("idx_listings_condition").on(table.condition),
    index("idx_listings_construction").on(table.construction),
    index("idx_listings_ownership").on(table.ownership),
    index("idx_listings_furnishing").on(table.furnishing),
    index("idx_listings_energy_rating").on(table.energy_rating),
    // ── Deduplication indexes ──
    index("idx_listings_cluster_id").on(table.cluster_id),
    index("idx_listings_canonical").on(table.is_active, table.is_canonical),
    index("idx_listings_seller_phone").on(table.seller_phone),
  ],
);

export type ListingRow = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
