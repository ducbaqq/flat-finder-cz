/**
 * Broad diagnostic for a slow/overloaded managed Postgres:
 *   - all backends (including idle, autovacuum, replication)
 *   - current autovacuum activity on listings
 *   - table + index bloat estimates
 *   - planner stat age (when was listings last analyzed?)
 *
 * Usage: npx tsx scripts/diag-db-cpu.ts
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
    console.log("=== All backends (including idle + autovacuum) ===");
    const activity = await sql<
      Array<{
        pid: number;
        backend_type: string;
        state: string | null;
        wait_event: string | null;
        duration: string | null;
        query: string | null;
      }>
    >`
      SELECT pid, backend_type, state, wait_event,
        CASE WHEN query_start IS NOT NULL
          THEN (now() - query_start)::text ELSE NULL END AS duration,
        LEFT(query, 200) AS query
      FROM pg_stat_activity
      WHERE datname IS NULL OR datname = current_database()
      ORDER BY query_start ASC NULLS LAST
    `;
    for (const r of activity) {
      const dur = r.duration ? ` dur=${r.duration}` : "";
      const wait = r.wait_event ? ` wait=${r.wait_event}` : "";
      const q = r.query ? ` :: ${r.query.replace(/\s+/g, " ").slice(0, 150)}` : "";
      console.log(`  pid=${r.pid} type=${r.backend_type} state=${r.state ?? "—"}${wait}${dur}${q}`);
    }

    console.log("\n=== listings table stats ===");
    const [stats] = await sql<
      Array<{
        n_live_tup: string;
        n_dead_tup: string;
        dead_pct: string | null;
        last_vacuum: string | null;
        last_autovacuum: string | null;
        last_analyze: string | null;
        last_autoanalyze: string | null;
        vacuum_count: string;
        autovacuum_count: string;
      }>
    >`
      SELECT
        n_live_tup::text, n_dead_tup::text,
        CASE WHEN n_live_tup > 0
          THEN ROUND(100.0 * n_dead_tup / n_live_tup, 1)::text
          ELSE NULL END AS dead_pct,
        last_vacuum::text, last_autovacuum::text,
        last_analyze::text, last_autoanalyze::text,
        vacuum_count::text, autovacuum_count::text
      FROM pg_stat_user_tables
      WHERE relname = 'listings'
    `;
    console.log(`  live tuples:     ${stats.n_live_tup}`);
    console.log(`  dead tuples:     ${stats.n_dead_tup}  (${stats.dead_pct ?? "?"}% of live)`);
    console.log(`  last vacuum:     ${stats.last_vacuum ?? "never"}`);
    console.log(`  last autovacuum: ${stats.last_autovacuum ?? "never"}`);
    console.log(`  last analyze:    ${stats.last_analyze ?? "never"}`);
    console.log(`  last autoanalyze:${stats.last_autoanalyze ?? "never"}`);
    console.log(`  vacuum count:    ${stats.vacuum_count}`);
    console.log(`  autovacuum count:${stats.autovacuum_count}`);

    console.log("\n=== Table + index sizes ===");
    const sizes = await sql<
      Array<{ relname: string; size: string; size_bytes: string }>
    >`
      SELECT
        c.relname,
        pg_size_pretty(pg_relation_size(c.oid)) AS size,
        pg_relation_size(c.oid)::text AS size_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND (c.relname = 'listings' OR c.relname LIKE 'idx_listings%')
      ORDER BY pg_relation_size(c.oid) DESC
    `;
    for (const r of sizes) {
      console.log(`  ${r.relname.padEnd(40)} ${r.size}`);
    }

    console.log("\n=== Long-running queries (duration > 30s) ===");
    const slow = await sql<
      Array<{ pid: number; duration: string; state: string; query: string }>
    >`
      SELECT pid, (now() - query_start)::text AS duration,
        state, LEFT(query, 300) AS query
      FROM pg_stat_activity
      WHERE state = 'active'
        AND query_start IS NOT NULL
        AND now() - query_start > interval '30 seconds'
      ORDER BY query_start ASC
    `;
    if (slow.length === 0) {
      console.log("  (none)");
    } else {
      for (const r of slow) {
        console.log(`  pid=${r.pid} dur=${r.duration} state=${r.state}`);
        console.log(`    ${r.query.replace(/\s+/g, " ").slice(0, 200)}`);
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
