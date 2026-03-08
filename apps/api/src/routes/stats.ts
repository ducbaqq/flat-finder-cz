import { Hono } from "hono";
import { count, desc, eq } from "drizzle-orm";
import { getDb, listings } from "@flat-finder/db";
import type { StatsResponse, HealthResponse } from "@flat-finder/types";

const app = new Hono();

// ── In-memory cache for stats (aggregation queries are expensive) ──
let statsCache: { data: StatsResponse; ts: number } | null = null;
const STATS_CACHE_TTL = 60_000; // 1 minute

/**
 * GET /api/stats — Aggregate statistics (cached for 60s)
 */
app.get("/", async (c) => {
  const now = Date.now();
  if (statsCache && now - statsCache.ts < STATS_CACHE_TTL) {
    c.header("X-Cache", "HIT");
    return c.json(statsCache.data);
  }

  const db = getDb();

  const [totalResult, totalAllResult] = await Promise.all([
    db
      .select({ count: count() })
      .from(listings)
      .where(eq(listings.is_active, true)),
    db.select({ count: count() }).from(listings),
  ]);

  const total = totalResult[0]?.count ?? 0;
  const totalAll = totalAllResult[0]?.count ?? 0;
  const inactive = totalAll - total;

  const [bySourceRows, byTypeRows, byTransactionRows, byCityRows] =
    await Promise.all([
      db
        .select({ source: listings.source, count: count() })
        .from(listings)
        .where(eq(listings.is_active, true))
        .groupBy(listings.source),
      db
        .select({ property_type: listings.property_type, count: count() })
        .from(listings)
        .where(eq(listings.is_active, true))
        .groupBy(listings.property_type),
      db
        .select({
          transaction_type: listings.transaction_type,
          count: count(),
        })
        .from(listings)
        .where(eq(listings.is_active, true))
        .groupBy(listings.transaction_type),
      db
        .select({ city: listings.city, count: count() })
        .from(listings)
        .where(eq(listings.is_active, true))
        .groupBy(listings.city)
        .orderBy(desc(count()))
        .limit(10),
    ]);

  const by_source: Record<string, number> = {};
  for (const row of bySourceRows) {
    by_source[row.source] = row.count;
  }

  const by_type: Record<string, number> = {};
  for (const row of byTypeRows) {
    by_type[row.property_type] = row.count;
  }

  const by_transaction: Record<string, number> = {};
  for (const row of byTransactionRows) {
    by_transaction[row.transaction_type] = row.count;
  }

  const by_city: Record<string, number> = {};
  for (const row of byCityRows) {
    if (row.city) {
      by_city[row.city] = row.count;
    }
  }

  const response: StatsResponse = {
    total,
    total_all: totalAll,
    inactive,
    by_source,
    by_type,
    by_transaction,
    by_city,
  };

  statsCache = { data: response, ts: Date.now() };
  c.header("X-Cache", "MISS");
  return c.json(response);
});

/**
 * GET /api/health — Simple health check
 */
app.get("/health", async (c) => {
  const db = getDb();

  const [totalResult, bySourceRows] = await Promise.all([
    db
      .select({ count: count() })
      .from(listings),
    db
      .select({ source: listings.source, count: count() })
      .from(listings)
      .groupBy(listings.source),
  ]);

  const total = totalResult[0]?.count ?? 0;
  const by_source: Record<string, number> = {};
  for (const row of bySourceRows) {
    by_source[row.source] = row.count;
  }

  const response: HealthResponse = {
    status: "ok",
    total,
    by_source,
  };

  return c.json(response);
});

export default app;
