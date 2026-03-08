import { Hono } from "hono";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import Supercluster from "supercluster";
import {
  getDb,
  listings,
  buildWhereConditions,
} from "@flat-finder/db";
import type { ListingFilters, ClusterPoint, MarkerPoint, MarkersResponse } from "@flat-finder/types";
import { parseNumericParam } from "../helpers.js";

const app = new Hono();

// ── Configuration ──

/** Zoom at which server returns individual points instead of clusters */
const INDIVIDUAL_ZOOM_THRESHOLD = 17;

/** Safety cap for individual marker queries */
const MAX_INDIVIDUAL_MARKERS = 5_000;

/** How often to refresh the full-dataset Supercluster index */
const INDEX_REFRESH_MS = 5 * 60_000; // 5 minutes

// ── Server-side Supercluster index (for unfiltered requests) ──

type PointProps = { id: number; price: number | null };

let scIndex: Supercluster<PointProps> | null = null;
let scIndexTs = 0;
let scIndexLoading: Promise<void> | null = null;
let scPointCount = 0;

async function ensureIndex(): Promise<Supercluster<PointProps>> {
  const now = Date.now();
  if (scIndex && now - scIndexTs < INDEX_REFRESH_MS) return scIndex;

  // Prevent multiple parallel loads
  if (scIndexLoading) {
    await scIndexLoading;
    return scIndex!;
  }

  scIndexLoading = (async () => {
    const db = getDb();
    console.log("[markers] Loading Supercluster index…");
    const start = performance.now();

    const rows = await db
      .select({
        id: listings.id,
        lat: listings.latitude,
        lng: listings.longitude,
        price: listings.price,
      })
      .from(listings)
      .where(and(eq(listings.is_active, true), isNotNull(listings.latitude), isNotNull(listings.longitude)));

    const sc = new Supercluster<PointProps>({
      radius: 80,
      maxZoom: INDIVIDUAL_ZOOM_THRESHOLD - 1,
      minPoints: 2,
    });

    const points: Supercluster.PointFeature<PointProps>[] = rows.map((r) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [r.lng!, r.lat!] },
      properties: { id: r.id, price: r.price },
    }));

    sc.load(points);
    scIndex = sc;
    scIndexTs = Date.now();
    scPointCount = rows.length;

    console.log(`[markers] Supercluster index built: ${rows.length} points in ${((performance.now() - start) / 1000).toFixed(1)}s`);
  })();

  try {
    await scIndexLoading;
  } finally {
    scIndexLoading = null;
  }

  return scIndex!;
}

// ── SQL clustering fallback (for filtered requests) ──

const sqlCache = new Map<string, { data: MarkersResponse; ts: number }>();
const SQL_CACHE_TTL = 5 * 60_000;
const MAX_SQL_CACHE = 100;

function getClusterPrecision(zoom: number): number {
  if (zoom <= 7) return 0;   // ~111 km grid
  if (zoom <= 9) return 1;   // ~11 km grid
  if (zoom <= 12) return 2;  // ~1.1 km grid
  return 3;                   // ~110 m grid
}

