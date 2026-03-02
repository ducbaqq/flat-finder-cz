import { Hono } from "hono";
import { and, isNotNull } from "drizzle-orm";
import {
  getDb,
  listings,
  buildWhereConditions,
} from "@flat-finder/db";
import type { ListingFilters, MarkerCluster, MarkerListing } from "@flat-finder/types";
import { parseNumericParam } from "../helpers.js";

const app = new Hono();

/**
 * GET /api/markers — Map markers with server-side clustering
 */
app.get("/", async (c) => {
  const db = getDb();
  const q = c.req.query();
  const zoom = parseInt(q.zoom ?? "7", 10) || 7;

  const filters: ListingFilters = {
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
    sw_lat: parseNumericParam(q.sw_lat),
    sw_lng: parseNumericParam(q.sw_lng),
    ne_lat: parseNumericParam(q.ne_lat),
    ne_lng: parseNumericParam(q.ne_lng),
    include_inactive:
      q.include_inactive === "true" || q.include_inactive === "1",
  };

  const conditions = buildWhereConditions(filters, {
    includeInactive: filters.include_inactive,
  });

  // Ensure lat/lng are present
  conditions.push(isNotNull(listings.latitude));
  conditions.push(isNotNull(listings.longitude));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: listings.id,
      title: listings.title,
      price: listings.price,
      thumbnail_url: listings.thumbnail_url,
      latitude: listings.latitude,
      longitude: listings.longitude,
      property_type: listings.property_type,
      transaction_type: listings.transaction_type,
      layout: listings.layout,
      size_m2: listings.size_m2,
      city: listings.city,
    })
    .from(listings)
    .where(where);

  // Server-side clustering algorithm
  const precision = Math.max(1, Math.min(5, zoom - 4));
  const factor = 10 ** precision;

  const clusters = new Map<string, MarkerCluster>();

  for (const row of rows) {
    const lat = row.latitude!;
    const lng = row.longitude!;
    const latKey = Math.round(lat * factor) / factor;
    const lngKey = Math.round(lng * factor) / factor;
    const key = `${latKey},${lngKey}`;

    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = {
        lat: latKey,
        lng: lngKey,
        count: 0,
        listings: [],
      };
      clusters.set(key, cluster);
    }

    cluster.count += 1;

    if (cluster.listings.length < 5) {
      const markerListing: MarkerListing = {
        id: row.id,
        title: row.title,
        price: row.price,
        thumbnail_url: row.thumbnail_url,
        property_type: row.property_type as MarkerListing["property_type"],
        transaction_type: row.transaction_type as MarkerListing["transaction_type"],
        layout: row.layout,
        size_m2: row.size_m2,
        city: row.city,
        lat,
        lng,
      };
      cluster.listings.push(markerListing);
    }
  }

  const markers = Array.from(clusters.values());
  return c.json({ markers, total: rows.length });
});

export default app;
