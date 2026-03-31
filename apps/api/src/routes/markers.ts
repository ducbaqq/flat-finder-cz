import { Hono } from "hono";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, listings } from "@flat-finder/db";
import type { ListingFilters, ClusterPoint, MarkerPoint, MarkersResponse, ListingCardData, ListingCardResponse } from "@flat-finder/types";
import Supercluster from "supercluster";
import { parseNumericParam } from "../helpers.js";
import {
  getClusters as scGetClusters,
  getExpansionZoom,
  startClusterRefresh,
  stopClusterRefresh,
  isReady,
  getPointsInBbox,
} from "../services/cluster-index.js";
import type { PointProps } from "../services/cluster-index.js";

const app = new Hono();

// ── Configuration ──

/** Zoom at which server returns individual points instead of clusters */
const INDIVIDUAL_ZOOM_THRESHOLD = 17;

/** Safety cap for individual marker queries */
const MAX_INDIVIDUAL_MARKERS = 5_000;

/** Max points to fetch for filtered requests */
const MAX_FILTERED_POINTS = 1_000;

// ── Cache for filtered marker requests ──
const filteredCache = new Map<string, { data: MarkersResponse; ts: number }>();
const FILTERED_CACHE_TTL = 60_000; // 1 minute
const MAX_FILTERED_CACHE = 100;

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

// ── Sort helper for /listings endpoint ──

type SortOption = "newest" | "price_asc" | "price_desc" | "size_asc" | "size_desc";

function sortPoints(points: PointProps[], sort: SortOption): PointProps[] {
  const copy = [...points];
  switch (sort) {
    case "price_asc":
      return copy.sort((a, b) => {
        if (a.price == null && b.price == null) return 0;
        if (a.price == null) return 1;
        if (b.price == null) return -1;
        return a.price - b.price;
      });
    case "price_desc":
      return copy.sort((a, b) => {
        if (a.price == null && b.price == null) return 0;
        if (a.price == null) return 1;
        if (b.price == null) return -1;
        return b.price - a.price;
      });
    case "size_asc":
      return copy.sort((a, b) => {
        if (a.size_m2 == null && b.size_m2 == null) return 0;
        if (a.size_m2 == null) return 1;
        if (b.size_m2 == null) return -1;
        return a.size_m2 - b.size_m2;
      });
    case "size_desc":
      return copy.sort((a, b) => {
        if (a.size_m2 == null && b.size_m2 == null) return 0;
        if (a.size_m2 == null) return 1;
        if (b.size_m2 == null) return -1;
        return b.size_m2 - a.size_m2;
      });
    case "newest":
    default:
      return copy.sort((a, b) => {
        const da = a.listed_at ?? "";
        const db_ = b.listed_at ?? "";
        return db_.localeCompare(da); // desc
      });
  }
}

/** Convert Supercluster GeoJSON features to our response types. */
function formatSuperclusterResults(
  features: GeoJSON.Feature<GeoJSON.Point>[],
): { clusters: ClusterPoint[]; markers: MarkerPoint[] } {
  const clusters: ClusterPoint[] = [];
  const markers: MarkerPoint[] = [];

  for (const f of features) {
    const [lng, lat] = f.geometry.coordinates;
    const props = f.properties as Record<string, unknown>;

    if (props.cluster) {
      clusters.push({
        lat,
        lng,
        count: props.point_count as number,
        avg_price: null,
        cluster_id: props.cluster_id as number,
        expansion_zoom: undefined, // fetched on-demand via /expansion-zoom
      });
    } else {
      markers.push({
        id: props.id as number,
        lat,
        lng,
        price: (props.price as number) ?? null,
        title: (props.title as string) ?? null,
        thumbnail_url: (props.thumbnail_url as string) ?? null,
        address: (props.address as string) ?? null,
        city: (props.city as string) ?? null,
        currency: (props.currency as string) ?? "CZK",
        size_m2: (props.size_m2 as number) ?? null,
        layout: (props.layout as string) ?? null,
        floor: (props.floor as number) ?? null,
        property_type: (props.property_type as string) ?? "other",
        transaction_type: (props.transaction_type as string) ?? "sale",
        source: (props.source as string) ?? "sreality",
        listed_at: (props.listed_at as string) ?? null,
      });
    }
  }

  return { clusters, markers };
}

