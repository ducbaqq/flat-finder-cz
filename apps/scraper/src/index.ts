#!/usr/bin/env tsx
/**
 * Flat Finder CZ - Scraper CLI
 *
 * Runs one or all scrapers, upserts listings into the database,
 * deactivates stale listings, and tracks each run via scraper_runs.
 *
 * Usage:
 *   tsx src/index.ts                          # run all scrapers
 *   tsx src/index.ts --source sreality         # run only Sreality
 *   tsx src/index.ts --source all --dry-run    # collect but don't save
 */

import { getEnv } from "@flat-finder/config";
import {
  getDb,
  closeDb,
  upsertListing,
  createScraperRun,
  finishScraperRun,
  type Db,
  type NewListing,
} from "@flat-finder/db";
import type { ScraperResult } from "@flat-finder/types";

import type { BaseScraper } from "./base-scraper.js";
import { SrealityScraper } from "./scrapers/sreality.js";
import { BezrealitkyScraper } from "./scrapers/bezrealitky.js";
import { UlovDomovScraper } from "./scrapers/ulovdomov.js";
import { deactivateStale } from "./deactivator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SourceName = "sreality" | "bezrealitky" | "ulovdomov";

const ALL_SOURCES: SourceName[] = ["sreality", "bezrealitky", "ulovdomov"];

interface CliArgs {
  source: SourceName | "all";
  dryRun: boolean;
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

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const opts: CliArgs = {
    source: "all",
    dryRun: false,
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
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Flat Finder CZ - Scraper

Usage:
  tsx src/index.ts [options]

Options:
  --source <name>   Which source to scrape: sreality | bezrealitky | ulovdomov | all (default: all)
  --dry-run         Collect listings but do not save to database
  --help, -h        Show this help message
`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: "${arg}". Use --help for usage.`);
      process.exit(2);
    }
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
// Run a single scraper source
// ---------------------------------------------------------------------------

async function runSource(
  source: SourceName,
  db: Db | null,
  dryRun: boolean,
): Promise<SourceResult> {
  const t0 = performance.now();
  const log = (msg: string) => console.log(`[${source}]`, msg);

  log("Starting...");

  // Create a scraper run record (skip for dry-run)
  let runId: number | null = null;
  if (!dryRun && db) {
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
    // 1. Fetch all listings from this source
    const scraper = createScraper(source);
    log("Fetching listings...");
    const listings = await scraper.fetchListings();
    log(`Fetched ${listings.length} listings`);

    // 2. In dry-run mode, just report what we found and return
    if (dryRun || !db) {
      log(`[DRY RUN] Would upsert ${listings.length} listings -- skipping DB writes`);
      const elapsedMs = Math.round(performance.now() - t0);
      log(`Done in ${(elapsedMs / 1000).toFixed(1)}s (dry run)`);
      return {
        source,
        newCount: listings.length,
        updatedCount: 0,
        errorCount: 0,
        deactivatedCount: 0,
        elapsedMs,
        success: true,
      };
    }

    // 3. Upsert each listing into the database
    const seenIds = new Set<string>();

    for (const result of listings) {
      try {
        const newListing = toNewListing(result);
        const { isNew } = await upsertListing(db, newListing);
        seenIds.add(result.external_id);
        if (isNew) {
          newCount++;
        } else {
          updatedCount++;
        }
      } catch (err) {
        errorCount++;
        if (errorCount <= 5) {
          log(`Error upserting ${result.external_id}: ${err}`);
        } else if (errorCount === 6) {
          log("(suppressing further upsert error logs)");
        }
      }
    }

    log(`Upserted: new=${newCount} updated=${updatedCount} errors=${errorCount}`);

    // 4. Deactivate stale listings
    try {
      deactivatedCount = await deactivateStale(db, source, seenIds);
      if (deactivatedCount > 0) {
        log(`Deactivated ${deactivatedCount} stale listings`);
      }
    } catch (err) {
      log(`Error during deactivation: ${err}`);
      errorCount++;
    }

    // 5. Finish the scraper run record
    const elapsedMs = Math.round(performance.now() - t0);

    if (runId != null) {
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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { source, dryRun } = parseArgs();

  const sources: SourceName[] =
    source === "all" ? ALL_SOURCES : [source];

  console.log("=".repeat(60));
  console.log("Flat Finder CZ - Scraper");
  console.log(`Sources:  ${sources.join(", ")}`);
  if (dryRun) console.log("Mode:     DRY RUN (no DB writes)");
  console.log("=".repeat(60));

  // Only connect to DB when not in dry-run mode
  const db = dryRun ? null : getDb();
  const results: SourceResult[] = [];

  // Run scrapers sequentially -- one failing should not stop others
  for (const src of sources) {
    try {
      const result = await runSource(src, db, dryRun);
      results.push(result);
    } catch (err) {
      // Should not normally reach here since runSource catches errors,
      // but guard against unexpected failures
      console.error(`[runner] Unexpected error for ${src}:`, err);
      results.push({
        source: src,
        newCount: 0,
        updatedCount: 0,
        errorCount: 1,
        deactivatedCount: 0,
        elapsedMs: 0,
        success: false,
        fatalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Print summary
  console.log("");
  console.log("=".repeat(60));
  console.log("Summary:");
  for (const r of results) {
    const status = r.success ? "OK" : "FAILED";
    console.log(
      `  ${r.source.padEnd(15)} [${status.padEnd(6)}] ` +
        `new=${String(r.newCount).padEnd(6)} ` +
        `updated=${String(r.updatedCount).padEnd(6)} ` +
        `errors=${String(r.errorCount).padEnd(4)} ` +
        `deactivated=${String(r.deactivatedCount).padEnd(4)} ` +
        `time=${(r.elapsedMs / 1000).toFixed(1)}s`,
    );
  }
  console.log("=".repeat(60));

  // Close database connection
  if (!dryRun) {
    await closeDb();
  }

  // Exit with code 1 if any scraper failed
  const anyFailed = results.some((r) => !r.success);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error("[runner] Fatal error:", err);
  process.exit(1);
});
