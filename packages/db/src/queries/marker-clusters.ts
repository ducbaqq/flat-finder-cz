import { and, eq, gte, lte, sql } from "drizzle-orm";
import { markerClusters } from "../schema/marker-clusters.js";
import type { Db } from "../client.js";
import { createDb } from "../client.js";

/**
 * Refresh the marker_clusters table by recomputing spatial aggregates.
 *
 * Uses a DEDICATED database connection (same pattern as listing-stats refresh)
 * to avoid starving request-handling queries.
 *
 * Strategy: for each precision level (0-3), compute
 *   ROUND(latitude, p) / ROUND(longitude, p) groupings with COUNT, AVG(price),
 *   and MIN(id) for single-point clusters.
 *
 * The old data is kept live while new data is being inserted — the final step
 * atomically swaps by deleting old rows (identified by a different refreshed_at).
 */
export async function refreshMarkerClusters(): Promise<void> {
  const { db, sql: pgSql } = createDb();
  const now = new Date().toISOString();

  try {
    // Hierarchical approach: compute only the finest precision (3) from the
    // full listings table (~398K rows → ~180K groups), then aggregate UP
    // from that result to compute coarser precisions (2, 1, 0).
    //
    // This scans the large listings table only ONCE. The subsequent aggregations
    // operate on the much smaller marker_clusters table (180K → 60K → 15K → 3K).

    // Step 1: Precision 3 — scan listings (the only expensive step)
    console.log("[markers-refresh] Step 1/4: precision 3 from listings...");
    let t0 = Date.now();
    await db.execute(sql`
      INSERT INTO marker_clusters (precision, lat, lng, count, avg_price, min_id, min_price, refreshed_at)
      SELECT
        3,
        ROUND(latitude::numeric, 3)::float8,
        ROUND(longitude::numeric, 3)::float8,
        COUNT(*)::int,
        AVG(price)::float8,
        MIN(id),
        NULL::float8,
        ${now}::timestamp
      FROM listings
      WHERE is_active = true
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      GROUP BY
        ROUND(latitude::numeric, 3),
        ROUND(longitude::numeric, 3)
    `);
    console.log(`[markers-refresh] Precision 3 done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Step 2: Precision 2 — aggregate from precision 3 (fast, ~180K → ~60K rows)
    console.log("[markers-refresh] Step 2/4: precision 2 from precision 3...");
    t0 = Date.now();
    await db.execute(sql`
      INSERT INTO marker_clusters (precision, lat, lng, count, avg_price, min_id, min_price, refreshed_at)
      SELECT
        2,
        ROUND(lat::numeric, 2)::float8,
        ROUND(lng::numeric, 2)::float8,
        SUM(count)::int,
        SUM(avg_price * count) / NULLIF(SUM(CASE WHEN avg_price IS NOT NULL THEN count ELSE 0 END), 0)::float8,
        MIN(min_id),
        NULL::float8,
        ${now}::timestamp
      FROM marker_clusters
      WHERE precision = 3 AND refreshed_at = ${now}::timestamp
      GROUP BY ROUND(lat::numeric, 2), ROUND(lng::numeric, 2)
    `);
    console.log(`[markers-refresh] Precision 2 done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Step 3: Precision 1 — aggregate from precision 2 (~60K → ~15K rows)
    console.log("[markers-refresh] Step 3/4: precision 1 from precision 2...");
    t0 = Date.now();
    await db.execute(sql`
      INSERT INTO marker_clusters (precision, lat, lng, count, avg_price, min_id, min_price, refreshed_at)
      SELECT
        1,
        ROUND(lat::numeric, 1)::float8,
        ROUND(lng::numeric, 1)::float8,
        SUM(count)::int,
        SUM(avg_price * count) / NULLIF(SUM(CASE WHEN avg_price IS NOT NULL THEN count ELSE 0 END), 0)::float8,
        MIN(min_id),
        NULL::float8,
        ${now}::timestamp
      FROM marker_clusters
      WHERE precision = 2 AND refreshed_at = ${now}::timestamp
      GROUP BY ROUND(lat::numeric, 1), ROUND(lng::numeric, 1)
    `);
    console.log(`[markers-refresh] Precision 1 done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Step 4: Precision 0 — aggregate from precision 1 (~15K → ~3K rows)
    console.log("[markers-refresh] Step 4/4: precision 0 from precision 1...");
    t0 = Date.now();
    await db.execute(sql`
      INSERT INTO marker_clusters (precision, lat, lng, count, avg_price, min_id, min_price, refreshed_at)
      SELECT
        0,
        ROUND(lat::numeric, 0)::float8,
        ROUND(lng::numeric, 0)::float8,
        SUM(count)::int,
        SUM(avg_price * count) / NULLIF(SUM(CASE WHEN avg_price IS NOT NULL THEN count ELSE 0 END), 0)::float8,
        MIN(min_id),
        NULL::float8,
        ${now}::timestamp
      FROM marker_clusters
      WHERE precision = 1 AND refreshed_at = ${now}::timestamp
      GROUP BY ROUND(lat::numeric, 0), ROUND(lng::numeric, 0)
    `);
    console.log(`[markers-refresh] Precision 0 done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Delete old rows (atomic swap)
    await db.execute(sql`
      DELETE FROM marker_clusters WHERE refreshed_at != ${now}::timestamp
    `);
    console.log("[markers-refresh] Old rows cleaned up.");
  } finally {
    await pgSql.end();
  }
}

/**
 * Read pre-computed clusters for a given viewport and zoom level.
 */
export async function readMarkerClusters(
  db: Db,
  opts: {
    precision: number;
    sw_lat: number;
    sw_lng: number;
    ne_lat: number;
    ne_lng: number;
  },
): Promise<
  Array<{
    lat: number;
    lng: number;
    count: number;
    avg_price: number | null;
    min_id: number | null;
    min_price: number | null;
  }>
> {
  const rows = await db
    .select({
      lat: markerClusters.lat,
      lng: markerClusters.lng,
      count: markerClusters.count,
      avg_price: markerClusters.avg_price,
      min_id: markerClusters.min_id,
      min_price: markerClusters.min_price,
    })
    .from(markerClusters)
    .where(
      and(
        eq(markerClusters.precision, opts.precision),
        gte(markerClusters.lat, opts.sw_lat),
        lte(markerClusters.lat, opts.ne_lat),
        gte(markerClusters.lng, opts.sw_lng),
        lte(markerClusters.lng, opts.ne_lng),
      ),
    );

  return rows;
}

/**
 * Check if the marker_clusters table has data.
 */
export async function hasMarkerClusters(db: Db): Promise<boolean> {
  const [row] = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM marker_clusters LIMIT 1`,
  );
  return Number(row?.cnt ?? 0) > 0;
}