function buildCacheKey(q: Record<string, string>): string {
  return Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

// ── Helpers ──

function hasContentFilters(filters: ListingFilters): boolean {
  return !!(
    filters.property_type || filters.transaction_type || filters.city ||
    filters.region || filters.source || filters.layout || filters.condition ||
    filters.construction || filters.ownership || filters.furnishing ||
    filters.energy_rating || filters.amenities || filters.location ||
    filters.price_min != null || filters.price_max != null ||
    filters.size_min != null || filters.size_max != null ||
    filters.include_inactive
  );
}

/**
 * GET /api/markers — Map points with server-side clustering
 *
 * Unfiltered: queries a pre-built Supercluster in-memory index (~ms).
 * Filtered:   SQL GROUP BY ROUND(lat/lng), cached 5 min.
 * High zoom:  individual points (capped at 5k).
 */
app.get("/", async (c) => {
  const q = c.req.query();

  const sw_lat = parseNumericParam(q.sw_lat);
  const sw_lng = parseNumericParam(q.sw_lng);
  const ne_lat = parseNumericParam(q.ne_lat);
  const ne_lng = parseNumericParam(q.ne_lng);
  const zoom = Math.floor(parseNumericParam(q.zoom) ?? 12);

  const emptyResponse: MarkersResponse = { markers: [], clusters: [], total: 0, clustered: false };

  if (sw_lat == null || sw_lng == null || ne_lat == null || ne_lng == null) {
    return c.json(emptyResponse);
  }

  const bbox: [number, number, number, number] = [sw_lng, sw_lat, ne_lng, ne_lat];

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
    sw_lat, sw_lng, ne_lat, ne_lng,
    include_inactive: q.include_inactive === "true" || q.include_inactive === "1",
  };

  const filtered = hasContentFilters(filters);

  // ── Fast path: unfiltered → Supercluster in-memory index ──
  if (!filtered) {
    const index = await ensureIndex();

    const features = index.getClusters(bbox, zoom);

    const clusters: ClusterPoint[] = [];
    const markers: MarkerPoint[] = [];

    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates;
      const props = f.properties;

      if ("cluster" in props && props.cluster) {
        clusters.push({
          lat,
          lng,
          count: props.point_count,
          avg_price: null, // Supercluster doesn't aggregate properties
        });
      } else {
        const pt = props as PointProps;
        markers.push({ id: pt.id, lat, lng, price: pt.price });
      }
    }

    const isClustered = clusters.length > 0;
    const total = clusters.reduce((s, cl) => s + cl.count, 0) + markers.length;

    c.header("X-Cache", "SC");
    c.header("X-SC-Points", String(scPointCount));
    return c.json({ markers, clusters, total, clustered: isClustered } satisfies MarkersResponse);
  }

  // ── Slow path: filtered → SQL GROUP BY with caching ──
  const cacheKey = buildCacheKey(q);
  const cached = sqlCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SQL_CACHE_TTL) {
    c.header("X-Cache", "HIT");
    return c.json(cached.data);
  }

  const db = getDb();
  const conditions = buildWhereConditions(filters, { includeInactive: filters.include_inactive });
  conditions.push(isNotNull(listings.latitude));
  conditions.push(isNotNull(listings.longitude));
  const where = and(...conditions);

  if (zoom >= INDIVIDUAL_ZOOM_THRESHOLD) {
    // Individual points at very high zoom
    const rows = await db
      .select({ id: listings.id, lat: listings.latitude, lng: listings.longitude, price: listings.price })
      .from(listings)
      .where(where)
      .limit(MAX_INDIVIDUAL_MARKERS);

    const markers: MarkerPoint[] = rows.map((r) => ({ id: r.id, lat: r.lat!, lng: r.lng!, price: r.price }));
    const response: MarkersResponse = { markers, clusters: [], total: markers.length, clustered: false };

    sqlCache.set(cacheKey, { data: response, ts: Date.now() });
    return c.json(response);
  }

  // SQL clustering
  const precision = getClusterPrecision(zoom);
  const roundLat = sql`ROUND(${listings.latitude}::numeric, ${sql.raw(String(precision))})`;
  const roundLng = sql`ROUND(${listings.longitude}::numeric, ${sql.raw(String(precision))})`;

  const rows = await db
    .select({
      lat: sql<number>`${roundLat}::float8`,
      lng: sql<number>`${roundLng}::float8`,
      count: count(),
      avg_price: sql<number | null>`AVG(${listings.price})::float8`,
    })
    .from(listings)
    .where(where)
    .groupBy(roundLat, roundLng);

  const sqlClusters: ClusterPoint[] = rows.map((r) => ({
    lat: r.lat,
    lng: r.lng,
    count: r.count,
    avg_price: r.avg_price,
  }));

  const total = sqlClusters.reduce((sum, cl) => sum + cl.count, 0);
  const response: MarkersResponse = { markers: [], clusters: sqlClusters, total, clustered: true };

  // Cache
  if (sqlCache.size >= MAX_SQL_CACHE) {
    const oldest = sqlCache.keys().next().value;
    if (oldest) sqlCache.delete(oldest);
  }
  sqlCache.set(cacheKey, { data: response, ts: Date.now() });
  c.header("X-Cache", "MISS");

  return c.json(response);
});

/** Pre-warm the Supercluster index. Called from server startup. */
export async function warmMarkerIndex(): Promise<void> {
  await ensureIndex();
}

export default app;
