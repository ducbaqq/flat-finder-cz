/**
 * EXPLAIN (no ANALYZE) for the Phase 1 dedupe query. Does not execute.
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
    const rows = await sql<Array<{ "QUERY PLAN": string }>>`
      EXPLAIN
      WITH duplicate_groups AS (
        SELECT
          md5(
            'geo|' || transaction_type || '|' ||
            ROUND(latitude::numeric, 4)::text || '|' ||
            ROUND(longitude::numeric, 4)::text || '|' ||
            ROUND(size_m2::numeric, 2)::text || '|' ||
            ROUND(price::numeric, 0)::text
          ) AS cluster_hash,
          MIN(id) AS canonical_id,
          array_agg(id) AS member_ids
        FROM listings
        WHERE is_active = true
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND size_m2 IS NOT NULL
          AND price IS NOT NULL
        GROUP BY
          transaction_type,
          ROUND(latitude::numeric, 4), ROUND(longitude::numeric, 4),
          ROUND(size_m2::numeric, 2), ROUND(price::numeric, 0)
        HAVING COUNT(*) > 1
      )
      UPDATE listings l
      SET
        cluster_id  = dg.cluster_hash,
        is_canonical = (l.id = dg.canonical_id)
      FROM duplicate_groups dg
      WHERE l.id = ANY(dg.member_ids)
    `;
    for (const r of rows) {
      console.log(r["QUERY PLAN"]);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