/**
 * GET /api/markers — Map points with Supercluster-based clustering
 *
 * Unfiltered: uses pre-built global Supercluster index (sub-ms queries).
 * Filtered:   builds a temporary Supercluster from filtered DB results.
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

  // ── Fast path: unfiltered → global Supercluster index ──
  if (!filtered) {
    if (!isReady()) {
      return c.json(emptyResponse);
    }

    // High zoom: individual points from DB (for titles/thumbnails)
    if (zoom >= INDIVIDUAL_ZOOM_THRESHOLD) {
      const db = getDb();
      const rows = await db
        .select({
          id: listings.id,
          lat: listings.latitude,
          lng: listings.longitude,
          price: listings.price,
          title: listings.title,
          thumbnail_url: listings.thumbnail_url,
          address: listings.address,
          city: listings.city,
          currency: listings.currency,
          size_m2: listings.size_m2,
          layout: listings.layout,
          floor: listings.floor,
          property_type: listings.property_type,
          transaction_type: listings.transaction_type,
          source: listings.source,
          listed_at: listings.listed_at,
        })
        .from(listings)
        .where(
          and(
            eq(listings.is_active, true),
            isNotNull(listings.latitude),
            isNotNull(listings.longitude),
            sql`${listings.latitude} >= ${sw_lat}`,
            sql`${listings.latitude} <= ${ne_lat}`,
            sql`${listings.longitude} >= ${sw_lng}`,
            sql`${listings.longitude} <= ${ne_lng}`,
          ),
        )
        .limit(MAX_INDIVIDUAL_MARKERS);

      const markers: MarkerPoint[] = rows.map((r) => ({
        id: r.id,
        lat: r.lat!,
        lng: r.lng!,
        price: r.price,
        title: r.title,
        thumbnail_url: r.thumbnail_url,
        address: r.address ?? null,
        city: r.city ?? null,
        currency: r.currency ?? "CZK",
        size_m2: r.size_m2 ?? null,
        layout: r.layout ?? null,
        floor: r.floor ?? null,
        property_type: r.property_type ?? "other",
        transaction_type: r.transaction_type ?? "sale",
        source: r.source ?? "sreality",
        listed_at: r.listed_at ?? null,
      }));
      return c.json({ markers, clusters: [], total: markers.length, clustered: false });
    }

    // Supercluster query — sub-millisecond
    const features = scGetClusters(bbox, zoom);
    const { clusters, markers } = formatSuperclusterResults(features);
    const total = clusters.reduce((s, cl) => s + cl.count, 0) + markers.length;

    return c.json({ markers, clusters, total, clustered: clusters.length > 0 });
  }

  // ── Filtered path: build temporary Supercluster from filtered results ──

  const cacheKey = buildCacheKey(q);
  const cached = filteredCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FILTERED_CACHE_TTL) {
    c.header("X-Cache", "HIT");
    return c.json(cached.data);
  }

  const db = getDb();
  const pointLimit = zoom >= INDIVIDUAL_ZOOM_THRESHOLD ? MAX_INDIVIDUAL_MARKERS : MAX_FILTERED_POINTS;

  // Index-friendly WHERE clause
  const indexConditions = [];
  if (!filters.include_inactive) {
    indexConditions.push(eq(listings.is_active, true));
  }
  if (filters.property_type) {
    indexConditions.push(eq(listings.property_type, filters.property_type));
  }
  if (filters.transaction_type) {
    indexConditions.push(eq(listings.transaction_type, filters.transaction_type));
  }
  indexConditions.push(isNotNull(listings.latitude));
  indexConditions.push(isNotNull(listings.longitude));
  indexConditions.push(sql`${listings.latitude} >= ${sw_lat}`);
  indexConditions.push(sql`${listings.latitude} <= ${ne_lat}`);
  indexConditions.push(sql`${listings.longitude} >= ${sw_lng}`);
  indexConditions.push(sql`${listings.longitude} <= ${ne_lng}`);

  const rawRows = await db
    .select({
      id: listings.id,
      lat: listings.latitude,
      lng: listings.longitude,
      price: listings.price,
      size_m2: listings.size_m2,
      title: listings.title,
      thumbnail_url: listings.thumbnail_url,
      address: listings.address,
      city: listings.city,
      currency: listings.currency,
      layout: listings.layout,
      floor: listings.floor,
      property_type: listings.property_type,
      transaction_type: listings.transaction_type,
      source: listings.source,
      listed_at: listings.listed_at,
    })
    .from(listings)
    .where(and(...indexConditions))
    .limit(pointLimit);

  // Apply remaining filters in-memory
  const rows = rawRows.filter((r) => {
    if (filters.price_min != null && (r.price == null || r.price < filters.price_min)) return false;
    if (filters.price_max != null && (r.price == null || r.price > filters.price_max)) return false;
    if (filters.size_min != null && (r.size_m2 == null || r.size_m2 < filters.size_min)) return false;
    if (filters.size_max != null && (r.size_m2 == null || r.size_m2 > filters.size_max)) return false;
    return true;
  });

  let response: MarkersResponse;

  if (zoom >= INDIVIDUAL_ZOOM_THRESHOLD || rows.length <= 50) {
    // Few results or high zoom: return individual markers
    const markers: MarkerPoint[] = rows.map((r) => ({
      id: r.id,
      lat: r.lat!,
      lng: r.lng!,
      price: r.price,
      title: r.title,
      thumbnail_url: r.thumbnail_url,
      address: r.address ?? null,
      city: r.city ?? null,
      currency: r.currency ?? "CZK",
      size_m2: r.size_m2 ?? null,
      layout: r.layout ?? null,
      floor: r.floor ?? null,
      property_type: r.property_type ?? "other",
      transaction_type: r.transaction_type ?? "sale",
      source: r.source ?? "sreality",
      listed_at: r.listed_at ?? null,
    }));
    response = { markers, clusters: [], total: markers.length, clustered: false };
  } else {
    // Build a temporary Supercluster from filtered points
    const features: GeoJSON.Feature<GeoJSON.Point, PointProps>[] = [];
    for (const r of rows) {
      if (r.lat == null || r.lng == null) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        properties: {
          id: r.id,
          price: r.price,
          title: r.title ?? null,
          address: r.address ?? r.city ?? null,
          city: r.city ?? null,
          currency: r.currency ?? "CZK",
          size_m2: r.size_m2 ?? null,
          layout: r.layout ?? null,
          floor: r.floor ?? null,
          property_type: r.property_type ?? "other",
          transaction_type: r.transaction_type ?? "sale",
          source: r.source ?? "sreality",
          listed_at: r.listed_at ?? null,
          thumbnail_url: r.thumbnail_url ?? null,
        },
      });
    }

    const tempSc = new Supercluster<PointProps>({
      radius: 160,
      maxZoom: 16,
      minPoints: 2,
    });
    tempSc.load(features);

    const scFeatures = tempSc.getClusters(bbox, zoom);
    const { clusters, markers } = formatSuperclusterResults(scFeatures);
    const total = clusters.reduce((s, cl) => s + cl.count, 0) + markers.length;
    response = { markers, clusters, total, clustered: clusters.length > 0 };
  }

  // Cache
  if (filteredCache.size >= MAX_FILTERED_CACHE) {
    const oldest = filteredCache.keys().next().value;
    if (oldest) filteredCache.delete(oldest);
  }
  filteredCache.set(cacheKey, { data: response, ts: Date.now() });
  c.header("X-Cache", "MISS");

  return c.json(response);
});

/**
 * GET /api/markers/listings — Instant listing cards from Supercluster index.
 * Zero DB I/O. Used for unfiltered map-bounded views.
 */
