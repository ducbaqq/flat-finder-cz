import {
  and,
  asc,
  type Column,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { ListingFilters } from "@flat-finder/types";
import { listings, type ListingRow, type NewListing } from "../schema/listings.js";
import type { Db } from "../client.js";

export function buildWhereConditions(
  filters: ListingFilters,
  opts?: { includeInactive?: boolean },
): SQL[] {
  const conditions: SQL[] = [];

  if (!opts?.includeInactive) {
    conditions.push(eq(listings.is_active, true));
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
    const like = `%${filters.location}%`;
    conditions.push(
      or(
        ilike(listings.city, like),
        ilike(listings.district, like),
        ilike(listings.region, like),
        ilike(listings.address, like),
      )!,
    );
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
) {
  const page = filters.page ?? 1;
  const perPage = Math.min(filters.per_page ?? 20, 100);
  const offset = (page - 1) * perPage;

  const conditions = buildWhereConditions(filters, {
    includeInactive: filters.include_inactive,
  });
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult, rows] = await Promise.all([
    db.select({ count: count() }).from(listings).where(where),
    db
      .select()
      .from(listings)
      .where(where)
      .orderBy(getSortOrder(filters.sort))
      .limit(perPage)
      .offset(offset),
  ]);

  const total = totalResult[0]?.count ?? 0;

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
