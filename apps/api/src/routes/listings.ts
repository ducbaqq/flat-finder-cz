import { Hono } from "hono";
import { getDb, queryListings, getListingById } from "@flat-finder/db";
import type { ListingFilters } from "@flat-finder/types";
import { rowToListing, parseNumericParam } from "../helpers.js";

const app = new Hono();

// ── Cached total counts per filter-hash with 5-min TTL ──
const countCache = new Map<string, { count: number; ts: number }>();
const COUNT_CACHE_TTL = 5 * 60_000; // 5 minutes
const MAX_COUNT_CACHE = 200;

// ── Allowed sort values (API-10) ──
const ALLOWED_SORTS = new Set<string>(["newest", "price_asc", "price_desc", "size_asc", "size_desc"]);

// ── Allowed enum values for input validation (API-12) ──
const ALLOWED_PROPERTY_TYPES = new Set<string>(["flat", "house", "land", "commercial", "garage", "other", "cottage", "residential_building"]);
const ALLOWED_TRANSACTION_TYPES = new Set<string>(["rent", "sale", "auction", "flatshare"]);
const ALLOWED_SOURCES = new Set<string>(["sreality", "bezrealitky", "ulovdomov", "bazos", "ereality", "eurobydleni", "ceskereality", "realitymix", "idnes", "realingo"]);
const MAX_FREE_TEXT_LENGTH = 200;

/** Build a stable cache key from filter params (excludes page/per_page/sort). */
function buildFilterHash(filters: ListingFilters): string {
  const parts: string[] = [];
  const keys: (keyof ListingFilters)[] = [
    "property_type", "transaction_type", "city", "region", "source", "layout",
    "condition", "construction", "ownership", "furnishing", "energy_rating",
    "amenities", "location", "include_inactive",
  ];
  for (const k of keys) {
    const v = filters[k];
    if (v != null && v !== false && v !== "") parts.push(`${k}=${v}`);
  }
  for (const k of ["price_min", "price_max", "size_min", "size_max", "sw_lat", "sw_lng", "ne_lat", "ne_lng"] as const) {
    const v = filters[k];
    if (v != null) parts.push(`${k}=${v}`);
  }
  return parts.join("&") || "__unfiltered__";
}

/** Validate comma-separated enum values. Returns true if all values are in the allowed set. */
function validateEnumParam(value: string | undefined, allowed: Set<string>): boolean {
  if (!value) return true;
  return value.split(",").every((v) => allowed.has(v.trim()));
}

/** Trim and limit free-text filter parameters. */
function sanitizeFreeText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > MAX_FREE_TEXT_LENGTH ? trimmed.slice(0, MAX_FREE_TEXT_LENGTH) : trimmed || undefined;
}

/**
 * GET /api/listings — Paginated listings with comprehensive filters
 */
app.get("/", async (c) => {
  const db = getDb();
  const q = c.req.query();

  // ── API-10: Validate sort param ──
  if (q.sort && !ALLOWED_SORTS.has(q.sort)) {
    return c.json(
      { error: `Invalid sort parameter. Allowed: ${[...ALLOWED_SORTS].join(", ")}` },
      400,
    );
  }

  // ── API-12: Validate enum filter params ──
  if (!validateEnumParam(q.property_type, ALLOWED_PROPERTY_TYPES)) {
    return c.json({ error: `Invalid property_type. Allowed: ${[...ALLOWED_PROPERTY_TYPES].join(", ")}` }, 400);
  }
  if (!validateEnumParam(q.transaction_type, ALLOWED_TRANSACTION_TYPES)) {
    return c.json({ error: `Invalid transaction_type. Allowed: ${[...ALLOWED_TRANSACTION_TYPES].join(", ")}` }, 400);
  }
  if (!validateEnumParam(q.source, ALLOWED_SOURCES)) {
    return c.json({ error: `Invalid source. Allowed: ${[...ALLOWED_SOURCES].join(", ")}` }, 400);
  }

  const filters: ListingFilters = {
    page: parseInt(q.page ?? "1", 10) || 1,
    per_page: parseInt(q.per_page ?? "20", 10) || 20,
    property_type: q.property_type || undefined,
    transaction_type: q.transaction_type || undefined,
    city: sanitizeFreeText(q.city),
    region: sanitizeFreeText(q.region),
    source: q.source || undefined,
    layout: q.layout || undefined,
    condition: q.condition || undefined,
    construction: q.construction || undefined,
    ownership: q.ownership || undefined,
    furnishing: q.furnishing || undefined,
    energy_rating: q.energy_rating || undefined,
    amenities: q.amenities || undefined,
    location: sanitizeFreeText(q.location),
    price_min: parseNumericParam(q.price_min),
    price_max: parseNumericParam(q.price_max),
    size_min: parseNumericParam(q.size_min),
    size_max: parseNumericParam(q.size_max),
    sort: q.sort as ListingFilters["sort"],
    sw_lat: parseNumericParam(q.sw_lat),
    sw_lng: parseNumericParam(q.sw_lng),
    ne_lat: parseNumericParam(q.ne_lat),
    ne_lng: parseNumericParam(q.ne_lng),
    include_inactive: q.include_inactive === "true" || q.include_inactive === "1",
  };

  // ── API-01: Cache filtered counts per filter-hash with 5-min TTL ──
  const filterHash = buildFilterHash(filters);
  const cachedEntry = countCache.get(filterHash);
  const now = Date.now();
  const cachedTotal = cachedEntry && now - cachedEntry.ts < COUNT_CACHE_TTL
    ? cachedEntry.count
    : undefined;

  let result;
  try {
    result = await queryListings(db, filters, {
      cachedTotal,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const causeMessage = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
    if (
      message.includes("canceling statement") || message.includes("statement timeout") ||
      causeMessage.includes("canceling statement") || causeMessage.includes("statement timeout")
    ) {
      return c.json(
        { error: "Query timed out. Try narrowing your filters.", listings: [], total: 0, page: 1, per_page: 20, total_pages: 1 },
        408,
      );
    }
    throw err;
  }

  // Store the count in cache for this filter combination
  if (cachedTotal == null) {
    if (countCache.size >= MAX_COUNT_CACHE) {
      // Evict oldest entry
      const oldest = countCache.keys().next().value;
      if (oldest) countCache.delete(oldest);
    }
    countCache.set(filterHash, { count: result.total, ts: now });
  }

  return c.json({
    listings: result.listings.map(rowToListing),
    total: result.total,
    page: result.page,
    per_page: result.per_page,
    total_pages: result.total_pages,
  });
});

/**
 * GET /api/listings/:id — Single listing detail
 */
app.get("/:id", async (c) => {
  const db = getDb();
  const id = parseInt(c.req.param("id"), 10);

  if (isNaN(id)) {
    return c.json({ error: "Invalid listing ID" }, 400);
  }

  const row = await getListingById(db, id);
  if (!row) {
    return c.json({ error: "Listing not found" }, 404);
  }

  return c.json(rowToListing(row));
});

export default app;
