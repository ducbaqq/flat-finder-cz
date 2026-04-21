/**
 * Dry-run the Phase 2 image-refresh sweep against production.
 *
 * Does NOT write to DB (dryRun: true passed through). HEAD requests fire
 * but no re-enrichments actually persist. Purpose: confirm HEAD response
 * distribution across sources before enabling in the watch loop.
 *
 * NOTE: the `last_image_checked_at` column must exist first. If the
 * migration hasn't been applied, this script will still run but
 * pickStaleForImageCheck will error.
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

import { createDb } from "@flat-finder/db";
import { runImageRefreshSweep } from "../apps/scraper/src/refresh.js";
import type { BaseScraper } from "../apps/scraper/src/base-scraper.js";
import { getEnv } from "@flat-finder/config";

import { SrealityScraper } from "../apps/scraper/src/scrapers/sreality.js";
import { BezrealitkyScraper } from "../apps/scraper/src/scrapers/bezrealitky.js";
import { UlovDomovScraper } from "../apps/scraper/src/scrapers/ulovdomov.js";
import { BazosScraper } from "../apps/scraper/src/scrapers/bazos.js";
import { ERealityScraper } from "../apps/scraper/src/scrapers/ereality.js";
import { EurobydleniScraper } from "../apps/scraper/src/scrapers/eurobydleni.js";
import { CeskeRealityScraper } from "../apps/scraper/src/scrapers/ceskereality.js";
import { RealitymixScraper } from "../apps/scraper/src/scrapers/realitymix.js";
import { IdnesScraper } from "../apps/scraper/src/scrapers/idnes.js";
import { ReaLingoScraper } from "../apps/scraper/src/scrapers/realingo.js";

const env = getEnv();
const common = {
  maxRetries: env.SCRAPER_MAX_RETRIES,
  retryBaseMs: env.SCRAPER_RETRY_BASE_MS,
  timeoutMs: env.SCRAPER_TIMEOUT_MS,
};

const scrapers: Record<string, BaseScraper> = {
  sreality: new SrealityScraper({ ...common, rps: env.SREALITY_RPS, concurrency: env.SREALITY_CONCURRENCY }),
  bezrealitky: new BezrealitkyScraper({ ...common, rps: env.BEZREALITKY_RPS, concurrency: env.BEZREALITKY_CONCURRENCY }),
  ulovdomov: new UlovDomovScraper({ ...common, rps: env.ULOVDOMOV_RPS, concurrency: env.ULOVDOMOV_CONCURRENCY }),
  bazos: new BazosScraper({ ...common, rps: env.BAZOS_RPS, concurrency: env.BAZOS_CONCURRENCY }),
  ereality: new ERealityScraper({ ...common, rps: env.EREALITY_RPS, concurrency: env.EREALITY_CONCURRENCY }),
  eurobydleni: new EurobydleniScraper({ ...common, rps: env.EUROBYDLENI_RPS, concurrency: env.EUROBYDLENI_CONCURRENCY }),
  ceskereality: new CeskeRealityScraper({ ...common, rps: env.CESKEREALITY_RPS, concurrency: env.CESKEREALITY_CONCURRENCY, categoryParallelism: env.CESKEREALITY_CATEGORY_PARALLELISM }),
  realitymix: new RealitymixScraper({ ...common, rps: env.REALITYMIX_RPS, concurrency: env.REALITYMIX_CONCURRENCY }),
  idnes: new IdnesScraper({ ...common, rps: env.IDNES_RPS, concurrency: env.IDNES_CONCURRENCY, categoryParallelism: env.IDNES_CATEGORY_PARALLELISM }),
  realingo: new ReaLingoScraper({ ...common, rps: env.REALINGO_RPS, concurrency: env.REALINGO_CONCURRENCY }),
};

const SAMPLE_DURATION_MS = 120_000; // 2 minutes of HEAD sampling

const conn = createDb();
try {
  const stats = await runImageRefreshSweep(conn.db, scrapers, {
    deadlineMs: Date.now() + SAMPLE_DURATION_MS,
    dryRun: true,
    // A smaller batch size so we sample broadly rather than grinding through
    // one source's queue exhaustively.
    headBatchSize: 20,
    reenrichBatchSize: 3,
    staleDays: 7,
  });

  console.log("\n=== Dry-run summary ===");
  for (const [src, s] of Object.entries(stats)) {
    const rottedPct =
      s.checked > 0 ? ((s.rotted / s.checked) * 100).toFixed(1) : "0.0";
    console.log(
      `${src.padEnd(14)} checked=${s.checked} rotted=${s.rotted} (${rottedPct}%) ` +
        `stale-candidates=${s.reenrichedStale} errors=${s.errors}`,
    );
  }
} finally {
  await conn.sql.end();
}
