import { Hono } from "hono";
import { getDb, queryListings, getListingById } from "@flat-finder/db";
import type { ListingFilters } from "@flat-finder/types";
import { rowToListing, parseNumericParam } from "../helpers.js";

const app = new Hono();

/**
 * GET /api/listings — Paginated listings with comprehensive filters
 */
app.get("/", async (c) => {
  const db = getDb();
  const q = c.req.query();

  const filters: ListingFilters = {
    page: parseInt(q.page ?? "1", 10) || 1,
    per_page: parseInt(q.per_page ?? "20", 10) || 20,
    property_type: q.property_type || undefined,
    transaction_type: q.transaction_type || undefined,
    city: q.city || undefined,
    region: q.region || undefined,
    source: q.source || undefined,
    layout: q.layout || undefined,
    condition: q.condition || undefined,
    construction: q.construction || undefined,
    ownership: q.ownership || undefined,
    furnishing: q.furnishing || undefined,
    energy_rating: q.energy_rating || undefined,
    amenities: q.amenities || undefined,
    location: q.location || undefined,
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

  const result = await queryListings(db, filters);

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
