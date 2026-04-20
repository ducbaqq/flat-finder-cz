/**
 * Benchmark: incremental dedup via the "smart-probe" approach.
 *
 * For every active listing with cluster_id IS NULL that has the required
 * fields, compute its prospective cluster_hash
 * (geo+size+price+transaction_type). Then two outcomes per candidate:
 *
 *   1. hash already exists on an active row   → join that cluster
 *      (is_canonical stays false, since the existing cluster already has one)
 *   2. multiple candidates share a new hash   → form a new cluster
 *      (min id becomes canonical)
 *
 * Candidates that don't match anything stay cluster_id IS NULL.
 *
 * The existing `clusterListings()` full pipeline does a reset + GROUP BY +
 * UPDATE over the whole active table (~21 min). This script only probes
 * via idx_listings_cluster_id — no reset, no rewrite — so it should be
 * seconds, not minutes.
 *
 * Dry-run by default. Pass --apply to persist.
 *
 * Optional --hours=N narrows candidates to rows whose scraped_at is within
 * the last N hours. Useful for measuring the realistic cost of running this
 * inline inside the watch loop (where only recently-scraped rows are new).
 * Without --hours, scans every unclustered row in the table.
 *
 * Usage:
 *   npx tsx scripts/incremental-dedup.ts                   # dry-run, full scan
 *   npx tsx scripts/incremental-dedup.ts --hours=6         # dry-run, past 6h
 *   npx tsx scripts/incremental-dedup.ts --hours=120       # dry-run, past 5d
 *   npx tsx scripts/incremental-dedup.ts --apply --hours=6 # persist, past 6h
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

  return postgres(url, { ssl, max: 2, connect_timeout: 15 });
}

function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function parseHours(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--hours="));
  if (!arg) return null;
  const n = Number(arg.slice("--hours=".length));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--hours must be a positive number, got: ${arg}`);
  }
  return n;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const hours = parseHours();
  const sql = connect();

  console.log(`Mode: ${apply ? "APPLY (will commit)" : "DRY RUN (rollback)"}`);
  console.log(`Window: ${hours == null ? "all unclustered" : `scraped_at within last ${hours}h`}`);

  try {
    const t0 = Date.now();

    // Wrap the whole thing in a transaction so:
    //   - SET LOCAL work_mem persists for the CTE sort
    //   - dry-run rolls back trivially via throw
    await sql.begin(async (tx) => {
      await tx`SET LOCAL work_mem = '256MB'`;

      // Fragment for the optional scraped_at window. Empty when --hours is not
      // set, which reverts to the full-table scan behavior.
      const hoursFilter = hours == null
        ? tx``
        : tx`AND scraped_at > now() - make_interval(hours => ${hours})`;

      const tCount = Date.now();

      const [{ candidates }] = await tx<Array<{ candidates: string }>>`
        SELECT COUNT(*)::text AS candidates
        FROM listings
        WHERE is_active = true
          AND cluster_id IS NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND size_m2 IS NOT NULL AND price IS NOT NULL
          ${hoursFilter}
      `;
      console.log(`Candidates in window: ${candidates}`);

      const tPlan = Date.now();

      // The actual incremental dedup pipeline.
      //
      // candidate_hashes: compute prospective cluster_hash for every
      //   unclustered, fully-qualified active row.
      //
      // resolved: for each candidate, determine
      //   - existing_cluster: does another active row already hold this hash?
      //     (EXISTS probe uses idx_listings_cluster_id — this is the
      //     performance-critical lookup)
      //   - hash_peers: how many candidates share this hash (for forming
      //     a new cluster among candidates)
      //   - new_canonical_id: min(id) among candidates sharing the hash,
      //     only meaningful if no existing cluster (case 2)
      //
      // assignments: keep only rows that will actually be assigned — either
      //   joining existing cluster OR forming a new >=2-member group.
      const result = await tx<Array<{ id: number; cluster_id: string; is_canonical: boolean }>>`
        WITH candidate_hashes AS (
          SELECT
            id,
            md5(
              'geo|' || transaction_type || '|' ||
              ROUND(latitude::numeric, 4)::text || '|' ||
              ROUND(longitude::numeric, 4)::text || '|' ||
              ROUND(size_m2::numeric, 2)::text || '|' ||
              ROUND(price::numeric, 0)::text
            ) AS prospective_hash
          FROM listings
          WHERE is_active = true
            AND cluster_id IS NULL
            AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND size_m2 IS NOT NULL AND price IS NOT NULL
            ${hoursFilter}
        ),
        resolved AS (
          SELECT
            ch.id,
            ch.prospective_hash,
            EXISTS (
              SELECT 1 FROM listings l
              WHERE l.cluster_id = ch.prospective_hash
                AND l.is_active = true
            ) AS existing_cluster,
            COUNT(*) OVER (PARTITION BY ch.prospective_hash) AS hash_peers,
            MIN(ch.id) OVER (PARTITION BY ch.prospective_hash) AS new_canonical_id
          FROM candidate_hashes ch
        ),
        assignments AS (
          SELECT
            id,
            prospective_hash,
            existing_cluster,
            CASE
              WHEN existing_cluster THEN false
              ELSE (id = new_canonical_id)
            END AS new_is_canonical
          FROM resolved
          WHERE existing_cluster OR hash_peers > 1
        )
        UPDATE listings l
        SET
          cluster_id   = a.prospective_hash,
          is_canonical = a.new_is_canonical
        FROM assignments a
        WHERE l.id = a.id
        RETURNING l.id, l.cluster_id, l.is_canonical
      `;

      const tDone = Date.now();
      console.log(`Rows updated: ${result.length}`);
      console.log(`  joined existing cluster (is_canonical = false): ${
        result.filter((r) => !r.is_canonical).length
      }`);
      console.log(`  new cluster canonical (is_canonical = true):    ${
        result.filter((r) => r.is_canonical).length
      }`);

      const distinctClusters = new Set(result.map((r) => r.cluster_id)).size;
      console.log(`  distinct clusters touched: ${distinctClusters}`);

      console.log(`\nTimings:`);
      console.log(`  tx setup (SET LOCAL)  : ${fmtMs(tCount - t0)}`);
      console.log(`  candidate count query : ${fmtMs(tPlan - tCount)}`);
      console.log(`  incremental pipeline  : ${fmtMs(tDone - tPlan)}`);

      if (!apply) {
        // Force rollback so the UPDATE doesn't persist.
        throw new DryRunRollback();
      }
    });

    const tEnd = Date.now();
    console.log(`\nTotal wall time: ${fmtMs(tEnd - t0)}`);
  } catch (err) {
    if (err instanceof DryRunRollback) {
      console.log("\n[dry-run] rolled back — no changes persisted.");
    } else {
      throw err;
    }
  } finally {
    await sql.end();
  }
}

class DryRunRollback extends Error {
  constructor() {
    super("dry-run rollback");
    this.name = "DryRunRollback";
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
