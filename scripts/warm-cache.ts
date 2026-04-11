/**
 * Warm Postgres shared_buffers after a mass UPDATE / bulk operation evicted
 * the hot working set. Runs a sequence of lightweight scans that touch the
 * same pages the production query workload needs, one at a time so we don't
 * pile onto an already-saturated DB.
 *
 * Also runs ANALYZE listings to refresh planner statistics (stale stats
 * after a mass UPDATE are a common cause of the planner picking seq scans
 * where index scans should work).
 *
 * Usage: npx tsx scripts/warm-cache.ts
 */
import { config } from "dotenv";
config();

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

function connect() {
  const username = process.env.DB_USERNAME ?? "flat_finder";
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? "");
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const database = process.env.DB_DATABASE ?? "reality-app";
  const url = `postgres://${username}:${password}@${host}:${port}/${database}`;

  const caPath = path.resolve(process.cwd(), "certs/ca-certificate.crt");
  const ssl =
    process.env.DB_SSLMODE === "disable"
      ? false
      : fs.existsSync(caPath)
        ? { ca: fs.readFileSync(caPath, "utf-8"), rejectUnauthorized: true }
        : { rejectUnauthorized: false };

  // Single connection — we want to serialize, not parallelize.
  return postgres(url, { ssl, max: 1, connect_timeout: 15 });
}

async function cacheHitRatio(sql: postgres.Sql): Promise<string> {
  const [row] = await sql<Array<{ ratio: string }>>`
    SELECT CASE WHEN sum(heap_blks_hit) + sum(heap_blks_read) > 0
      THEN ROUND(100.0 * sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)), 2)::text
      ELSE '—' END AS ratio
    FROM pg_statio_user_tables
  `;
  return row.ratio;
}

async function step(
  name: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  const t0 = Date.now();
  process.stdout.write(`  ${name.padEnd(50)} `);
  try {
    await fn();
    const ms = Date.now() - t0;
    process.stdout.write(`${ms} ms\n`);
  } catch (err) {
    process.stdout.write(`FAILED: ${(err as Error).message}\n`);
    throw err;
  }
}

async function main() {
  const sql = connect();
  try {
    const before = await cacheHitRatio(sql);
    console.log(`Cache hit ratio before: ${before}%\n`);

    console.log("=== Refreshing planner statistics ===");
    await step("ANALYZE listings", async () => {
      await sql.unsafe(`ANALYZE listings`);
    });

    console.log("\n=== Warming heap + core indexes ===");

    // 1. Supercluster rebuild path — is_active + has geo. Same shape as
    //    apps/api/src/services/cluster-index.ts query.
    await step("active + geo (cluster-index rebuild path)", async () => {
      await sql`
        SELECT id, latitude, longitude, price, title, thumbnail_url,
               address, city, currency, size_m2, layout, floor,
               property_type, transaction_type, source, listed_at
        FROM listings
        WHERE is_active = true
          AND is_canonical = true
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
      `;
    });

    // 2. Default listings sort (newest first) — used by homepage
    //    latest-listings and /search default view.
    await step("active+canonical ORDER BY listed_at DESC (listings default)", async () => {
      await sql`
        SELECT id, title, price, address, city, listed_at,
               property_type, transaction_type, source, thumbnail_url
        FROM listings
        WHERE is_active = true AND is_canonical = true
        ORDER BY listed_at DESC
        LIMIT 2000
      `;
    });

    // 3. Price-sorted (ascending) — second-most common sort.
    await step("active+canonical ORDER BY price ASC (price sort)", async () => {
      await sql`
        SELECT id, price, listed_at
        FROM listings
        WHERE is_active = true AND is_canonical = true
        ORDER BY price ASC NULLS LAST
        LIMIT 2000
      `;
    });

    // 4. Stats aggregation path — matches the listing_stats refresh.
    await step("GROUP BY source/property_type (stats refresh path)", async () => {
      await sql`
        SELECT source, property_type, transaction_type, COUNT(*)::int
        FROM listings
        WHERE is_active = true
        GROUP BY source, property_type, transaction_type
      `;
    });

    // 5. cluster_id index warmup — for cluster-siblings lookups.
    await step("cluster_id IS NOT NULL (sibling lookup path)", async () => {
      await sql`
        SELECT id, cluster_id, source, price
        FROM listings
        WHERE cluster_id IS NOT NULL AND is_active = true
        LIMIT 5000
      `;
    });

    // 6. Filter column bitmap scans — city/district are the most common
    //    filters.
    await step("filtered by city (filter-page warm)", async () => {
      await sql`
        SELECT id, title, price, city, district, property_type
        FROM listings
        WHERE is_active = true AND is_canonical = true
          AND city IN ('Praha', 'Brno', 'Ostrava', 'Plzeň', 'Liberec')
        LIMIT 5000
      `;
    });

    // 7. Primary key lookups — warms the heap pages used by /api/listings/:id.
    //    Sample a spread of ids across the table.
    await step("primary key spot-reads (detail page path)", async () => {
      await sql`
        SELECT * FROM listings
        WHERE id IN (
          SELECT id FROM listings
          WHERE is_active = true
          ORDER BY random()
          LIMIT 200
        )
      `;
    });

    const after = await cacheHitRatio(sql);
    console.log(`\nCache hit ratio after:  ${after}%`);
    console.log(
      before === after
        ? "(unchanged — the hit-ratio metric is cumulative, so short-term improvements may not show up)"
        : `(${Number(after) > Number(before) ? "up" : "down"} from ${before}%)`,
    );
    console.log("\nDone. Give the API 30-60 seconds to feel the difference.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
