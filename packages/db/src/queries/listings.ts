import {
  and,
  asc,
  type Column,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { ListingFilters } from "@flat-finder/types";
import { listings, type NewListing } from "../schema/listings.js";
import type { Db } from "../client.js";

export function buildWhereConditions(
  filters: ListingFilters,
  opts?: { includeInactive?: boolean },
): SQL[] {
  const conditions: SQL[] = [];

  if (!opts?.includeInactive) {
    conditions.push(eq(listings.is_active, true));
    conditions.push(eq(listings.is_canonical, true));
  }

  const simpleFilters: Array<{
    key: keyof ListingFilters;
    col: Column;
  }> = [
    { key: "property_type", col: listings.property_type },
    { key: "transaction_type", col: listings.transaction_type },
    { key: "city", col: listings.city },
    { key: "region", col: listings.region },
    { key: "source", col: listings.source },
    { key: "layout", col: listings.layout },
    { key: "condition", col: listings.condition },
    { key: "construction", col: listings.construction },
    { key: "ownership", col: listings.ownership },
    { key: "furnishing", col: listings.furnishing },
    { key: "energy_rating", col: listings.energy_rating },
  ];

  for (const { key, col } of simpleFilters) {
    const val = filters[key];
    if (val && typeof val === "string") {
      const vals = val.split(",").filter(Boolean);
      if (vals.length > 1) {
        conditions.push(inArray(col, vals));
      } else {
        conditions.push(eq(col, vals[0]));
      }
    }
  }

  if (filters.price_min != null) {
    conditions.push(gte(listings.price, filters.price_min));
  }
  if (filters.price_max != null) {
    conditions.push(lte(listings.price, filters.price_max));
  }
  if (filters.size_min != null) {
    conditions.push(gte(listings.size_m2, filters.size_min));
  }
  if (filters.size_max != null) {
    conditions.push(lte(listings.size_m2, filters.size_max));
  }

  if (filters.amenities) {
    for (const a of filters.amenities.split(",")) {
      conditions.push(ilike(listings.amenities, `%${a.trim()}%`));
    }
  }

  if (filters.location) {
    // Skip text-based location filter when bbox is present — the geographic
    // bounds already constrain results spatially, and the text filter can't
    // match streets/addresses (only city/district/region exact match).
    const hasBbox = filters.sw_lat != null && filters.sw_lng != null &&
      filters.ne_lat != null && filters.ne_lng != null;

    if (!hasBbox) {
      const loc = filters.location.trim();
      conditions.push(
        or(
          eq(listings.city, loc),
          eq(listings.district, loc),
          eq(listings.region, loc),
          ilike(listings.city, `${loc}%`),
          ilike(listings.district, `${loc}%`),
        )!,
      );
    }
  }

  // Geographic bounds
  if (
    filters.sw_lat != null &&
    filters.sw_lng != null &&
    filters.ne_lat != null &&
    filters.ne_lng != null
  ) {
    conditions.push(isNotNull(listings.latitude));
    conditions.push(isNotNull(listings.longitude));
    conditions.push(gte(listings.latitude, filters.sw_lat));
    conditions.push(lte(listings.latitude, filters.ne_lat));
    conditions.push(gte(listings.longitude, filters.sw_lng));
    conditions.push(lte(listings.longitude, filters.ne_lng));
  }

  return conditions;
}

export function getSortOrder(sort?: string) {
  switch (sort) {
    case "price_asc":
      return asc(listings.price);
    case "price_desc":
      return desc(listings.price);
    case "size_asc":
      return asc(listings.size_m2);
    case "size_desc":
      return desc(listings.size_m2);
    case "newest":
    default:
      return desc(listings.listed_at);
  }
}

export async function queryListings(
  db: Db,
  filters: ListingFilters,
  opts?: { cachedTotal?: number },
) {
  const page = filters.page ?? 1;
  const perPage = Math.min(filters.per_page ?? 20, 100);
  const offset = (page - 1) * perPage;

  const conditions = buildWhereConditions(filters, {
    includeInactive: filters.include_inactive,
  });
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Avoid holding a transaction open for both COUNT + SELECT.
  // The SELECT with LIMIT/OFFSET is fast; COUNT(*) on 400K rows is not.
  // Strategy:
  //   1. If we have a cached total, skip COUNT entirely.
  //   2. Otherwise, run the data query first (fast), then COUNT separately.
  //      Use statement_timeout on the COUNT to protect against slow filters.
  const hasCachedTotal = opts?.cachedTotal != null;

  // Data query — uses indexes on is_active + listed_at (or price/size for sort)
  const rows = await db
    .select()
    .from(listings)
    .where(where)
    .orderBy(getSortOrder(filters.sort))
    .limit(perPage)
    .offset(offset);

  let total: number;

  if (hasCachedTotal) {
    total = opts!.cachedTotal!;
  } else if (rows.length < perPage) {
    // Page is not full — we know the exact total
    total = offset + rows.length;
  } else {
    // Run COUNT with a 2s timeout. Fast for small result sets, falls back
    // to a generous estimate for large viewport scans that would take 10s+.
    try {
      const [totalResult] = await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '2000'`);
        return tx.execute<{ cnt: string }>(
          sql`SELECT COUNT(*) AS cnt FROM (
            SELECT 1 FROM listings
            WHERE ${where ?? sql`true`}
            LIMIT 100000
          ) sub`,
        );
      });
      total = Number(totalResult?.cnt ?? 0);
    } catch {
      // COUNT timed out — estimate generously so pagination keeps working
      total = Math.max(10000, offset + rows.length + perPage);
    }
  }

  return {
    listings: rows,
    total,
    page,
    per_page: perPage,
    total_pages: total > 0 ? Math.ceil(total / perPage) : 1,
  };
}

export async function getListingById(db: Db, id: number) {
  const rows = await db
    .select()
    .from(listings)
    .where(eq(listings.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertListing(
  db: Db,
  listing: NewListing,
): Promise<{ isNew: boolean; id: number }> {
  const existing = await db
    .select({ id: listings.id, created_at: listings.created_at })
    .from(listings)
    .where(eq(listings.external_id, listing.external_id))
    .limit(1);

  if (existing.length === 0) {
    const result = await db.insert(listings).values(listing).returning({ id: listings.id });
    return { isNew: true, id: result[0].id };
  }

  const { external_id, source, ...mutableFields } = listing;
  await db
    .update(listings)
    .set(mutableFields)
    .where(eq(listings.external_id, listing.external_id));
  return { isNew: false, id: existing[0].id };
}

export async function findExistingExternalIds(
  db: Db,
  externalIds: string[],
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const rows = await db
    .select({ external_id: listings.external_id })
    .from(listings)
    .where(inArray(listings.external_id, externalIds));
  return new Set(rows.map((r) => r.external_id));
}

/**
 * Return external IDs that were scraped within the last `hours` hours.
 * Used to skip detail re-enrichment for recently-scraped listings in full mode.
 */
export async function findRecentlyScrapedIds(
  db: Db,
  externalIds: string[],
  hours: number,
): Promise<Set<string>> {
  if (externalIds.length === 0 || hours <= 0) return new Set();
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const rows = await db
    .select({ external_id: listings.external_id })
    .from(listings)
    .where(
      and(
        inArray(listings.external_id, externalIds),
        gte(listings.scraped_at, cutoff),
      ),
    );
  return new Set(rows.map((r) => r.external_id));
}

/**
 * SCR-09: TTL-based deactivation.
 * Deactivates active listings whose scraped_at is older than `ttlDays` days.
 * This catches stale listings that accumulate when running in incremental/watch mode.
 */
export async function deactivateByTtlListings(
  db: Db,
  ttlDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const result = await db
    .update(listings)
    .set({ is_active: false, deactivated_at: now })
    .where(
      and(
        eq(listings.is_active, true),
        lte(listings.scraped_at, cutoff),
      ),
    )
    .returning({ id: listings.id });

  return result.length;
}

/**
 * Cluster duplicate listings across sources using phone + geo + layout matching.
 * Assigns a shared `cluster_id` to rows that represent the same real-world property.
 * Marks exactly one row per cluster as `is_canonical = true` (lowest id).
 *
 * Two-phase approach:
 *   1. Phone-based: same seller_phone + layout within ~1 km  (high confidence)
 *   2. Geo-based:   same layout within ~10 m                 (no phone available)
 *
 * All rows stay is_active — nothing is deactivated.
 */
export async function clusterListings(
  db: Db,
): Promise<{ clustered: number; clusters: number }> {
  // Reset previous clustering so the pass is fully idempotent
  await db.execute(sql`
    UPDATE listings
    SET cluster_id = NULL, is_canonical = true
    WHERE cluster_id IS NOT NULL
  `);

  // Phase 1 — phone-based clustering
  // Same seller_phone + same layout + same ~1 km geo block = same apartment
  const phoneResult = await db.execute<{ id: number; cluster_id: string }>(sql`
    WITH phone_groups AS (
      SELECT id,
        MIN(id) OVER w AS canonical_id,
        md5(
          seller_phone || '|' || layout || '|' ||
          ROUND(latitude::numeric, 2)::text || '|' ||
          ROUND(longitude::numeric, 2)::text
        ) AS cluster_hash,
        COUNT(*) OVER w AS group_size
      FROM listings
      WHERE is_active = true
        AND seller_phone IS NOT NULL AND seller_phone <> ''
        AND layout IS NOT NULL
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      WINDOW w AS (
        PARTITION BY seller_phone, layout,
          ROUND(latitude::numeric, 2), ROUND(longitude::numeric, 2)
      )
    )
    UPDATE listings l
    SET
      cluster_id  = pg.cluster_hash,
      is_canonical = (l.id = pg.canonical_id)
    FROM phone_groups pg
    WHERE l.id = pg.id AND pg.group_size > 1
    RETURNING l.id, l.cluster_id
  `);

  const phoneRows = phoneResult as { id: number; cluster_id: string }[];
  const phoneClusters = new Set(phoneRows.map((r) => r.cluster_id));

  // Phase 2 — geo-based clustering (unclustered listings only)
  // Same layout within ~10 m (ROUND to 4 decimals ≈ 11 m)
  const geoResult = await db.execute<{ id: number; cluster_id: string }>(sql`
    WITH geo_groups AS (
      SELECT id,
        MIN(id) OVER w AS canonical_id,
        md5(
          'geo|' || layout || '|' ||
          ROUND(latitude::numeric, 4)::text || '|' ||
          ROUND(longitude::numeric, 4)::text
        ) AS cluster_hash,
        COUNT(*) OVER w AS group_size
      FROM listings
      WHERE is_active = true
        AND cluster_id IS NULL
        AND layout IS NOT NULL
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      WINDOW w AS (
        PARTITION BY layout,
          ROUND(latitude::numeric, 4), ROUND(longitude::numeric, 4)
      )
    )
    UPDATE listings l
    SET
      cluster_id  = gg.cluster_hash,
      is_canonical = (l.id = gg.canonical_id)
    FROM geo_groups gg
    WHERE l.id = gg.id AND gg.group_size > 1
    RETURNING l.id, l.cluster_id
  `);

  const geoRows = geoResult as { id: number; cluster_id: string }[];
  const geoClusters = new Set(geoRows.map((r) => r.cluster_id));

  return {
    clustered: phoneRows.length + geoRows.length,
    clusters: phoneClusters.size + geoClusters.size,
  };
}

/**
 * For a given listing, return all other listings in the same cluster.
 * Useful for the detail page "Available on N portals" panel.
 */
export async function getClusterSiblings(db: Db, listingId: number) {
  const [row] = await db
    .select({ cluster_id: listings.cluster_id })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);

  if (!row?.cluster_id) return [];

  return db
    .select({
      id: listings.id,
      source: listings.source,
      source_url: listings.source_url,
      price: listings.price,
      is_canonical: listings.is_canonical,
    })
    .from(listings)
    .where(
      and(
        eq(listings.cluster_id, row.cluster_id),
        eq(listings.is_active, true),
      ),
    )
    .orderBy(asc(listings.price));
}

export async function deactivateStaleListings(
  db: Db,
  source: string,
  seenIds: Set<string>,
): Promise<number> {
  if (seenIds.size === 0) return 0;

  const activeRows = await db
    .select({ external_id: listings.external_id })
    .from(listings)
    .where(and(eq(listings.source, source), eq(listings.is_active, true)));

  const staleIds = activeRows
    .map((r) => r.external_id)
    .filter((id) => !seenIds.has(id));

  if (staleIds.length === 0) return 0;

  const now = new Date().toISOString();
  const CHUNK = 500;
  let deactivated = 0;

  for (let i = 0; i < staleIds.length; i += CHUNK) {
    const chunk = staleIds.slice(i, i + CHUNK);
    await db
      .update(listings)
      .set({ is_active: false, deactivated_at: now })
      .where(inArray(listings.external_id, chunk));
    deactivated += chunk.length;
  }

  return deactivated;
}
