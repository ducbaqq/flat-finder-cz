import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@flat-finder/config";
import * as listingsSchema from "./schema/listings.js";
import * as watchdogsSchema from "./schema/watchdogs.js";
import * as scraperRunsSchema from "./schema/scraper-runs.js";

const schema = { ...listingsSchema, ...watchdogsSchema, ...scraperRunsSchema };

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!_db) {
    const env = getEnv();
    _sql = postgres(env.DATABASE_URL);
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
