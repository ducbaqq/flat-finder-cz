#!/usr/bin/env tsx
/**
 * Flat Finder CZ - Scraper CLI
 *
 * Runs one or all scrapers with parallel source execution.
 *
 * Modes:
 *   (default) Incremental — stops early per category when all listings are known
 *   --full    Full scan   — fetches everything, then deactivates stale listings
 *   --watch   Watcher     — loops continuously, checks newest pages only, enriches inline
 *
 * Usage:
 *   tsx src/index.ts                             # incremental (default)
 *   tsx src/index.ts --full                      # full scan + deactivation
 *   tsx src/index.ts --watch --interval 60       # watcher loop
 *   tsx src/index.ts --source sreality --dry-run # single source, no DB
 *   tsx src/index.ts --no-dashboard              # disable live dashboard
 */

import { getEnv } from "@flat-finder/config";
import {
  createDb,
  upsertListing,
  findExistingExternalIds,
  findRecentlyScrapedIds,
  createScraperRun,
  finishScraperRun,
  type Db,
  type NewListing,
} from "@flat-finder/db";
import type { ScraperResult } from "@flat-finder/types";
import type postgres from "postgres";

import type { BaseScraper } from "./base-scraper.js";
import { SrealityScraper } from "./scrapers/sreality.js";
import { BezrealitkyScraper } from "./scrapers/bezrealitky.js";
import { UlovDomovScraper } from "./scrapers/ulovdomov.js";
import { BazosScraper } from "./scrapers/bazos.js";
import { ERealityScraper } from "./scrapers/ereality.js";
import { EurobydleniScraper } from "./scrapers/eurobydleni.js";
import { CeskeRealityScraper } from "./scrapers/ceskereality.js";
import { RealitymixScraper } from "./scrapers/realitymix.js";
import { IdnesScraper } from "./scrapers/idnes.js";
import { ReaLingoScraper } from "./scrapers/realingo.js";
import { deactivateStale, deactivateByTtl, clusterDuplicates } from "./deactivator.js";
import { normalizeListingFields } from "./normalizer.js";
import { Dashboard } from "./dashboard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SourceName =
  | "sreality"
  | "bezrealitky"
  | "ulovdomov"
  | "bazos"
  | "ereality"
  | "eurobydleni"
  | "ceskereality"
  | "realitymix"
  | "idnes"
  | "realingo";

const ALL_SOURCES: SourceName[] = [
  "sreality",
  "bezrealitky",
  "ulovdomov",
  "bazos",
  "ereality",
  "eurobydleni",
  "ceskereality",
  "realitymix",
  "idnes",
  "realingo",
];

interface CliArgs {
  sources: SourceName[] | "all";
  dryRun: boolean;
  watch: boolean;
  full: boolean;
  cleanup: boolean;
  dedupe: boolean;
  interval: number;
  noDashboard: boolean;
}

interface SourceResult {
  source: SourceName;
  newCount: number;
  updatedCount: number;
  errorCount: number;
  deactivatedCount: number;
  elapsedMs: number;
  success: boolean;
  fatalError?: string;
}

