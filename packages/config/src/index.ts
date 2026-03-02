import { config } from "dotenv";
import { z } from "zod";

config({ path: "../../.env" });

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
  APP_BASE_URL: z.string().default("https://flatfinder.cz"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Scraper config
  SREALITY_RPS: z.coerce.number().default(5),
  SREALITY_CONCURRENCY: z.coerce.number().default(10),
  BEZREALITKY_RPS: z.coerce.number().default(3),
  BEZREALITKY_CONCURRENCY: z.coerce.number().default(5),
  ULOVDOMOV_RPS: z.coerce.number().default(5),
  ULOVDOMOV_CONCURRENCY: z.coerce.number().default(10),
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
