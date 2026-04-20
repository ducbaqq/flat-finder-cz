import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";

// Resolve .env relative to this file (packages/config/src/) → monorepo root
config({ path: path.resolve(import.meta.dirname, "../../../.env") });

const envSchema = z.object({
  // Database connection (individual fields → assembled into a URL)
  DB_USERNAME: z.string().default("flat_finder"),
  DB_PASSWORD: z.string().default("flat_finder_dev"),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(5432),
  DB_DATABASE: z.string().default("flat_finder"),
  DB_SSLMODE: z.string().default("disable"),

  BREVO_API_KEY: z.string().default(""),
  BREVO_TEMPLATE_ID: z.coerce.number().default(1),
  BREVO_SENDER_EMAIL: z.string().default("hlidac@flatfinder.cz"),
  BREVO_SENDER_NAME: z.string().default("Flat Finder CZ"),
  REPORT_PROBLEM_EMAIL: z.string().default("ducbaqq@gmail.com"),
  APP_BASE_URL: z.string().default("https://flatfinder.cz"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Scraper config — RPS/concurrency tuned via benchmark (2026-03-16)
  SREALITY_RPS: z.coerce.number().default(25),
  SREALITY_CONCURRENCY: z.coerce.number().default(50),
  BEZREALITKY_RPS: z.coerce.number().default(3),
  BEZREALITKY_CONCURRENCY: z.coerce.number().default(5),
  ULOVDOMOV_RPS: z.coerce.number().default(8),         // was 5, 0 errors at 5.13 eff RPS
  ULOVDOMOV_CONCURRENCY: z.coerce.number().default(10),
  BAZOS_RPS: z.coerce.number().default(20),
  BAZOS_CONCURRENCY: z.coerce.number().default(10),    // was 3, 32ms avg latency allows higher
  EREALITY_RPS: z.coerce.number().default(10),
  EREALITY_CONCURRENCY: z.coerce.number().default(8),  // was 3, 32% utilization at 10 RPS
  EUROBYDLENI_RPS: z.coerce.number().default(10),
  EUROBYDLENI_CONCURRENCY: z.coerce.number().default(8), // was 3, 30% utilization at 10 RPS
  CESKEREALITY_RPS: z.coerce.number().default(5),             // benchmarked: 429 cliff at ~8 conc, safe at 5
  CESKEREALITY_CONCURRENCY: z.coerce.number().default(5),    // 5.5 eff RPS at conc=3, 9.1 at conc=5
  CESKEREALITY_CATEGORY_PARALLELISM: z.coerce.number().default(4), // streaming interleave, no chunk blocking
  CESKEREALITY_SKIP_ENRICHMENT_HOURS: z.coerce.number().default(24),
  REALITYMIX_RPS: z.coerce.number().default(5),
  REALITYMIX_CONCURRENCY: z.coerce.number().default(5),  // was 3, 57% utilization
  IDNES_RPS: z.coerce.number().default(25),               // benchmarked: 0 errors at conc=50, no rate limiting
  IDNES_CONCURRENCY: z.coerce.number().default(25),      // 24 eff RPS at conc=40, diminishing after
  IDNES_CATEGORY_PARALLELISM: z.coerce.number().default(5), // streaming interleave, all categories fast
  IDNES_SKIP_ENRICHMENT_HOURS: z.coerce.number().default(24), // skip detail re-fetch if scraped within N hours
  REALINGO_RPS: z.coerce.number().default(5),
  REALINGO_CONCURRENCY: z.coerce.number().default(5),    // was 3, 56% utilization
  MAX_RETRIES: z.coerce.number().default(3),
  RETRY_BASE_MS: z.coerce.number().default(1000),
  PAGE_BATCH_MULTIPLIER: z.coerce.number().default(2),
  DETAIL_BATCH_SIZE: z.coerce.number().default(20),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(30000),

  // Watcher config
  WATCHER_INTERVAL_S: z.coerce.number().default(300),
  WATCHER_MAX_PAGES: z.coerce.number().default(3),
  WATCHER_DETAIL_CONCURRENCY: z.coerce.number().default(8),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}

/** Build a postgres:// connection URL from the individual DB_* env vars. */
export function getDatabaseUrl(env?: Env): string {
  const e = env ?? getEnv();
  const password = encodeURIComponent(e.DB_PASSWORD);
  return `postgresql://${e.DB_USERNAME}:${password}@${e.DB_HOST}:${e.DB_PORT}/${e.DB_DATABASE}`;
}

export { envSchema };