interface RunSourceOpts {
  watch: boolean;
  full: boolean;
  dryRun: boolean;
  watcherDetailConcurrency: number;
  dashboard: Dashboard | null;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const env = getEnv();
  const opts: CliArgs = {
    sources: "all",
    dryRun: false,
    watch: false,
    full: false,
    cleanup: false,
    dedupe: false,
    interval: env.WATCHER_INTERVAL_S,
    noDashboard: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--source" && i + 1 < args.length) {
      const val = args[++i];
      if (val === "all") {
        opts.sources = "all";
      } else {
        const names = val.split(",").map((s) => s.trim());
        for (const name of names) {
          if (!ALL_SOURCES.includes(name as SourceName)) {
            console.error(
              `Invalid --source value: "${name}". Must be one of: ${ALL_SOURCES.join(", ")}, all`,
            );
            process.exit(2);
          }
        }
        opts.sources = names as SourceName[];
      }
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--watch") {
      opts.watch = true;
    } else if (arg === "--full") {
      opts.full = true;
    } else if (arg === "--cleanup") {
      opts.cleanup = true;
    } else if (arg === "--dedupe") {
      opts.dedupe = true;
    } else if (arg === "--no-dashboard") {
      opts.noDashboard = true;
    } else if (arg === "--interval" && i + 1 < args.length) {
      opts.interval = parseInt(args[++i], 10);
      if (isNaN(opts.interval) || opts.interval < 1) {
        console.error("Invalid --interval value. Must be a positive integer (seconds).");
        process.exit(2);
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Flat Finder CZ - Scraper

Usage:
  tsx src/index.ts [options]

Options:
  --source <names>    Comma-separated sources: ${ALL_SOURCES.join(",")} | all (default: all)
  --dry-run           Collect listings but do not save to database
  --watch             Run in watcher mode: loop continuously checking newest pages
  --full              Full scan: fetch all pages + deactivate stale listings
  --cleanup           Run TTL-based deactivation only (listings not scraped in 14 days)
  --dedupe            Cluster cross-source duplicates (phone + geo + layout matching)
  --no-dashboard      Disable the live terminal dashboard (auto-disabled for non-TTY)
  --interval <secs>   Seconds between watcher cycles (default: ${env.WATCHER_INTERVAL_S})
  --help, -h          Show this help message

Scheduling (SCR-11):
  Recommended cron expressions for production:
    # Incremental scrape every 4 hours
    0 */4 * * * cd /app && npm run scraper 2>&1 | tee -a /var/log/scraper.log
    # Full scrape + deactivation once daily at 3 AM
    0 3 * * * cd /app && npm run scraper -- --full 2>&1 | tee -a /var/log/scraper-full.log
    # TTL cleanup daily at 5 AM (as safety net)
    0 5 * * * cd /app && npm run scraper -- --cleanup 2>&1 | tee -a /var/log/scraper-cleanup.log
`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: "${arg}". Use --help for usage.`);
      process.exit(2);
    }
  }

  if (opts.watch && opts.full) {
    console.error("Cannot use --watch and --full together.");
    process.exit(2);
  }

  if (opts.cleanup && (opts.watch || opts.full)) {
    console.error("Cannot use --cleanup with --watch or --full.");
    process.exit(2);
  }

  if (opts.dedupe && (opts.watch || opts.full || opts.cleanup)) {
    console.error("Cannot use --dedupe with --watch, --full, or --cleanup.");
    process.exit(2);
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Scraper factory
// ---------------------------------------------------------------------------

function createScraper(source: SourceName, watchMode = false): BaseScraper {
  const env = getEnv();

  const common = {
    maxRetries: env.MAX_RETRIES,
    retryBaseMs: env.RETRY_BASE_MS,
    timeoutMs: env.REQUEST_TIMEOUT_MS,
    watchMode,
  };

  switch (source) {
    case "sreality":
      return new SrealityScraper({
        ...common,
        rps: env.SREALITY_RPS,
        concurrency: env.SREALITY_CONCURRENCY,
        batchMultiplier: env.PAGE_BATCH_MULTIPLIER,
        detailBatchSize: env.DETAIL_BATCH_SIZE,
      });
    case "bezrealitky":
      return new BezrealitkyScraper({
        ...common,
        rps: env.BEZREALITKY_RPS,
        concurrency: env.BEZREALITKY_CONCURRENCY,
        batchMultiplier: env.PAGE_BATCH_MULTIPLIER,
      });
    case "ulovdomov":
      return new UlovDomovScraper({
        ...common,
        rps: env.ULOVDOMOV_RPS,
        concurrency: env.ULOVDOMOV_CONCURRENCY,
        batchMultiplier: env.PAGE_BATCH_MULTIPLIER,
        detailBatchSize: env.DETAIL_BATCH_SIZE,
      });
    case "bazos":
      return new BazosScraper({
        ...common,
        rps: env.BAZOS_RPS,
        concurrency: env.BAZOS_CONCURRENCY,
      });
    case "ereality":
      return new ERealityScraper({
        ...common,
        rps: env.EREALITY_RPS,
        concurrency: env.EREALITY_CONCURRENCY,
      });
    case "eurobydleni":
      return new EurobydleniScraper({
        ...common,
        rps: env.EUROBYDLENI_RPS,
        concurrency: env.EUROBYDLENI_CONCURRENCY,
      });
    case "ceskereality":
      return new CeskeRealityScraper({
        ...common,
        rps: env.CESKEREALITY_RPS,
        concurrency: env.CESKEREALITY_CONCURRENCY,
        categoryParallelism: env.CESKEREALITY_CATEGORY_PARALLELISM,
        skipEnrichmentHours: env.CESKEREALITY_SKIP_ENRICHMENT_HOURS,
      });
    case "realitymix":
      return new RealitymixScraper({
        ...common,
        rps: env.REALITYMIX_RPS,
        concurrency: env.REALITYMIX_CONCURRENCY,
      });
    case "idnes":
      return new IdnesScraper({
        ...common,
        rps: env.IDNES_RPS,
        concurrency: env.IDNES_CONCURRENCY,
        categoryParallelism: env.IDNES_CATEGORY_PARALLELISM,
        skipEnrichmentHours: env.IDNES_SKIP_ENRICHMENT_HOURS,
      });
    case "realingo":
      return new ReaLingoScraper({
        ...common,
        rps: env.REALINGO_RPS,
        concurrency: env.REALINGO_CONCURRENCY,
      });
  }
}

// ---------------------------------------------------------------------------
// Convert ScraperResult -> NewListing (handle jsonb field differences)
// ---------------------------------------------------------------------------

// SCR-04: Non-Czech city blacklist
const CITY_BLACKLIST = new Set([
  "spanelsko", "spain", "espana",
  "nemecko", "germany", "deutschland",
  "rakousko", "austria",
  "polsko", "poland",
  "slovensko", "slovakia",
  "francie", "france",
  "italie", "italy",
]);

function toNewListing(result: ScraperResult): NewListing {
  // SCR-01: Apply cross-source normalization to all string-enum fields
  normalizeListingFields(result);

  // image_urls comes as a JSON string from the scraper; DB schema expects string[]
  let imageUrls: string[] = [];
  try {
    const parsed = JSON.parse(result.image_urls);
    if (Array.isArray(parsed)) imageUrls = parsed;
  } catch {
    imageUrls = [];
  }

  // additional_params comes as a JSON string; DB schema expects Record<string, unknown> | null
  let additionalParams: Record<string, unknown> | null = null;
  if (result.additional_params) {
    try {
      additionalParams = JSON.parse(result.additional_params);
    } catch {
      additionalParams = null;
    }
  }

  // --- SCR-10: Data validation before DB insert ---

  // Null out negative prices
  let price = result.price;
  if (price !== null && price < 0) price = null;

  // Validate coordinates are within Czech Republic bounds (lat 48.5-51.1, lng 12.0-18.9)
  let latitude = result.latitude;
  let longitude = result.longitude;
  if (latitude !== null && longitude !== null) {
    if (latitude < 48.5 || latitude > 51.1 || longitude < 12.0 || longitude > 18.9) {
      latitude = null;
      longitude = null;
    }
  } else {
    // If only one is present, null both
    if (latitude !== null || longitude !== null) {
      latitude = null;
      longitude = null;
    }
  }

  // SCR-04: Filter out non-Czech cities
  let city = result.city;
  if (city && CITY_BLACKLIST.has(city.toLowerCase().trim())) {
    city = null;
  }

  return {
    external_id: result.external_id,
    source: result.source,
    property_type: result.property_type,
    transaction_type: result.transaction_type,
    title: result.title,
    description: result.description,
    price,
    currency: result.currency,
    price_note: result.price_note,
    address: result.address,
    city,
    district: result.district,
    region: result.region,
    latitude,
    longitude,
    size_m2: result.size_m2,
    layout: result.layout,
    floor: result.floor,
    total_floors: result.total_floors,
    condition: result.condition,
    construction: result.construction,
    ownership: result.ownership,
    furnishing: result.furnishing,
    energy_rating: result.energy_rating,
    amenities: result.amenities,
    image_urls: imageUrls,
    thumbnail_url: result.thumbnail_url,
    source_url: result.source_url,
    listed_at: result.listed_at,
    scraped_at: result.scraped_at,
    is_active: result.is_active,
    deactivated_at: result.deactivated_at,
    seller_name: result.seller_name,
    seller_phone: result.seller_phone,
    seller_email: result.seller_email,
    seller_company: result.seller_company,
    additional_params: additionalParams,
  };
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

async function upsertBatch(
  db: Db,
  listings: ScraperResult[],
  log: (msg: string) => void,
): Promise<{ newCount: number; updatedCount: number; errorCount: number }> {
  let newCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const result of listings) {
    try {
      const newListing = toNewListing(result);
      const { isNew } = await upsertListing(db, newListing);
      if (isNew) newCount++;
      else updatedCount++;
    } catch (err) {
      errorCount++;
      if (errorCount <= 5) {
        log(`Error upserting ${result.external_id}: ${err}`);
      } else if (errorCount === 6) {
        log("(suppressing further upsert error logs)");
      }
    }
  }

  return { newCount, updatedCount, errorCount };
}

// ---------------------------------------------------------------------------
// Run a single source
// ---------------------------------------------------------------------------

async function runSource(
  source: SourceName,
  db: Db | null,
  opts: RunSourceOpts,
): Promise<SourceResult> {
  const t0 = performance.now();
  const dashboard = opts.dashboard;

  // Log function: route to dashboard if active, otherwise console.log
  const log = dashboard
    ? (msg: string) => dashboard.log(source, msg)
    : (msg: string) => console.log(`${ts()} [${source}]`, msg);

  log("Starting...");
  if (dashboard) dashboard.setStatus(source, "scanning");

  // Create a scraper run record (skip for dry-run)
  let runId: number | null = null;
  if (!opts.dryRun && db) {
    try {
      const run = await createScraperRun(db, { source, status: "running" });
      runId = run.id;
    } catch (err) {
      log(`Warning: could not create scraper run record: ${err}`);
    }
  }

  let newCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  let deactivatedCount = 0;

  try {
    const scraper = createScraper(source, opts.watch);

    if (opts.watch) {
      // ----------------------------------------------------------------
      // WATCH MODE: check newest pages only, enrich + upsert inline
      // ----------------------------------------------------------------
      const skippedCategories = new Set<string>();
      let lastCategory = "";

      for await (const page of scraper.fetchPages()) {
        if (page.category !== lastCategory) {
          lastCategory = page.category;
          if (dashboard) dashboard.setCategory(source, page.category);
        }

        if (dashboard) dashboard.addPageFetched(source, page.listings.length, page.totalPages);

        // Skip categories we've already decided to skip
        if (skippedCategories.has(page.category)) continue;

        if (opts.dryRun || !db) {
          log(`[DRY RUN] Page ${page.page}/${page.totalPages} of ${page.category}: ${page.listings.length} listings`);
          newCount += page.listings.length;
          if (dashboard) dashboard.addUpsertResults(source, page.listings.length, 0, 0);
          continue;
        }

        // Check which listings are already known
        const externalIds = page.listings.map((l) => l.external_id);
        const existing = await findExistingExternalIds(db, externalIds);
        const newListings = page.listings.filter((l) => !existing.has(l.external_id));

        // All known on this page -> skip rest of this category
        if (newListings.length === 0) {
          log(`  ${page.category} page ${page.page}: all known, skipping rest`);
          skippedCategories.add(page.category);
          scraper.skipCategory(page.category);
          continue;
        }

        log(`  ${page.category} page ${page.page}: ${newListings.length} new / ${page.listings.length} total`);

        // Enrich only new listings inline
        if (scraper.hasDetailPhase && newListings.length > 0) {
          if (dashboard) dashboard.setStatus(source, "enriching");
          await scraper.enrichListings(newListings, {
            concurrency: opts.watcherDetailConcurrency,
          });
          if (dashboard) dashboard.setStatus(source, "scanning");
        }

        // Upsert only new listings (watch mode skips known ones)
        const stats = await upsertBatch(db, newListings, log);
        newCount += stats.newCount;
        updatedCount += stats.updatedCount;
        errorCount += stats.errorCount;
        if (dashboard) dashboard.addUpsertResults(source, stats.newCount, stats.updatedCount, stats.errorCount);
      }
    } else if (opts.full) {
      // ----------------------------------------------------------------
      // FULL MODE: enrich + upsert per page, then deactivate stale
      // ----------------------------------------------------------------
      const seenIds = new Set<string>();
      let totalFetched = 0;

      for await (const page of scraper.fetchPages()) {
        totalFetched += page.listings.length;

        if (dashboard) {
          dashboard.setCategory(source, page.category);
          dashboard.addPageFetched(source, page.listings.length, page.totalPages);
        }

        if (opts.dryRun || !db) {
          log(`[DRY RUN] ${page.category} page ${page.page}: ${page.listings.length} listings`);
          newCount += page.listings.length;
          for (const l of page.listings) seenIds.add(l.external_id);
          if (dashboard) dashboard.addUpsertResults(source, page.listings.length, 0, 0);
          continue;
        }

        // Enrich this page's listings inline (not after all pages)
        // Skip detail enrichment for listings recently scraped (within skipEnrichmentHours)
        if (scraper.hasDetailPhase && page.listings.length > 0) {
          let toEnrich = page.listings;

          const skipHours = (scraper as any).skipEnrichmentHours;
          if (skipHours && skipHours > 0) {
            const externalIds = page.listings.map((l) => l.external_id);
            const recentlyScraped = await findRecentlyScrapedIds(db, externalIds, skipHours);
            if (recentlyScraped.size > 0) {
              toEnrich = page.listings.filter((l) => !recentlyScraped.has(l.external_id));
              if (toEnrich.length < page.listings.length) {
                log(`  Skipping enrichment for ${page.listings.length - toEnrich.length} recently-scraped listings`);
              }
            }
          }

          if (toEnrich.length > 0) {
            if (dashboard) dashboard.setStatus(source, "enriching");
            await scraper.enrichListings(toEnrich);
            if (dashboard) dashboard.setStatus(source, "scanning");
          }
        }

        // Upsert this page
        const stats = await upsertBatch(db, page.listings, log);
        newCount += stats.newCount;
        updatedCount += stats.updatedCount;
        errorCount += stats.errorCount;
        if (dashboard) dashboard.addUpsertResults(source, stats.newCount, stats.updatedCount, stats.errorCount);

        for (const l of page.listings) seenIds.add(l.external_id);

        if ((newCount + updatedCount) % 500 < page.listings.length) {
          log(`Progress: ${newCount + updatedCount} upserted (new=${newCount} updated=${updatedCount})`);
        }
      }

      log(`Fetched ${totalFetched} listings (full scan)`);

      if (!opts.dryRun && db) {
        log(`Upserted: new=${newCount} updated=${updatedCount} errors=${errorCount}`);

        // Deactivate stale listings
        try {
          deactivatedCount = await deactivateStale(db, source, seenIds);
          if (deactivatedCount > 0) {
            log(`Deactivated ${deactivatedCount} stale listings`);
          }
        } catch (err) {
          log(`Error during deactivation: ${err}`);
          errorCount++;
          if (dashboard) dashboard.addErrors(source, 1);
        }
      }
    } else {
      // ----------------------------------------------------------------
      // INCREMENTAL MODE (default): enrich + upsert per page, early-stop
      // ----------------------------------------------------------------
      const skippedCategories = new Set<string>();

      for await (const page of scraper.fetchPages()) {
        if (skippedCategories.has(page.category)) continue;

        if (dashboard) {
          dashboard.setCategory(source, page.category);
          dashboard.addPageFetched(source, page.listings.length, page.totalPages);
        }

        if (opts.dryRun || !db) {
          log(`[DRY RUN] ${page.category} page ${page.page}: ${page.listings.length} listings`);
          newCount += page.listings.length;
          if (dashboard) dashboard.addUpsertResults(source, page.listings.length, 0, 0);
          continue;
        }

        // Check if all listings on this page are already known
        const externalIds = page.listings.map((l) => l.external_id);
        const existing = await findExistingExternalIds(db, externalIds);
        if (externalIds.length > 0 && existing.size === externalIds.length) {
          log(`  ${page.category} page ${page.page}: all known, skipping rest of category`);
          skippedCategories.add(page.category);
          scraper.skipCategory(page.category);
          // Still upsert to refresh scraped_at
          const stats = await upsertBatch(db, page.listings, log);
          updatedCount += stats.updatedCount;
          errorCount += stats.errorCount;
          if (dashboard) dashboard.addUpsertResults(source, 0, stats.updatedCount, stats.errorCount);
          continue;
        }

        // Find new listings for enrichment
        const newListings = page.listings.filter((l) => !existing.has(l.external_id));

        if (newListings.length > 0) {
          log(`  ${page.category} page ${page.page}: ${newListings.length} new / ${page.listings.length} total`);
        }

        // Enrich only new listings (skip already-known ones for speed)
        if (scraper.hasDetailPhase && newListings.length > 0) {
          if (dashboard) dashboard.setStatus(source, "enriching");
          await scraper.enrichListings(newListings);
          if (dashboard) dashboard.setStatus(source, "scanning");
        }

        // Upsert the full page (new + updated)
        const stats = await upsertBatch(db, page.listings, log);
        newCount += stats.newCount;
        updatedCount += stats.updatedCount;
        errorCount += stats.errorCount;
        if (dashboard) dashboard.addUpsertResults(source, stats.newCount, stats.updatedCount, stats.errorCount);
      }

      if (!opts.dryRun && db) {
        log(`Upserted: new=${newCount} updated=${updatedCount} errors=${errorCount}`);
      }
      // No deactivation in incremental mode (didn't see everything)
    }

    // Finish the scraper run record
    const elapsedMs = Math.round(performance.now() - t0);

    if (runId != null && db) {
      try {
        await finishScraperRun(db, runId, {
          new_count: newCount,
          updated_count: updatedCount,
          error_count: errorCount,
          deactivated_count: deactivatedCount,
          elapsed_ms: elapsedMs,
          status: "completed",
        });
      } catch (err) {
        log(`Warning: could not finish scraper run record: ${err}`);
      }
    }

    log(`Done in ${(elapsedMs / 1000).toFixed(1)}s`);
    if (dashboard) dashboard.setStatus(source, "done");

    return {
      source,
      newCount,
      updatedCount,
      errorCount,
      deactivatedCount,
      elapsedMs,
      success: true,
    };
  } catch (err) {
    // Fatal error for this source
    const elapsedMs = Math.round(performance.now() - t0);
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Fatal error: ${errorMsg}`);
    if (dashboard) dashboard.setStatus(source, "error");

    if (runId != null && db) {
      try {
        await finishScraperRun(db, runId, {
          new_count: newCount,
          updated_count: updatedCount,
          error_count: errorCount + 1,
          deactivated_count: deactivatedCount,
          elapsed_ms: elapsedMs,
          status: "failed",
          error_message: errorMsg,
        });
      } catch (finishErr) {
        log(`Warning: could not finish scraper run record: ${finishErr}`);
      }
    }

    return {
      source,
      newCount,
      updatedCount,
      errorCount: errorCount + 1,
      deactivatedCount,
      elapsedMs,
      success: false,
      fatalError: errorMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// Run a full cycle (all sources in parallel)
// ---------------------------------------------------------------------------

async function runCycle(
  sources: SourceName[],
  opts: RunSourceOpts,
): Promise<SourceResult[]> {
  // Create independent DB connections per source
  const connections: Array<{ db: Db; sql: ReturnType<typeof postgres> } | null> =
    opts.dryRun ? sources.map(() => null) : sources.map(() => createDb());

  const settledResults = await Promise.allSettled(
    sources.map((src, i) =>
      runSource(src, connections[i]?.db ?? null, opts),
    ),
  );

  // Close all connections
  for (const c of connections) {
    if (c) {
      try {
        await c.sql.end();
      } catch {
        // ignore close errors
      }
    }
  }

  // Unwrap settled results
  return settledResults.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const err = r.reason instanceof Error ? r.reason.message : String(r.reason);
    console.error(`${ts()} [runner] Unexpected error for ${sources[i]}:`, r.reason);
    return {
      source: sources[i],
      newCount: 0,
      updatedCount: 0,
      errorCount: 1,
      deactivatedCount: 0,
      elapsedMs: 0,
      success: false,
      fatalError: err,
    };
  });
}

// ---------------------------------------------------------------------------
// Print summary
// ---------------------------------------------------------------------------

function printSummary(results: SourceResult[]): void {
  const t = ts();
  console.log("");
  console.log(`${t} ${"=".repeat(60)}`);
  console.log(`${t} Summary:`);
  for (const r of results) {
    const status = r.success ? "OK" : "FAILED";
    console.log(
      `${t}   ${r.source.padEnd(15)} [${status.padEnd(6)}] ` +
        `new=${String(r.newCount).padEnd(6)} ` +
        `updated=${String(r.updatedCount).padEnd(6)} ` +
        `errors=${String(r.errorCount).padEnd(4)} ` +
        `deactivated=${String(r.deactivatedCount).padEnd(4)} ` +
        `time=${(r.elapsedMs / 1000).toFixed(1)}s`,
    );
  }
  console.log(`${t} ${"=".repeat(60)}`);

  // SCR-08: Scraper failure alerting
  checkAndAlertFailures(results);
}

// ---------------------------------------------------------------------------
// SCR-08: Failure alerting
// ---------------------------------------------------------------------------

function checkAndAlertFailures(results: SourceResult[]): void {
  const failures = results.filter((r) => !r.success);
  const highErrors = results.filter((r) => r.success && r.errorCount > r.newCount && r.errorCount > 10);

  if (failures.length === 0 && highErrors.length === 0) return;

  const t = ts();

  if (failures.length > 0) {
    console.error(`${t} [ALERT] ${failures.length} scraper(s) FAILED:`);
    for (const f of failures) {
      console.error(`${t} [ALERT]   ${f.source}: ${f.fatalError ?? "unknown error"}`);
    }
  }

  if (highErrors.length > 0) {
    console.error(`${t} [ALERT] ${highErrors.length} scraper(s) have HIGH ERROR RATES:`);
    for (const h of highErrors) {
      console.error(
        `${t} [ALERT]   ${h.source}: ${h.errorCount} errors vs ${h.newCount} new (error rate > 100%)`,
      );
    }
  }

  // Log a structured JSON alert that can be picked up by log monitoring systems
  // (e.g., Datadog, CloudWatch, or a simple log watcher script)
  const alertPayload = {
    type: "scraper_alert",
    timestamp: new Date().toISOString(),
    failed_sources: failures.map((f) => ({
      source: f.source,
      error: f.fatalError,
      elapsed_ms: f.elapsedMs,
    })),
    high_error_sources: highErrors.map((h) => ({
      source: h.source,
      error_count: h.errorCount,
      new_count: h.newCount,
    })),
  };
  console.error(`${t} [ALERT] ${JSON.stringify(alertPayload)}`);
}

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Console suppression for dashboard mode
// ---------------------------------------------------------------------------

/** Monkey-patch console.log/warn to suppress output while dashboard is active. */
function suppressConsole(dashboard: Dashboard): { restore: () => void } {
  const origLog = console.log;
  const origWarn = console.warn;

  console.log = (...args: unknown[]) => {
    // Route to dashboard log buffer. Extract source prefix if present.
    const msg = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    const match = msg.match(/\[(\w+)\]\s*(.*)/);
    if (match) {
      dashboard.log(match[1], match[2]);
    } else {
      dashboard.log("runner", msg);
    }
  };

  console.warn = (...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    const match = msg.match(/\[(\w+)\]\s*(.*)/);
    if (match) {
      dashboard.log(match[1], msg);
    } else {
      dashboard.log("runner", msg);
    }
  };

  return {
    restore: () => {
      console.log = origLog;
      console.warn = origWarn;
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { sources: sourcesArg, dryRun, watch, full, cleanup, dedupe, interval, noDashboard } = parseArgs();
  const env = getEnv();

  const sources: SourceName[] =
    sourcesArg === "all" ? ALL_SOURCES : sourcesArg;

  const mode = cleanup ? "CLEANUP" : dedupe ? "DEDUPE" : watch ? "WATCH" : full ? "FULL" : "INCREMENTAL";

  // Decide whether to use the dashboard:
  // - Default ON when stdout is a TTY
  // - OFF when --no-dashboard is specified
  // - OFF when stdout is not a TTY (piped output)
  // - OFF for cleanup mode (short-lived, no parallel sources)
  const useDashboard = !noDashboard && !cleanup && !dedupe && process.stdout.isTTY === true;

  let dashboard: Dashboard | null = null;
  let consoleRestore: (() => void) | null = null;

  if (useDashboard) {
    dashboard = new Dashboard(sources);
  }

  if (!useDashboard) {
    // Original banner for non-dashboard mode
    console.log("=".repeat(60));
    console.log("Flat Finder CZ - Scraper");
    console.log(`Sources:  ${sources.join(", ")}`);
    console.log(`Mode:     ${mode}`);
    if (dryRun) console.log("          DRY RUN (no DB writes)");
    if (watch) console.log(`Interval: ${interval}s`);
    console.log("=".repeat(60));
  }

  // Graceful shutdown -- exit with 0 so npm doesn't print errors
  let shouldStop = false;
  const onSignal = (signal: string) => {
    // Clean up dashboard terminal state before anything else
    if (dashboard) {
      dashboard.cleanup();
      if (consoleRestore) consoleRestore();
    }

    if (!watch) {
      // Non-watch mode: exit immediately on first signal
      console.log(`\n${ts()} [runner] Received ${signal}, exiting.`);
      process.exit(0);
    }
    if (shouldStop) {
      // Watch mode, second signal -> force exit
      console.log(`\n${ts()} [runner] Received ${signal} again, forcing exit.`);
      process.exit(0);
    }
    console.log(`\n${ts()} [runner] Received ${signal}, stopping after current cycle...`);
    shouldStop = true;
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  const runOpts: RunSourceOpts = {
    watch,
    full,
    dryRun,
    watcherDetailConcurrency: env.WATCHER_DETAIL_CONCURRENCY,
    dashboard,
  };

  // SCR-09: Standalone cleanup mode -- TTL deactivation only
  if (cleanup) {
    console.log(`${ts()} [runner] Running TTL-based deactivation (14 day threshold)...`);
    if (!dryRun) {
      const conn = createDb();
      try {
        const deactivated = await deactivateByTtl(conn.db, 14);
        console.log(`${ts()} [runner] TTL deactivation complete: ${deactivated} listings deactivated`);
      } finally {
        await conn.sql.end();
      }
    } else {
      console.log(`${ts()} [runner] DRY RUN -- skipping TTL deactivation`);
    }
    process.exit(0);
  }

  // Standalone dedupe mode -- cluster cross-source duplicates (phone + geo + layout)
  if (dedupe) {
    console.log(`${ts()} [runner] Running deduplication (phone + geo + layout clustering)...`);
    if (!dryRun) {
      const conn = createDb();
      try {
        const { clustered, clusters } = await clusterDuplicates(conn.db);
        console.log(
          `${ts()} [runner] Deduplication complete: ${clusters} clusters, ${clustered} listings grouped`,
        );
      } finally {
        await conn.sql.end();
      }
    } else {
      console.log(`${ts()} [runner] DRY RUN -- skipping deduplication`);
    }
    process.exit(0);
  }

  if (watch) {
    let cycle = 0;
    while (!shouldStop) {
      cycle++;

      if (!useDashboard) {
        console.log(`\n${ts()} --- Watcher cycle ${cycle} ---`);
      }

      // Start dashboard for this cycle
      if (dashboard) {
        dashboard.start();
        consoleRestore = suppressConsole(dashboard).restore;
      }

      const results = await runCycle(sources, runOpts);

      // Stop dashboard, restore console, print summary
      if (dashboard) {
        dashboard.stop();
        if (consoleRestore) {
          consoleRestore();
          consoleRestore = null;
        }
      }

      printSummary(results);

      if (shouldStop) break;

      console.log(`${ts()} [runner] Sleeping ${interval}s until next cycle...`);
      await sleep(interval * 1000);

      // Reset dashboard for next cycle
      if (useDashboard) {
        dashboard = new Dashboard(sources);
        runOpts.dashboard = dashboard;
      }
    }

    console.log(`${ts()} [runner] Watcher stopped.`);
  } else {
    // Start dashboard
    if (dashboard) {
      dashboard.start();
      consoleRestore = suppressConsole(dashboard).restore;
    }

    const results = await runCycle(sources, runOpts);

    // Stop dashboard, restore console
    if (dashboard) {
      dashboard.stop();
      if (consoleRestore) {
        consoleRestore();
        consoleRestore = null;
      }
    }

    printSummary(results);

    // SCR-09: Run TTL-based deactivation after incremental/full scrapes as a safety net
    if (!dryRun) {
      const conn = createDb();
      try {
        const ttlDeactivated = await deactivateByTtl(conn.db, 14);
        if (ttlDeactivated > 0) {
          console.log(`${ts()} [runner] TTL deactivation: ${ttlDeactivated} stale listings (>14 days)`);
        }
      } catch (err) {
        console.error(`${ts()} [runner] TTL deactivation error: ${err}`);
      } finally {
        await conn.sql.end();
      }
    }

    // Exit with code 1 if any scraper failed
    const anyFailed = results.some((r) => !r.success);
    process.exit(anyFailed ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`${ts()} [runner] Fatal error:`, err);
  process.exit(1);
});
