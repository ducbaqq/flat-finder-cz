/**
 * Inspect active queries on the DB. Diagnostic for long-running dedupe runs.
 *
 * Usage: npx tsx scripts/check-running-queries.ts
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
    const rows = await sql<
      Array<{
        pid: number;
        state: string;
        wait_event: string | null;
        duration: string;
        query: string;
      }>
    >`
      SELECT pid, state, wait_event,
        (now() - query_start)::text AS duration,
        LEFT(query, 500) AS query
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state <> 'idle'
        AND pid <> pg_backend_pid()
      ORDER BY query_start ASC
    `;

    if (rows.length === 0) {
      console.log("No active non-idle queries.");
      return;
    }

    for (const r of rows) {
      console.log(`pid=${r.pid} state=${r.state} wait=${r.wait_event ?? "—"} duration=${r.duration}`);
      console.log(`  ${r.query.replace(/\s+/g, " ").slice(0, 300)}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
