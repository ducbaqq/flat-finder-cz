/**
 * Forcibly disconnect a DB backend by pid using pg_terminate_backend.
 * Stronger than pg_cancel_backend — closes the session entirely.
 * Usage: npx tsx scripts/terminate-query.ts <pid>
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
  const pid = Number(process.argv[2]);
  if (!pid) {
    console.error("Usage: npx tsx scripts/terminate-query.ts <pid>");
    process.exit(1);
  }

  const sql = connect();
  try {
    const [result] = await sql<Array<{ terminated: boolean }>>`
      SELECT pg_terminate_backend(${pid}) AS terminated
    `;
    console.log(`pg_terminate_backend(${pid}) => ${result.terminated}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
