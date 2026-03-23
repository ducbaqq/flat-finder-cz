import { sql } from "drizzle-orm";
import { listingStats } from "../schema/listing-stats.js";
import type { Db } from "../client.js";
import { createDb } from "../client.js";

/**
 * Refresh the listing_stats table by recomputing aggregates from listings.
 *
 * Uses a DEDICATED database connection (not the shared pool) to avoid
 * starving request-handling queries. The aggregation runs as 5 sequential
 * INSERT queries (non-transactional), each doing a single GROUP BY on the
 * listings table. The final step deletes stale rows.
 *
 * Each individual query takes ~20-30s on 560K rows over a remote managed DB.
 * Total refresh time is ~2-3 minutes but runs entirely in the background.
 * The stats endpoint reads from the tiny (~35 row) listing_stats table
 * in under 50ms.
 */
export async function refreshListingStats(): Promise<void> {
  const { db, sql: pgSql } = createDb();
  const now = new Date().toISOString();

  try {
    // Each INSERT is independent. No transaction needed — we use a timestamp
    // marker so we can delete old rows after all new ones are inserted.

    // 1. Summary row
    console.log("[stats-refresh] Computing total counts...");
    await db.execute(sql`
      INSERT INTO listing_stats (dimension, cnt, total_all, total_active, refreshed_at)
      SELECT
        '__total__',
        0,
        COUNT(*)::int,
        (COUNT(*) FILTER (WHERE is_active = true))::int,
        ${now}::timestamp
      FROM listings
    `);
    console.log("[stats-refresh] Total counts done.");

    // 2. By source
    console.log("[stats-refresh] Computing by_source...");
    await db.execute(sql`
      INSERT INTO listing_stats (dimension, source, cnt, refreshed_at)
      SELECT 'by_source', source, COUNT(*)::int, ${now}::timestamp
      FROM listings
      WHERE is_active = true
      GROUP BY source
    `);
    console.log("[stats-refresh] by_source done.");

    // 3. By property_type
    console.log("[stats-refresh] Computing by_type...");
    await db.execute(sql`
      INSERT INTO listing_stats (dimension, property_type, cnt, refreshed_at)
      SELECT 'by_type', property_type, COUNT(*)::int, ${now}::timestamp
      FROM listings
      WHERE is_active = true
      GROUP BY property_type
    `);
    console.log("[stats-refresh] by_type done.");

    // 4. By transaction_type
    console.log("[stats-refresh] Computing by_transaction...");
    await db.execute(sql`
      INSERT INTO listing_stats (dimension, transaction_type, cnt, refreshed_at)
      SELECT 'by_transaction', transaction_type, COUNT(*)::int, ${now}::timestamp
      FROM listings
      WHERE is_active = true
      GROUP BY transaction_type
    `);
    console.log("[stats-refresh] by_transaction done.");

    // 5. Top 10 cities
    console.log("[stats-refresh] Computing by_city...");
    await db.execute(sql`
      INSERT INTO listing_stats (dimension, city, cnt, refreshed_at)
      SELECT 'by_city', city, COUNT(*)::int, ${now}::timestamp
      FROM listings
      WHERE is_active = true AND city IS NOT NULL
      GROUP BY city
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);
    console.log("[stats-refresh] by_city done.");

    // 6. Delete old rows
    await db.execute(sql`
      DELETE FROM listing_stats WHERE refreshed_at != ${now}::timestamp
    `);
    console.log("[stats-refresh] Old rows cleaned up.");
  } finally {
    await pgSql.end();
  }
}

/**
 * Read pre-computed stats from the listing_stats table.
 * Returns null if the table is empty (stats haven't been computed yet).
 */
export async function readListingStats(db: Db): Promise<{
  total: number;
  totalAll: number;
  bySource: Record<string, number>;
  byType: Record<string, number>;
  byTransaction: Record<string, number>;
  byCity: Record<string, number>;
  refreshedAt: string | null;
} | null> {
  const rows = await db.select().from(listingStats);

  if (rows.length === 0) return null;

  const totalRow = rows.find((r) => r.dimension === "__total__");
  if (!totalRow) return null;

  const totalAll = totalRow.total_all ?? 0;
  const total = totalRow.total_active ?? 0;

  const bySource: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byTransaction: Record<string, number> = {};
  const byCity: Record<string, number> = {};

  for (const row of rows) {
    switch (row.dimension) {
      case "by_source":
        if (row.source) bySource[row.source] = row.cnt;
        break;
      case "by_type":
        if (row.property_type) byType[row.property_type] = row.cnt;
        break;
      case "by_transaction":
        if (row.transaction_type) byTransaction[row.transaction_type] = row.cnt;
        break;
      case "by_city":
        if (row.city) byCity[row.city] = row.cnt;
        break;
    }
  }

  return {
    total,
    totalAll,
    bySource,
    byType,
    byTransaction,
    byCity,
    refreshedAt: totalRow.refreshed_at,
  };
}
