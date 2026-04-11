/**
 * Rollback script for `prune-listings-indexes.ts`.
 *
 * Re-creates the 7 indexes that were dropped during the 2026-04-11 index
 * pruning pass. Uses `CREATE INDEX CONCURRENTLY IF NOT EXISTS` so it:
 *   - Does NOT block concurrent writes on listings
 *   - Is idempotent (safe to re-run)
 *   - Can be run partially if some indexes are already back
 *
 * Only needed if a query regresses after the prune. The Drizzle schema
 * in `packages/db/src/schema/listings.ts` no longer declares these
 * indexes, so running this script puts the database out of sync with
 * the code's view of the schema — that's fine for an emergency rollback,
 * but you'll want to restore the schema declarations in the code too if
 * the regression is confirmed to need them permanently.
 *
 * Usage: npx tsx scripts/restore-listings-indexes.ts
 */
import { config } from "dotenv";
config();

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const INDEXES_TO_RESTORE: Array<{ name: string; create: string }> = [
  {
    name: "idx_listings_external_id",
    create: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_external_id ON listings (external_id)",
  },
  {
    name: "idx_listings_city",
    create: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_city ON listings (city)",
  },
  {
    name: "idx_listings_price",
    create: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_price ON listings (price)",
  },
  {
    name: "idx_listings_source",
    create: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_source ON listings (source)",
  },
  {
    name: "idx_listings_property_type",
    create: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_property_type ON listings (property_type)",
  },
  {
    name: "idx_listings_transaction_type",
    create: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_transaction_type ON listings (transaction_type)",
  },
  {
    name: "idx_listings_region",
    create: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_region ON listings (region)",
  },
];

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
    console.log("=== Restoring dropped indexes (CONCURRENTLY) ===");
    console.log("(Each CREATE is idempotent via IF NOT EXISTS.)\n");

    for (const idx of INDEXES_TO_RESTORE) {
      const t0 = Date.now();
      process.stdout.write(`  ${idx.name.padEnd(45)} `);
      try {
        await sql.unsafe(idx.create);
        process.stdout.write(`${Date.now() - t0} ms\n`);
      } catch (err) {
        process.stdout.write(`FAILED: ${(err as Error).message}\n`);
      }
    }

    // Verify everything landed
    const present = await sql<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'listings'
    `;
    const presentSet = new Set(present.map((r) => r.indexname));
    const missing = INDEXES_TO_RESTORE.filter((i) => !presentSet.has(i.name));

    console.log("\n=== Verification ===");
    if (missing.length === 0) {
      console.log(`  All ${INDEXES_TO_RESTORE.length} indexes are present.`);
    } else {
      console.error(`  MISSING ${missing.length} indexes:`);
      for (const m of missing) console.error(`    - ${m.name}`);
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
