/**
 * Preview what the secondary `match_hash_no_price` hash WOULD cluster
 * if enabled. Computes the hash in-query (doesn't require the migration
 * to be applied yet) and shows the biggest groups so you can spot-check
 * for false positives before running --dedupe.
 *
 * Safe to run anytime — read-only.
 */

import postgres from "postgres";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const sql = postgres({
  host: process.env.DB_HOST!,
  port: Number(process.env.DB_PORT!),
  user: process.env.DB_USERNAME!,
  password: process.env.DB_PASSWORD!,
  database: process.env.DB_DATABASE!,
  ssl: { rejectUnauthorized: false },
});

const [summary] = await sql`
  WITH no_price AS (
    SELECT
      id, source, external_id, title, address, city, size_m2,
      transaction_type, latitude, longitude,
      seller_phone, seller_name, seller_company,
      md5(
        'geo-np|' || transaction_type || '|' ||
        ROUND(latitude::numeric, 4)::text || '|' ||
        ROUND(longitude::numeric, 4)::text || '|' ||
        ROUND(size_m2::numeric, 2)::text
      ) AS np_hash
    FROM listings
    WHERE is_active = true
      AND price IS NULL
      AND latitude IS NOT NULL AND longitude IS NOT NULL
      AND size_m2 IS NOT NULL AND size_m2 > 0
  ),
  grp AS (
    SELECT np_hash,
      COUNT(*) AS n,
      COUNT(DISTINCT source) AS sources,
      ARRAY_AGG(DISTINCT source) AS sources_list,
      MIN(size_m2) AS size_m2,
      MIN(transaction_type) AS transaction_type
    FROM no_price
    GROUP BY np_hash
    HAVING COUNT(*) > 1
  )
  SELECT
    COUNT(*) AS total_groups,
    SUM(n) AS total_rows,
    SUM(n - 1) AS rows_would_hide,
    COUNT(*) FILTER (WHERE sources > 1) AS cross_source_groups,
    MAX(n) AS largest_group
  FROM grp;
`;

console.log("--- Aggregate effect of enabling match_hash_no_price ---");
console.log(JSON.stringify(summary, null, 2));

const big = await sql`
  WITH no_price AS (
    SELECT id, source, title, address, size_m2, transaction_type,
      seller_phone, seller_name, seller_company,
      md5(
        'geo-np|' || transaction_type || '|' ||
        ROUND(latitude::numeric, 4)::text || '|' ||
        ROUND(longitude::numeric, 4)::text || '|' ||
        ROUND(size_m2::numeric, 2)::text
      ) AS np_hash
    FROM listings
    WHERE is_active = true
      AND price IS NULL
      AND latitude IS NOT NULL AND longitude IS NOT NULL
      AND size_m2 IS NOT NULL AND size_m2 > 0
  )
  SELECT np_hash,
    COUNT(*) AS n,
    ARRAY_AGG(DISTINCT source) AS sources,
    MIN(size_m2)::int AS size,
    MIN(transaction_type) AS txn,
    (ARRAY_AGG(title ORDER BY id))[1:5] AS sample_titles,
    ARRAY_AGG(DISTINCT seller_phone) FILTER (WHERE seller_phone IS NOT NULL) AS phones
  FROM no_price
  GROUP BY np_hash
  HAVING COUNT(*) > 1
  ORDER BY n DESC
  LIMIT 15;
`;

console.log("\n--- 15 largest would-be clusters (spot-check for false positives) ---");
for (const r of big) {
  console.log(
    `  n=${r.n}  size=${r.size}m² txn=${r.txn}  sources=${(r.sources as string[]).join(",")}  phones=${(r.phones as string[] | null)?.length ? (r.phones as string[]).join(",") : "-"}`,
  );
  const titles = r.sample_titles as string[] | null;
  if (titles) {
    for (const t of titles.slice(0, 3)) {
      console.log(`     · ${t?.slice(0, 80) ?? "(null title)"}`);
    }
  }
}

await sql.end();
