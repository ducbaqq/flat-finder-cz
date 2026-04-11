/**
 * One-shot migration: drops idx_listings_seller_phone from production.
 *
 * The index was added in PR #4 for phone-based dedup clustering, which has
 * since been replaced by geo+size+price+transaction_type matching. The index
 * is no longer used.
 *
 * Uses DROP INDEX CONCURRENTLY IF EXISTS so it:
 *   - doesn't block writes against the listings table
 *   - is idempotent (safe to run twice)
 *
 * Usage: npx tsx scripts/drop-seller-phone-index.ts
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
    const before = await sql<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'listings' AND indexname = 'idx_listings_seller_phone'
    `;

    if (before.length === 0) {
      console.log("idx_listings_seller_phone not found — nothing to do.");
      return;
    }

    console.log("Dropping idx_listings_seller_phone (CONCURRENTLY, may take a moment)…");
    // CONCURRENTLY cannot run inside a transaction block.
    await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS idx_listings_seller_phone`);

    const after = await sql<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'listings' AND indexname = 'idx_listings_seller_phone'
    `;
    if (after.length === 0) {
      console.log("Dropped successfully.");
    } else {
      console.error("Drop did not take effect — index still present.");
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
