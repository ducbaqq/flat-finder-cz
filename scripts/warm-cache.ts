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

/**
 * Run a warming step with timing, log-and-continue on failure.
 *
 * Partial warming is still useful during an incident — if the Phase 1 scan
 * dies midway we still want to try the smaller targeted steps after it, and
 * we still want the final hit-ratio sample. So failures log but don't abort
 * the whole sequence. The one exception is ANALYZE, which the caller runs
 * outside `step()` and is allowed to fail the run.
 */
async function step(
  name: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  const t0 = Date.now();
  process.stdout.write(`  ${name.padEnd(55)} `);
  try {
    await fn();
    const ms = Date.now() - t0;
    process.stdout.write(`${ms} ms\n`);
  } catch (err) {
    const ms = Date.now() - t0;
    process.stdout.write(`FAILED after ${ms} ms: ${(err as Error).message}\n`);
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
    console.log("(Queries are intentionally server-side — we wrap each scan");
    console.log(" in COUNT(*) so the rows never travel back to the client,");
    console.log(" we just want Postgres to touch the pages.)\n");

    // 1. Supercluster rebuild path — is_active + has geo.
    //    Mirrors apps/api/src/services/cluster-index.ts: on every API restart
    //    and every 15 min, the API scans this exact set to build an in-memory
    //    Supercluster KD-tree. If these pages are cold, API startup takes
    //    ~115 s; warm it's ~8 s.
    //    ~350K rows on a full scan — COUNT(*) avoids materializing them.
    await step("active + geo (cluster-index rebuild path)", async () => {
      await sql`
        SELECT COUNT(*)::int FROM (
          SELECT id, latitude, longitude, price, title, thumbnail_url,
                 address, city, currency, size_m2, layout, floor,
                 property_type, transaction_type, source, listed_at
          FROM listings
          WHERE is_active = true
            AND is_canonical = true
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
        ) sub
      `;
    });

    // 2. Default listings sort (newest first) — homepage latest-listings
    //    and /search default view.
    await step("active+canonical ORDER BY listed_at DESC (default sort)", async () => {
      await sql`
        SELECT COUNT(*)::int FROM (
          SELECT id, title, price, address, city, listed_at,
                 property_type, transaction_type, source, thumbnail_url
          FROM listings
          WHERE is_active = true AND is_canonical = true
          ORDER BY listed_at DESC
          LIMIT 2000
        ) sub
      `;
    });

    // 3. Price-sorted (ascending).
    await step("active+canonical ORDER BY price ASC (price sort)", async () => {
      await sql`
        SELECT COUNT(*)::int FROM (
          SELECT id, price, listed_at
          FROM listings
          WHERE is_active = true AND is_canonical = true
          ORDER BY price ASC NULLS LAST
          LIMIT 2000
        ) sub
      `;
    });

    // 4. Stats aggregation path — matches the listing_stats refresh.
    //    Aggregate result is tiny (~30 rows), fine to return directly.
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
        SELECT COUNT(*)::int FROM (
          SELECT id, cluster_id, source, price
          FROM listings
          WHERE cluster_id IS NOT NULL AND is_active = true
          LIMIT 5000
        ) sub
      `;
    });

    // 6. Filter column bitmap scans — city is the most common filter.
    await step("filtered by city (filter-page warm)", async () => {
      await sql`
        SELECT COUNT(*)::int FROM (
          SELECT id, title, price, city, district, property_type
          FROM listings
          WHERE is_active = true AND is_canonical = true
            AND city IN ('Praha', 'Brno', 'Ostrava', 'Plzeň', 'Liberec')
          LIMIT 5000
        ) sub
      `;
    });

    // 7. Primary key spot-reads — warms the heap pages used by
    //    /api/listings/:id. TABLESAMPLE is a constant-time block sample
    //    (no seq scan + ORDER BY random() + sort). 0.1% of ~670K rows
    //    = ~670 rows, far cheaper than the old random() approach which
    //    was ironically the most expensive step in the script.
    await step("primary key spot-reads via TABLESAMPLE (detail page path)", async () => {
      await sql`
        SELECT COUNT(*)::int FROM (
          SELECT id, title, price, latitude, longitude, property_type,
                 transaction_type, source, listed_at
          FROM listings TABLESAMPLE SYSTEM (0.1)
          WHERE is_active = true
        ) sub
      `;
    });

    const after = await cacheHitRatio(sql);
    console.log(`\nCache hit ratio after:  ${after}%`);
    console.log(
      "(pg_statio_user_tables is cumulative since stats reset — warming",
    );
    console.log(
      " adds misses to the total before serving pages, so the headline",
    );
    console.log(
      " number may not move or may even drift down. What matters is that",
    );
    console.log(
      " subsequent API queries hit warm pages; watch the API's actual",
    );
    console.log(
      " response times to confirm recovery.)",
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
