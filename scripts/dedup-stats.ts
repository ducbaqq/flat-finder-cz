/**
 * Detailed post-dedup stats: cluster count, size distribution, cross-source span,
 * biggest clusters. Read-only — safe to run any time.
 *
 * Usage: npx tsx scripts/dedup-stats.ts
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
    // Overall numbers
    const [totals] = await sql<
      Array<{ total: string; active: string; clustered: string; canonical: string; clusters: string }>
    >`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE is_active = true)::text AS active,
        COUNT(*) FILTER (WHERE cluster_id IS NOT NULL AND is_active = true)::text AS clustered,
        COUNT(*) FILTER (WHERE is_canonical = true AND is_active = true)::text AS canonical,
        COUNT(DISTINCT cluster_id) FILTER (WHERE cluster_id IS NOT NULL AND is_active = true)::text AS clusters
      FROM listings
    `;

    console.log("=== Overall ===");
    console.log(`  total rows:        ${totals.total}`);
    console.log(`  active rows:       ${totals.active}`);
    console.log(`  canonical rows:    ${totals.canonical}  ← visible in search (is_active AND is_canonical)`);
    console.log(`  clustered rows:    ${totals.clustered}  ← members of a cluster`);
    console.log(`  distinct clusters: ${totals.clusters}`);
    const hidden = Number(totals.active) - Number(totals.canonical);
    console.log(`  hidden duplicates: ${hidden}  ← siblings that disappear from search`);

    // Size distribution
    const dist = await sql<Array<{ size: number; n: string }>>`
      SELECT cluster_size::int AS size, COUNT(*)::text AS n
      FROM (
        SELECT cluster_id, COUNT(*) AS cluster_size
        FROM listings
        WHERE cluster_id IS NOT NULL AND is_active = true
        GROUP BY cluster_id
      ) s
      GROUP BY cluster_size
      ORDER BY cluster_size
    `;
    console.log("\n=== Cluster size distribution ===");
    for (const row of dist) {
      console.log(`  size ${row.size}: ${row.n} clusters`);
    }

    // Cross-source span: how many sources appear per cluster
    const span = await sql<Array<{ source_span: number; n: string }>>`
      SELECT source_span::int, COUNT(*)::text AS n
      FROM (
        SELECT cluster_id, COUNT(DISTINCT source) AS source_span
        FROM listings
        WHERE cluster_id IS NOT NULL AND is_active = true
        GROUP BY cluster_id
      ) s
      GROUP BY source_span
      ORDER BY source_span
    `;
    console.log("\n=== Cross-source span (distinct sources per cluster) ===");
    for (const row of span) {
      console.log(`  ${row.source_span} source(s): ${row.n} clusters`);
    }

    // Biggest clusters — sanity check for false positives
    const biggest = await sql<
      Array<{ cluster_id: string; size: number; sources: string; min_price: number | null; max_price: number | null }>
    >`
      SELECT cluster_id,
        COUNT(*)::int AS size,
        string_agg(DISTINCT source, ', ') AS sources,
        MIN(price) AS min_price,
        MAX(price) AS max_price
      FROM listings
      WHERE cluster_id IS NOT NULL AND is_active = true
      GROUP BY cluster_id
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `;
    console.log("\n=== Top 10 biggest clusters (sanity check) ===");
    for (const r of biggest) {
      const spread =
        r.min_price != null && r.max_price != null && r.min_price !== r.max_price
          ? ` price ${r.min_price}–${r.max_price}`
          : "";
      console.log(`  size=${r.size}  sources=[${r.sources}]${spread}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