app.get("/listings", (c) => {
  const q = c.req.query();

  const sw_lat = parseNumericParam(q.sw_lat);
  const sw_lng = parseNumericParam(q.sw_lng);
  const ne_lat = parseNumericParam(q.ne_lat);
  const ne_lng = parseNumericParam(q.ne_lng);
  const page = parseInt(q.page ?? "1", 10) || 1;
  const perPage = Math.min(parseInt(q.per_page ?? "20", 10) || 20, 100);
  const sort = (q.sort as SortOption) || "newest";

  if (sw_lat == null || sw_lng == null || ne_lat == null || ne_lng == null) {
    return c.json({ listings: [], total: 0, page: 1, per_page: perPage, total_pages: 1 });
  }

  if (!isReady()) {
    return c.json({ listings: [], total: 0, page: 1, per_page: perPage, total_pages: 1 });
  }

  const bbox: [number, number, number, number] = [sw_lng, sw_lat, ne_lng, ne_lat];
  const features = getPointsInBbox(bbox);

  // Extract properties (skip any clusters that leak through)
  const points: PointProps[] = [];
  for (const f of features) {
    const props = f.properties as unknown as Record<string, unknown>;
    if (props.cluster) continue;
    points.push(f.properties as PointProps);
  }

  const sorted = sortPoints(points, sort);
  const total = sorted.length;
  const offset = (page - 1) * perPage;
  const pageItems = sorted.slice(offset, offset + perPage);

  const listings: ListingCardData[] = pageItems.map((p) => ({
    id: p.id,
    title: p.title,
    address: p.address,
    city: p.city,
    price: p.price,
    currency: p.currency,
    size_m2: p.size_m2,
    layout: p.layout,
    floor: p.floor,
    property_type: p.property_type,
    transaction_type: p.transaction_type,
    source: p.source,
    listed_at: p.listed_at,
    thumbnail_url: p.thumbnail_url,
  }));

  const response: ListingCardResponse = {
    listings,
    total,
    page,
    per_page: perPage,
    total_pages: total > 0 ? Math.ceil(total / perPage) : 1,
  };

  return c.json(response);
});

