import { config } from "dotenv";
import { z } from "zod";

config({ path: "../../.env" });

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgresql://flat_finder:flat_finder_dev@localhost:5432/flat_finder"),
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
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}

export { envSchema };
