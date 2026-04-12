/**
 * Report per-index usage on the `listings` table so we can make an
 * informed decision about which indexes to drop.
 *
 * Shows:
 *   - idx_scan     — how many times the planner chose this index
 *   - idx_tup_read — rows fetched via the index
 *   - idx_tup_fetch— rows returned to the client via the index
 *   - size         — on-disk size
 *   - the DDL so you can visually check what it's actually indexing
 *
 * An index with `idx_scan = 0` since stats reset is a prime drop candidate.
 * An index with high `idx_scan` but low `idx_tup_fetch` may be used for
 * existence checks / NOT NULL probes.
 *
 * Note: `pg_stat_user_indexes` counters are cumulative since last stats
 * reset (server start or explicit pg_stat_reset()). On DO managed PG the
 * reset typically happens on maintenance restarts, so the counter window
 * may be shorter than you'd think — cross-reference with `stats_reset`
 * in pg_stat_database.
 *
 * Usage: npx tsx scripts/index-usage-stats.ts
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

  return postgres(url, { ssl, max: 1, connect_timeout: 15 });
}

async function main() {
  const sql = connect();
  try {
    // When were the stats last reset?
    const [dbstats] = await sql<Array<{ stats_reset: string | null }>>`
      SELECT stats_reset::text FROM pg_stat_database
      WHERE datname = current_database()
    `;
    console.log(`Stats reset at: ${dbstats.stats_reset ?? "never"}\n`);

    // Per-index usage on listings.
    const rows = await sql<
      Array<{
        indexname: string;
        idx_scan: string;
        idx_tup_read: string;
        idx_tup_fetch: string;
        size: string;
        size_bytes: string;
        indexdef: string;
      }>
    >`
      SELECT
        s.indexrelname AS indexname,
        s.idx_scan::text,
        s.idx_tup_read::text,
        s.idx_tup_fetch::text,
        pg_size_pretty(pg_relation_size(s.indexrelid)) AS size,
        pg_relation_size(s.indexrelid)::text AS size_bytes,
        i.indexdef
      FROM pg_stat_user_indexes s
      JOIN pg_indexes i ON i.indexname = s.indexrelname
      WHERE s.relname = 'listings'
      ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC
    `;

    console.log(
      `${"index".padEnd(35)} ${"scans".padStart(10)} ${"tup_read".padStart(14)} ${"tup_fetch".padStart(14)} ${"size".padStart(10)}`,
    );
    console.log("─".repeat(90));
    for (const r of rows) {
      console.log(
        `${r.indexname.padEnd(35)} ${r.idx_scan.padStart(10)} ${r.idx_tup_read.padStart(14)} ${r.idx_tup_fetch.padStart(14)} ${r.size.padStart(10)}`,
      );
    }

    console.log("\n─── Definitions ───");
    for (const r of rows) {
      console.log(`  ${r.indexname}`);
      console.log(`    ${r.indexdef}`);
    }

    // Totals
    const totalBytes = rows.reduce((a, r) => a + Number(r.size_bytes), 0);
    const unused = rows.filter((r) => Number(r.idx_scan) === 0);
    const unusedBytes = unused.reduce((a, r) => a + Number(r.size_bytes), 0);

    console.log("\n─── Summary ───");
    console.log(`  Total listings indexes: ${rows.length}`);
    console.log(`  Total index size:       ${formatBytes(totalBytes)}`);
    console.log(
      `  Zero-scan indexes:      ${unused.length} (${formatBytes(unusedBytes)}, ${((100 * unusedBytes) / totalBytes).toFixed(1)}% of index size)`,
    );
    if (unused.length > 0) {
      console.log("  Zero-scan candidates for removal:");
      for (const r of unused) {
        console.log(`    - ${r.indexname}  (${r.size})`);
      }
    }
  } finally {
    await sql.end();
  }
}

function formatBytes(n: number): string {
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n > 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
