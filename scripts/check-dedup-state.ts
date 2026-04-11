/**
 * One-shot inspection: reports the current state of dedup-related schema
 * objects on the DB configured by .env.
 *
 * Usage: npx tsx scripts/check-dedup-state.ts
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

async function main() {
  const sql = connect();
  try {
    const cols = await sql<
      Array<{ column_name: string; data_type: string; column_default: string | null; is_nullable: string }>
    >`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'listings'
        AND column_name IN ('cluster_id', 'is_canonical')
      ORDER BY column_name
    `;

    const idx = await sql<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'listings'
        AND indexname IN (
          'idx_listings_cluster_id',
          'idx_listings_canonical',
          'idx_listings_seller_phone'
        )
      ORDER BY indexname
    `;

    console.log("=== Columns ===");
    const colNames = new Set(cols.map((c) => c.column_name));
    for (const expected of ["cluster_id", "is_canonical"]) {
      const c = cols.find((x) => x.column_name === expected);
      if (c) {
        console.log(`  ${c.column_name}: ${c.data_type} nullable=${c.is_nullable} default=${c.column_default ?? "—"}`);
      } else {
        console.log(`  ${expected}: MISSING`);
      }
    }

    console.log("\n=== Indexes ===");
    const idxNames = new Set(idx.map((i) => i.indexname));
    for (const expected of [
      "idx_listings_cluster_id",
      "idx_listings_canonical",
      "idx_listings_seller_phone",
    ]) {
      if (idxNames.has(expected)) {
        const row = idx.find((i) => i.indexname === expected);
        console.log(`  ${expected}: PRESENT`);
        console.log(`    ${row?.indexdef}`);
      } else {
        console.log(`  ${expected}: MISSING`);
      }
    }

    if (colNames.has("cluster_id") && colNames.has("is_canonical")) {
      const [s] = await sql<
        Array<{ total: string; active: string; clustered: string; canonical: string }>
      >`
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE is_active = true)::text AS active,
          COUNT(*) FILTER (WHERE cluster_id IS NOT NULL)::text AS clustered,
          COUNT(*) FILTER (WHERE is_canonical = true AND is_active = true)::text AS canonical
        FROM listings
      `;
      console.log("\n=== Row stats ===");
      console.log(`  total:     ${s.total}`);
      console.log(`  active:    ${s.active}`);
      console.log(`  clustered: ${s.clustered}  (rows with cluster_id IS NOT NULL)`);
      console.log(`  canonical: ${s.canonical}  (is_canonical = true AND is_active = true)`);
    } else {
      console.log("\n=== Row stats ===");
      console.log("  skipped (cluster_id / is_canonical do not both exist)");
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
