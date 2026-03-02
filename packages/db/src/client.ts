import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv, getDatabaseUrl } from "@flat-finder/config";
import * as listingsSchema from "./schema/listings.js";
import * as watchdogsSchema from "./schema/watchdogs.js";
import * as scraperRunsSchema from "./schema/scraper-runs.js";

const schema = { ...listingsSchema, ...watchdogsSchema, ...scraperRunsSchema };

// ---------------------------------------------------------------------------
// SSL helpers
// ---------------------------------------------------------------------------

/** Resolve the CA cert path relative to the monorepo root (../../certs/). */
function getCaCertPath(): string {
  return path.resolve(import.meta.dirname, "../../../../certs/ca-certificate.crt");
}

function buildSslOption(): postgres.Options<Record<string, postgres.PostgresType>>["ssl"] {
  const env = getEnv();
  if (env.DB_SSLMODE === "disable") return false;

  const caPath = getCaCertPath();
  if (fs.existsSync(caPath)) {
    return { ca: fs.readFileSync(caPath, "utf-8"), rejectUnauthorized: true };
  }

  // Fallback: trust the server cert (no CA pinning)
  return { rejectUnauthorized: false };
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

function createPostgresClient(): ReturnType<typeof postgres> {
  const url = getDatabaseUrl();
  return postgres(url, { ssl: buildSslOption() });
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!_db) {
    _sql = createPostgresClient();
    _db = drizzle(_sql, { schema });
  }
  return _db;
}

export async function closeDb() {
  if (_sql) {
    await _sql.end();
    _sql = null;
    _db = null;
  }
}

export type Db = ReturnType<typeof getDb>;

/** Non-singleton factory: creates a fresh connection per call. Caller must close via sql.end(). */
export function createDb(): { db: Db; sql: ReturnType<typeof postgres> } {
  const sql = createPostgresClient();
  const db = drizzle(sql, { schema });
  return { db, sql };
}
