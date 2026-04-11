/**
 * One-shot migration: drop 13 redundant/unused indexes from `listings`.
 *
 * Evidence basis: production usage stats collected via
 * `scripts/index-usage-stats.ts` on 2026-04-11. All 13 dropped indexes
 * had exactly zero scans since DB start, with two exceptions:
 *
 *   - `idx_listings_external_id` — 963K scans, but it's an exact duplicate
 *     of the auto-generated `listings_external_id_unique` index that
 *     backs the `.unique()` constraint. The planner has been hitting the
 *     non-unique one due to how Drizzle emitted them; dropping the
 *     duplicate forces the planner to use the unique index, same shape,
 *     zero user-visible change.
 *
 *   - `idx_listings_price` — 8 scans total, for queries that don't
 *     filter by is_active. The composite `idx_listings_active_price`
 *     serves everything through the active-listings path. Acceptable
 *     regression risk for the extremely rare all-listings-by-price query.
 *
 * Goal: halve write amplification on listings UPDATEs. With 24 → 11
 * explicit + auto-generated indexes, each row UPDATE touches roughly
 * 46% of the original index count, and --dedupe wall time is projected
 * to drop from ~55 minutes to ~25 minutes.
 *
 * Uses DROP INDEX CONCURRENTLY IF EXISTS, which:
 *   - Does NOT block concurrent SELECT / INSERT / UPDATE / DELETE
 *   - Is idempotent (safe to re-run)
 *   - Cannot run inside a transaction (hence the unsafe() calls)
 *
 * If any query regresses after running this, the paired script
 * `scripts/restore-listings-indexes.ts` re-creates all 13 indexes via
 * `CREATE INDEX CONCURRENTLY IF NOT EXISTS`.
 *
 * Usage: npx tsx scripts/prune-listings-indexes.ts
 */
import { config } from "dotenv";
config();

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const INDEXES_TO_DROP = [
  "idx_listings_external_id", // duplicate of listings_external_id_unique
  "idx_listings_city",
  "idx_listings_price",
  "idx_listings_source",
  "idx_listings_property_type",
  "idx_listings_transaction_type",
  "idx_listings_district",
  "idx_listings_region",
  "idx_listings_condition",
  "idx_listings_construction",
  "idx_listings_ownership",
  "idx_listings_furnishing",
  "idx_listings_energy_rating",
] as const;

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

  return postgres(url, { ssl, max: 1, connect_timeout: 15 });
}

async function reportState(sql: postgres.Sql, label: string): Promise<void> {
  const [row] = await sql<
    Array<{ count: string; total_size: string }>
  >`
    SELECT COUNT(*)::text AS count,
      pg_size_pretty(SUM(pg_relation_size(indexrelid)))::text AS total_size
    FROM pg_stat_user_indexes
    WHERE relname = 'listings'
  `;
  console.log(`${label}: ${row.count} indexes, ${row.total_size} total`);
}

async function main() {
  const sql = connect();
  try {
    console.log("=== Before ===");
    await reportState(sql, "listings");

    console.log("\n=== Dropping indexes (CONCURRENTLY, non-blocking) ===");
    for (const name of INDEXES_TO_DROP) {
      const t0 = Date.now();
      process.stdout.write(`  ${name.padEnd(45)} `);
      try {
        // CONCURRENTLY cannot run inside a transaction block, and
        // postgres.unsafe() sends the raw SQL without wrapping it.
        await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);
        process.stdout.write(`${Date.now() - t0} ms\n`);
      } catch (err) {
        process.stdout.write(`FAILED: ${(err as Error).message}\n`);
      }
    }

    console.log("\n=== After ===");
    await reportState(sql, "listings");

    // Sanity check: verify none of the kept indexes were accidentally dropped.
    const KEEP = [
      "idx_listings_is_active",
      "idx_listings_geo",
      "idx_listings_active_listed",
      "idx_listings_active_price",
      "idx_listings_filtered_geo",
      "idx_listings_stats_agg",
      "idx_listings_layout",
      "idx_listings_cluster_id",
      "idx_listings_canonical",
      "listings_external_id_unique",
      "listings_pkey",
    ];
    const present = await sql<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'listings'
    `;
    const presentSet = new Set(present.map((r) => r.indexname));
    const missing = KEEP.filter((k) => !presentSet.has(k));

    console.log("\n=== Sanity check ===");
    if (missing.length === 0) {
      console.log(`  All ${KEEP.length} expected indexes are still present.`);
    } else {
      console.error(`  MISSING ${missing.length} expected indexes:`);
      for (const m of missing) console.error(`    - ${m}`);
      console.error(
        "  Something is wrong — run scripts/restore-listings-indexes.ts " +
          "and investigate.",
      );
      process.exit(1);
    }

    console.log("\nDone. Recommend running scripts/dedup-stats.ts + a");
    console.log("quick /api/listings sanity check to confirm nothing regressed.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
