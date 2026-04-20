/**
 * Benchmark + one-shot runner for incremental dedup.
 *
 * Shares the `clusterNewListings` implementation from @flat-finder/db with
 * the watch-loop hook, so this script's timing matches the inline pass.
 *
 * Dry-run by default. Pass --apply to persist.
 * Optional --hours=N narrows candidates via the scraped_at index (debug aid;
 * the in-loop pass never applies a window — it always considers the full
 * unclustered pool).
 *
 * Usage:
 *   npx tsx scripts/incremental-dedup.ts              # dry-run, full pool
 *   npx tsx scripts/incremental-dedup.ts --hours=120  # dry-run, past 5d only
 *   npx tsx scripts/incremental-dedup.ts --apply      # persist
 */
// @flat-finder/config loads .env at module init (transitively via @flat-finder/db),
// so no explicit dotenv call here.
import { createDb, clusterNewListings } from "@flat-finder/db";
import { sql } from "drizzle-orm";

function parseHours(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--hours="));
  if (!arg) return null;
  const n = Number(arg.slice("--hours=".length));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--hours must be a positive number, got: ${arg}`);
  }
  return n;
}

function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const hours = parseHours();

  console.log(`Mode: ${apply ? "APPLY (will commit)" : "DRY RUN (rollback)"}`);
  console.log(`Window: ${hours == null ? "all unclustered" : `scraped_at within last ${hours}h`}`);

  const conn = createDb();
  try {
    // Optional windowed candidate count for context. The function itself
    // always scans the full unclustered pool; --hours only filters this
    // reporting query, so expect the assigned-row count to be the same
    // with or without --hours.
    if (hours != null) {
      const [row] = (await conn.db.execute<{ candidates: string }>(sql`
        SELECT COUNT(*)::text AS candidates
        FROM listings
        WHERE is_active = true
          AND cluster_id IS NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND size_m2 IS NOT NULL AND price IS NOT NULL
          AND scraped_at > now() - make_interval(hours => ${hours})
      `)) as { candidates: string }[];
      console.log(`Candidates in window (reporting only): ${row?.candidates ?? "?"}`);
    }

    const t0 = Date.now();
    const result = await clusterNewListings(conn.db, { dryRun: !apply });
    const elapsed = Date.now() - t0;

    console.log(`Rows updated: ${result.clustered}`);
    console.log(`  joined existing cluster: ${result.joined_existing}`);
    console.log(`  new-cluster members:     ${result.clustered - result.joined_existing}`);
    console.log(`  distinct clusters:       ${result.clusters}`);
    console.log(`\nPipeline: ${fmtMs(elapsed)}`);
    if (!apply) console.log("\n[dry-run] rolled back — no changes persisted.");
  } finally {
    await conn.sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
