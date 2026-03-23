import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { getDb, readListingStats, refreshListingStats } from "@flat-finder/db";
import type { StatsResponse, HealthResponse } from "@flat-finder/types";

const app = new Hono();

// ── Background stats refresh ──────────────────────────────────────────────
// The listing_stats table is refreshed periodically in the background.
// The expensive COUNT/GROUP BY never runs in the request path.
const REFRESH_INTERVAL_MS = 15 * 60_000; // 15 minutes
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let isRefreshing = false;

async function backgroundRefresh(): Promise<void> {
  if (isRefreshing) return; // prevent overlapping refreshes
  isRefreshing = true;
  const t0 = Date.now();
  try {
    await refreshListingStats();
    // Invalidate in-memory cache so next request picks up fresh data
    statsCache = null;
    console.log(`[stats] Background refresh completed in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[stats] Background refresh failed after ${Date.now() - t0}ms:`, err);
  } finally {
    isRefreshing = false;
  }
}

/** Start the periodic refresh. Called once from the API entrypoint. */
export function startStatsRefresh(): void {
  if (refreshTimer) return;

  // Initial refresh — runs in background, does not block server startup
  backgroundRefresh();

  refreshTimer = setInterval(backgroundRefresh, REFRESH_INTERVAL_MS);
  refreshTimer.unref(); // don't prevent process exit
}

/** Stop the periodic refresh (for graceful shutdown). */
export function stopStatsRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ── In-memory cache for the fast-read path ────────────────────────────────
// Even reading the listing_stats table takes ~20-50ms over a remote connection.
// Cache the result in-memory for 60s so repeated hits are instant.
let statsCache: { data: StatsResponse; ts: number } | null = null;
const STATS_CACHE_TTL = 10 * 60_000; // 10 minutes — safe because underlying data only changes every 15min

/**
 * GET /api/stats — Pre-computed aggregate statistics
 *
 * Reads from the listing_stats materialized table (< 100 rows).
 * Response time: < 50ms (< 1ms if in-memory cache is warm).
 * The expensive aggregation runs every 15 minutes in the background.
 */
app.get("/", async (c) => {
  const now = Date.now();

  // Fast path: in-memory cache
  if (statsCache && now - statsCache.ts < STATS_CACHE_TTL) {
    c.header("X-Cache", "HIT");
    return c.json(statsCache.data);
  }

  const db = getDb();

  // Read from pre-computed listing_stats table
  const stats = await readListingStats(db);

  if (stats) {
    const response: StatsResponse = {
      total: stats.total,
      total_all: stats.totalAll,
      inactive: stats.totalAll - stats.total,
      by_source: stats.bySource,
      by_type: stats.byType,
      by_transaction: stats.byTransaction,
      by_city: stats.byCity,
    };

    statsCache = { data: response, ts: Date.now() };
    c.header("X-Cache", "MISS");
    c.header("X-Stats-Refreshed-At", stats.refreshedAt ?? "unknown");
    return c.json(response);
  }

  // Fallback: listing_stats table is empty (first deploy, before first refresh).
  // Use pg_class estimates for a fast approximation.
  console.warn("[stats] listing_stats table empty — using pg_class estimates");
  const [row] = await db.execute<{ est: string }>(
    sql`SELECT reltuples::bigint AS est FROM pg_class WHERE relname = 'listings'`,
  );
  const estimated = Number(row?.est ?? 0);

  const fallback: StatsResponse = {
    total: estimated,
    total_all: estimated,
    inactive: 0,
    by_source: {},
    by_type: {},
    by_transaction: {},
    by_city: {},
  };

  // Don't cache the fallback for long — the real data should arrive soon
  statsCache = { data: fallback, ts: Date.now() - STATS_CACHE_TTL + 10_000 }; // expires in 10s
  c.header("X-Cache", "MISS");
  c.header("X-Stats-Source", "estimate");
  return c.json(fallback);
});

/**
 * GET /api/stats/health — Simple health check (kept for backwards compat)
 */
app.get("/health", async (c) => {
  if (statsCache) {
    const response: HealthResponse = {
      status: "ok",
      total: statsCache.data.total_all,
      by_source: statsCache.data.by_source,
    };
    return c.json(response);
  }

  const db = getDb();
  const [row] = await db.execute<{ est: string }>(
    sql`SELECT reltuples::bigint AS est FROM pg_class WHERE relname = 'listings'`,
  );
  const total = Number(row?.est ?? 0);

  const response: HealthResponse = {
    status: "ok",
    total,
    by_source: {},
  };
  return c.json(response);
});

export default app;
