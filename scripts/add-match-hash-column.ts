/**
 * One-shot migration: adds `match_hash` to listings as a
 * GENERATED ALWAYS AS (md5(...)) STORED column, plus a partial index.
 *
 * The formula is byte-identical to runClusteringOps's cluster_hash
 * expression at packages/db/src/queries/listings.ts, so an existing
 * cluster_id value equals the match_hash of any row in that cluster.
 *
 * STORED means Postgres populates the column for every row during the
 * ALTER — no separate backfill step. The ALTER triggers a table rewrite
 * (~10–30 min on 730K rows) and takes an ACCESS EXCLUSIVE lock for the
 * duration. The scraper MUST be paused while this runs.
 *
 * Idempotent: checks information_schema.columns and pg_indexes before
 * each DDL statement. Safe to re-run.
 *
 * Usage: npx tsx scripts/add-match-hash-column.ts
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

  // The ALTER takes minutes — bump statement_timeout well beyond the default.
  return postgres(url, {
    ssl,
    max: 1,
    connect_timeout: 15,
    idle_timeout: 0,
    max_lifetime: 0,
  });
}

function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

async function main() {
  const sql = connect();
  try {
    // No statement_timeout — the ALTER may take tens of minutes.
    await sql`SET statement_timeout = 0`;

    // 1. Column check
    const colRows = await sql<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'listings' AND column_name = 'match_hash'
    `;

    if (colRows.length > 0) {
      console.log("match_hash column already present — skipping ALTER.");
    } else {
      console.log(
        "Adding match_hash GENERATED STORED column. This rewrites the table.",
      );
      console.log("Expect 10–30 min on ~730K rows. DO NOT interrupt.");
      const t0 = Date.now();
      // The formula MUST stay identical to runClusteringOps's cluster_hash.
      await sql.unsafe(`
        ALTER TABLE listings
        ADD COLUMN match_hash text GENERATED ALWAYS AS (
          CASE
            WHEN latitude IS NOT NULL AND longitude IS NOT NULL
             AND size_m2 IS NOT NULL AND price IS NOT NULL
            THEN md5(
              'geo|' || transaction_type || '|' ||
              ROUND(latitude::numeric, 4)::text || '|' ||
              ROUND(longitude::numeric, 4)::text || '|' ||
              ROUND(size_m2::numeric, 2)::text || '|' ||
              ROUND(price::numeric, 0)::text
            )
            ELSE NULL
          END
        ) STORED
      `);
      console.log(`  Column added + rows rewritten in ${fmtMs(Date.now() - t0)}.`);
    }

    // 2. Index check
    const idxRows = await sql<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'listings' AND indexname = 'idx_listings_match_hash'
    `;

    if (idxRows.length > 0) {
      console.log("idx_listings_match_hash already present — skipping CREATE INDEX.");
    } else {
      console.log("Creating partial index idx_listings_match_hash (CONCURRENTLY).");
      const t0 = Date.now();
      // CONCURRENTLY cannot run inside a transaction block; sql.unsafe
      // sends it as a single statement outside postgres-js's implicit tx.
      await sql.unsafe(`
        CREATE INDEX CONCURRENTLY idx_listings_match_hash
        ON listings (match_hash)
        WHERE match_hash IS NOT NULL
      `);
      console.log(`  Index built in ${fmtMs(Date.now() - t0)}.`);
    }

    // 3. Sanity — count rows with a populated hash vs total active.
    const [stats] = await sql<Array<{ active: string; with_hash: string }>>`
      SELECT
        COUNT(*) FILTER (WHERE is_active = true)::text AS active,
        COUNT(*) FILTER (WHERE is_active = true AND match_hash IS NOT NULL)::text AS with_hash
      FROM listings
    `;
    console.log(
      `\nActive listings: ${stats.active}, with match_hash populated: ${stats.with_hash}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
