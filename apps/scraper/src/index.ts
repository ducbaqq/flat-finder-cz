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
 */

import { getEnv } from "@flat-finder/config";
import {
  createDb,
  upsertListing,
  findExistingExternalIds,
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
import { deactivateStale } from "./deactivator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SourceName = "sreality" | "bezrealitky" | "ulovdomov";

const ALL_SOURCES: SourceName[] = ["sreality", "bezrealitky", "ulovdomov"];

interface CliArgs {
  source: SourceName | "all";
  dryRun: boolean;
  watch: boolean;
  full: boolean;
  interval: number;
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
  watcherMaxPages: number;
  watcherDetailConcurrency: number;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const env = getEnv();
  const opts: CliArgs = {
    source: "all",
    dryRun: false,
    watch: false,
    full: false,
    interval: env.WATCHER_INTERVAL_S,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--source" && i + 1 < args.length) {
      const val = args[++i];
      if (!["sreality", "bezrealitky", "ulovdomov", "all"].includes(val)) {
        console.error(
          `Invalid --source value: "${val}". Must be one of: sreality, bezrealitky, ulovdomov, all`,
        );
        process.exit(2);
      }
      opts.source = val as CliArgs["source"];
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--watch") {
      opts.watch = true;
    } else if (arg === "--full") {
      opts.full = true;
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
  --source <name>     Which source to scrape: sreality | bezrealitky | ulovdomov | all (default: all)
  --dry-run           Collect listings but do not save to database
  --watch             Run in watcher mode: loop continuously checking newest pages
  --full              Full scan: fetch all pages + deactivate stale listings
  --interval <secs>   Seconds between watcher cycles (default: ${env.WATCHER_INTERVAL_S})
  --help, -h          Show this help message
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

  return opts;
}

// ---------------------------------------------------------------------------
// Scraper factory
// ---------------------------------------------------------------------------

function createScraper(source: SourceName): BaseScraper {
  const env = getEnv();

  const common = {
    maxRetries: env.MAX_RETRIES,
    retryBaseMs: env.RETRY_BASE_MS,
    timeoutMs: env.REQUEST_TIMEOUT_MS,
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
  }
}

// ---------------------------------------------------------------------------
// Convert ScraperResult -> NewListing (handle jsonb field differences)
// ---------------------------------------------------------------------------

function toNewListing(result: ScraperResult): NewListing {
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

  return {
    external_id: result.external_id,
    source: result.source,
    property_type: result.property_type,
    transaction_type: result.transaction_type,
    title: result.title,
    description: result.description,
    price: result.price,
    currency: result.currency,
    price_note: result.price_note,
    address: result.address,
    city: result.city,
    district: result.district,
    region: result.region,
    latitude: result.latitude,
    longitude: result.longitude,
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
  const log = (msg: string) => console.log(`${ts()} [${source}]`, msg);

  log("Starting...");

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
    const scraper = createScraper(source);

    if (opts.watch) {
      // ----------------------------------------------------------------
      // WATCH MODE: check newest pages only, enrich + upsert inline
      // ----------------------------------------------------------------
      const maxPages = opts.watcherMaxPages;
      const skippedCategories = new Set<string>();
      let lastCategory = "";
      let categoryPageCount = 0;

      for await (const page of scraper.fetchPages()) {
        // Track pages per category
        if (page.category !== lastCategory) {
          lastCategory = page.category;
          categoryPageCount = 0;
        }
        categoryPageCount++;

        // Skip categories we've already decided to skip
        if (skippedCategories.has(page.category)) continue;

        // Limit pages per category in watch mode
        if (categoryPageCount > maxPages) {
          skippedCategories.add(page.category);
          continue;
        }

        if (opts.dryRun || !db) {
          log(`[DRY RUN] Page ${page.page}/${page.totalPages} of ${page.category}: ${page.listings.length} listings`);
          newCount += page.listings.length;
          continue;
        }

        // Check which listings are already known
        const externalIds = page.listings.map((l) => l.external_id);
        const existing = await findExistingExternalIds(db, externalIds);
        const newListings = page.listings.filter((l) => !existing.has(l.external_id));

        // All known on this page → skip rest of this category
        if (newListings.length === 0) {
          log(`  ${page.category} page ${page.page}: all known, skipping rest`);
          skippedCategories.add(page.category);
          // Still upsert the page to update scraped_at etc.
          const stats = await upsertBatch(db, page.listings, log);
          updatedCount += stats.updatedCount;
          errorCount += stats.errorCount;
          continue;
        }

        log(`  ${page.category} page ${page.page}: ${newListings.length} new / ${page.listings.length} total`);

        // Enrich only new listings inline
        if (scraper.hasDetailPhase && newListings.length > 0) {
          await scraper.enrichListings(newListings, {
            concurrency: opts.watcherDetailConcurrency,
          });
        }

        // Upsert the full page (new + updated)
        const stats = await upsertBatch(db, page.listings, log);
        newCount += stats.newCount;
        updatedCount += stats.updatedCount;
        errorCount += stats.errorCount;
      }
    } else if (opts.full) {
      // ----------------------------------------------------------------
      // FULL MODE: enrich + upsert per page, then deactivate stale
      // ----------------------------------------------------------------
      const seenIds = new Set<string>();
      let totalFetched = 0;

      for await (const page of scraper.fetchPages()) {
        totalFetched += page.listings.length;

        if (opts.dryRun || !db) {
          log(`[DRY RUN] ${page.category} page ${page.page}: ${page.listings.length} listings`);
          newCount += page.listings.length;
          for (const l of page.listings) seenIds.add(l.external_id);
          continue;
        }

        // Enrich this page's listings inline (not after all pages)
        if (scraper.hasDetailPhase && page.listings.length > 0) {
          await scraper.enrichListings(page.listings);
        }

        // Upsert this page
        const stats = await upsertBatch(db, page.listings, log);
        newCount += stats.newCount;
        updatedCount += stats.updatedCount;
        errorCount += stats.errorCount;

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
        }
      }
    } else {
      // ----------------------------------------------------------------
      // INCREMENTAL MODE (default): enrich + upsert per page, early-stop
      // ----------------------------------------------------------------
      const skippedCategories = new Set<string>();

      for await (const page of scraper.fetchPages()) {
        if (skippedCategories.has(page.category)) continue;

        if (opts.dryRun || !db) {
          log(`[DRY RUN] ${page.category} page ${page.page}: ${page.listings.length} listings`);
          newCount += page.listings.length;
          continue;
        }

        // Check if all listings on this page are already known
        const externalIds = page.listings.map((l) => l.external_id);
        const existing = await findExistingExternalIds(db, externalIds);
        if (externalIds.length > 0 && existing.size === externalIds.length) {
          log(`  ${page.category} page ${page.page}: all known, skipping rest of category`);
          skippedCategories.add(page.category);
          // Still upsert to refresh scraped_at
          const stats = await upsertBatch(db, page.listings, log);
          updatedCount += stats.updatedCount;
          errorCount += stats.errorCount;
          continue;
        }

        // Find new listings for enrichment
        const newListings = page.listings.filter((l) => !existing.has(l.external_id));

        if (newListings.length > 0) {
          log(`  ${page.category} page ${page.page}: ${newListings.length} new / ${page.listings.length} total`);
        }

        // Enrich only new listings (skip already-known ones for speed)
        if (scraper.hasDetailPhase && newListings.length > 0) {
          await scraper.enrichListings(newListings);
        }

        // Upsert the full page (new + updated)
        const stats = await upsertBatch(db, page.listings, log);
        newCount += stats.newCount;
        updatedCount += stats.updatedCount;
        errorCount += stats.errorCount;
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
}

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { source, dryRun, watch, full, interval } = parseArgs();
  const env = getEnv();

  const sources: SourceName[] =
    source === "all" ? ALL_SOURCES : [source];

  const mode = watch ? "WATCH" : full ? "FULL" : "INCREMENTAL";

  console.log("=".repeat(60));
  console.log("Flat Finder CZ - Scraper");
  console.log(`Sources:  ${sources.join(", ")}`);
  console.log(`Mode:     ${mode}`);
  if (dryRun) console.log("          DRY RUN (no DB writes)");
  if (watch) console.log(`Interval: ${interval}s`);
  console.log("=".repeat(60));

  // Graceful shutdown — exit with 0 so npm doesn't print errors
  let shouldStop = false;
  const onSignal = (signal: string) => {
    if (!watch) {
      // Non-watch mode: exit immediately on first signal
      console.log(`\n${ts()} [runner] Received ${signal}, exiting.`);
      process.exit(0);
    }
    if (shouldStop) {
      // Watch mode, second signal → force exit
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
    watcherMaxPages: env.WATCHER_MAX_PAGES,
    watcherDetailConcurrency: env.WATCHER_DETAIL_CONCURRENCY,
  };

  if (watch) {
    let cycle = 0;
    while (!shouldStop) {
      cycle++;
      console.log(`\n${ts()} --- Watcher cycle ${cycle} ---`);
      const results = await runCycle(sources, runOpts);
      printSummary(results);

      if (shouldStop) break;

      console.log(`${ts()} [runner] Sleeping ${interval}s until next cycle...`);
      await sleep(interval * 1000);
    }

    console.log(`${ts()} [runner] Watcher stopped.`);
  } else {
    const results = await runCycle(sources, runOpts);
    printSummary(results);

    // Exit with code 1 if any scraper failed
    const anyFailed = results.some((r) => !r.success);
    process.exit(anyFailed ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`${ts()} [runner] Fatal error:`, err);
  process.exit(1);
});
