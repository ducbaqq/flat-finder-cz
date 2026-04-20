/**
 * One-shot ANALYZE listings — run after bulk column additions or data changes
 * so the query planner has fresh statistics for the new column values.
 *
 * Usage: npx tsx scripts/analyze-listings.ts
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
    console.log("Running ANALYZE listings...");
    const t0 = Date.now();
    await sql.unsafe("ANALYZE listings");
    console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