/**
 * GET /api/markers/expansion-zoom/:clusterId — Get the zoom level that splits a cluster.
 */
app.get("/expansion-zoom/:clusterId", (c) => {
  const clusterId = Number(c.req.param("clusterId"));
  if (isNaN(clusterId)) return c.json({ zoom: 18 });
  const zoom = getExpansionZoom(clusterId);
  return c.json({ zoom });
});

/**
 * GET /api/markers/preview/:id — Lightweight hover preview for a single listing.
 */
const previewCache = new Map<number, { title: string | null; thumbnail_url: string | null }>();
const MAX_PREVIEW_CACHE = 2_000;

app.get("/preview/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!id || isNaN(id)) return c.json({ title: null, thumbnail_url: null });

  const cached = previewCache.get(id);
  if (cached) {
    c.header("X-Cache", "HIT");
    return c.json(cached);
  }

  const db = getDb();
  const [row] = await db
    .select({ title: listings.title, thumbnail_url: listings.thumbnail_url })
    .from(listings)
    .where(eq(listings.id, id))
    .limit(1);

  const result = row ?? { title: null, thumbnail_url: null };

  if (previewCache.size >= MAX_PREVIEW_CACHE) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
  previewCache.set(id, result);

  return c.json(result);
});

// ── Exports for server lifecycle ──

export { startClusterRefresh as startMarkerRefresh, stopClusterRefresh as stopMarkerRefresh };

/** Backwards-compat stub. */
export async function warmMarkerIndex(): Promise<void> {
  console.log("[markers] Using Supercluster index (built in background).");
}

export default app;
