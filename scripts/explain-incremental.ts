/**
 * EXPLAIN ANALYZE the incremental-dedup pipeline to understand slow plans.
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
    await sql`SET statement_timeout = 0`;
    await sql`SET work_mem = '256MB'`;

    const plan = await sql.unsafe(`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      WITH candidates AS (
        SELECT id, match_hash
        FROM listings
        WHERE is_active = true
          AND cluster_id IS NULL
          AND match_hash IS NOT NULL
      ),
      resolved AS (
        SELECT
          c.id,
          c.match_hash,
          EXISTS (
            SELECT 1 FROM listings l
            WHERE l.match_hash = c.match_hash
              AND l.cluster_id IS NOT NULL
              AND l.is_active = true
          ) AS existing_cluster,
          COUNT(*) OVER (PARTITION BY c.match_hash) AS hash_peers,
          MIN(c.id) OVER (PARTITION BY c.match_hash) AS new_canonical_id
        FROM candidates c
      )
      SELECT COUNT(*) FROM resolved WHERE existing_cluster OR hash_peers > 1
    `);
    for (const row of plan as Array<Record<string, string>>) {
      console.log(row["QUERY PLAN"]);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
