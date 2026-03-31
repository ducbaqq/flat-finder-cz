/**
 * Supercluster-based spatial index for map clustering.
 *
 * Builds a KD-tree over all active listing coordinates once,
 * then serves viewport+zoom queries in sub-millisecond time.
 * Rebuilt every 15 minutes to pick up new/deactivated listings.
 *
 * On build, the raw GeoJSON features are persisted to disk so that
 * restarts can load them instantly (~1-2s) instead of querying the
 * DB (~115s for 350K+ rows). The DB rebuild still runs in the
 * background after the cached snapshot is loaded.
 */

import { mkdir } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline";
import Supercluster from "supercluster";
import { getDb, listings } from "@flat-finder/db";
import { and, eq, isNotNull } from "drizzle-orm";

// ── Types ──

export interface PointProps {
  id: number;
  price: number | null;
  title: string | null;
  address: string | null;
  city: string | null;
  currency: string;
  size_m2: number | null;
  layout: string | null;
  floor: number | null;
  property_type: string;
  transaction_type: string;
  source: string;
  listed_at: string | null;
  thumbnail_url: string | null;
}

type SC = Supercluster<PointProps, Supercluster.AnyProps>;

// ── Singleton ──

let index: SC | null = null;
let buildTimer: ReturnType<typeof setInterval> | null = null;
let isBuilding = false;

// ── Cache file path ──

const CACHE_DIR = join(
  process.env.CLUSTER_CACHE_DIR || join(process.cwd(), ".cache"),
);
const CACHE_FILE = join(CACHE_DIR, "cluster-features.ndjson");

// ── Supercluster config (shared) ──

const SC_OPTIONS: Supercluster.Options<PointProps, Supercluster.AnyProps> = {
  radius: 220,
  maxZoom: 16,
  minZoom: 0,
  minPoints: 2,
};

// ── Disk cache helpers ──

async function loadFromDisk(): Promise<boolean> {
  try {
    const t0 = Date.now();
    const features: GeoJSON.Feature<GeoJSON.Point, PointProps>[] = [];

    const rl = createInterface({
      input: createReadStream(CACHE_FILE, "utf-8"),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (line) features.push(JSON.parse(line));
    }

    if (features.length === 0) return false;

    const sc = new Supercluster<PointProps>(SC_OPTIONS);
    sc.load(features);
    index = sc;

    console.log(
      `[cluster-index] Loaded from disk cache: ${features.length} points in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    return true;
  } catch {
    return false;
  }
}

async function saveToDisk(
  features: GeoJSON.Feature<GeoJSON.Point, PointProps>[],
): Promise<void> {
  try {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    // Stream NDJSON to disk — one feature per line to avoid OOM
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(CACHE_FILE);
      ws.on("error", reject);
      for (const f of features) {
        ws.write(JSON.stringify(f) + "\n");
      }
      ws.end(() => resolve());
    });
    console.log(`[cluster-index] Saved ${features.length} points to disk cache`);
  } catch (err) {
    console.error("[cluster-index] Failed to save disk cache:", err);
  }
}

// ── Public API ──

export async function buildClusterIndex(): Promise<void> {
  if (isBuilding) return;
  isBuilding = true;
  const t0 = Date.now();

  try {
    const db = getDb();

    const rows = await db
      .select({
        id: listings.id,
        lat: listings.latitude,
        lng: listings.longitude,
        price: listings.price,
        title: listings.title,
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
        thumbnail_url: listings.thumbnail_url,
      })
      .from(listings)
      .where(
        and(
          eq(listings.is_active, true),
          isNotNull(listings.latitude),
          isNotNull(listings.longitude),
        ),
      );

    const features: GeoJSON.Feature<GeoJSON.Point, PointProps>[] = [];
    for (const r of rows) {
      if (r.lat == null || r.lng == null) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        properties: {
          id: r.id,
          price: r.price,
          title: r.title,
          address: r.address ?? r.city,
          city: r.city,
          currency: r.currency ?? "CZK",
          size_m2: r.size_m2,
          layout: r.layout,
          floor: r.floor,
          property_type: r.property_type,
          transaction_type: r.transaction_type,
          source: r.source,
          listed_at: r.listed_at,
          thumbnail_url: r.thumbnail_url,
        },
      });
    }

    const sc = new Supercluster<PointProps>(SC_OPTIONS);
    sc.load(features);

    // Atomic swap
    index = sc;
    console.log(
      `[cluster-index] Built from DB: ${features.length} points in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    // Persist to disk for fast restarts
    saveToDisk(features);
  } catch (err) {
    console.error(`[cluster-index] Build failed:`, err);
  } finally {
    isBuilding = false;
  }
}

/**
 * Get clusters for a given viewport bounding box and zoom level.
 * bbox: [westLng, southLat, eastLng, northLat]
 */
export function getClusters(
  bbox: [number, number, number, number],
  zoom: number,
): GeoJSON.Feature<GeoJSON.Point>[] {
  if (!index) return [];
  return index.getClusters(bbox, Math.floor(zoom));
}

/** Get all individual points in a bounding box (no clusters). */
export function getPointsInBbox(
  bbox: [number, number, number, number],
): GeoJSON.Feature<GeoJSON.Point, PointProps>[] {
  if (!index) return [];
  // Query at maxZoom+1 to force all points to be returned individually
  return index.getClusters(bbox, 17) as GeoJSON.Feature<GeoJSON.Point, PointProps>[];
}

/** Get the zoom level at which a cluster splits into children. */
export function getExpansionZoom(clusterId: number): number {
  if (!index) return 18;
  try {
    return index.getClusterExpansionZoom(clusterId);
  } catch {
    return 18;
  }
}

export function isReady(): boolean {
  return index !== null;
}

/**
 * Start periodic rebuilds (call once at server startup).
 * Loads from disk cache first for instant availability,
 * then rebuilds from DB in the background.
 */
export async function startClusterRefresh(intervalMs = 15 * 60_000): Promise<void> {
  if (buildTimer) return;

  // Try disk cache first for instant startup
  const loaded = await loadFromDisk();

  // Always rebuild from DB (immediately if no cache, or in background if cached)
  if (loaded) {
    // Cache loaded — schedule DB rebuild after a short delay to not compete with other startup tasks
    setTimeout(() => buildClusterIndex(), 5_000);
  } else {
    // No cache — build from DB immediately
    buildClusterIndex();
  }

  buildTimer = setInterval(() => buildClusterIndex(), intervalMs);
  buildTimer.unref();
}

/** Stop periodic rebuilds (for graceful shutdown). */
export function stopClusterRefresh(): void {
  if (buildTimer) {
    clearInterval(buildTimer);
    buildTimer = null;
  }
}
