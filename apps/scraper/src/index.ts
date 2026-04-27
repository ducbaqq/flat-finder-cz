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

import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import path from "node:path";

import { getEnv } from "@flat-finder/config";
import {
  createDb,
  findEnrichmentDoneIds,
  findExistingExternalIds,
  findRecentlyEnrichedIds,
  createScraperRun,
  finishScraperRun,
  type Db,
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
import { deactivateStale, deactivateByTtl, clusterDuplicates, clusterNewDuplicates } from "./deactivator.js";
import { runFreshnessSweep, runImageRefreshSweep } from "./refresh.js";
import { toNewListing, wasEnriched, stampEnrichedAt, upsertBatch } from "./upsert.js";
import { Dashboard } from "./dashboard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

// ---------------------------------------------------------------------------
// Optional log file (`--log [path]`)
// ---------------------------------------------------------------------------
//
// When the `--log` flag is set, a write stream is opened in main() and
// stored here. The dashboard, the console-suppression hook, and the
// non-dashboard per-source logger all check this and tee plain
// (ANSI-stripped) lines to it. Default path: `logs/scrape-<ts>.log`.

let logFileStream: WriteStream | null = null;
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export function writeLogFile(line: string): void {
  if (!logFileStream) return;
  // Strip ANSI color codes that might come from the dashboard's buffered
  // log lines. The on-screen rendering keeps them; the file should be
  // grep-friendly plain text.
  logFileStream.write(line.replace(ANSI_PATTERN, "") + "\n");
}

/**
 * Walk the Error.cause chain and return a single string with each layer's
 * message + key pg fields. Drizzle wraps pg errors so the top-level .message
 * is just "Failed query: ..." — the real reason lives in err.cause.
 */
function formatErrorChain(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  let depth = 0;
  while (cur && depth < 5) {
    if (cur instanceof Error) {
      const extras: string[] = [];
      const anyErr = cur as Error & {
        code?: string;
        severity?: string;
        detail?: string;
        hint?: string;
      };
      if (anyErr.code) extras.push(`code=${anyErr.code}`);
      if (anyErr.severity) extras.push(`severity=${anyErr.severity}`);
      if (anyErr.detail) extras.push(`detail=${anyErr.detail}`);
      const suffix = extras.length ? ` [${extras.join(" ")}]` : "";
      parts.push(`${cur.name}: ${cur.message}${suffix}`);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
    depth++;
  }
  return parts.join("\n  caused by: ");
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
  /** Resolved log-file path (set when --log is given), or null. */
  logFile: string | null;
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
    logFile: null,
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
    } else if (arg === "--log") {
      // Optional path argument: --log [path]. If the next token starts
      // with '--' or doesn't exist, fall back to logs/scrape-<ts>.log.
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        opts.logFile = next;
        i++;
      } else {
        const stamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, 19);
        opts.logFile = path.join("logs", `scrape-${stamp}.log`);
      }
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
  --dedupe            Cluster cross-source duplicates (geo + size + price + transaction_type matching)
  --no-dashboard      Disable the live terminal dashboard (auto-disabled for non-TTY)
  --log [path]        Tee all log output to a file (plain text, ANSI stripped).
                      Path is optional — defaults to logs/scrape-<timestamp>.log.
                      Works with the dashboard: terminal stays interactive,
                      file gets the same lines minus the ANSI redraws.
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
// Upsert pipeline: toNewListing / wasEnriched / stampEnrichedAt / upsertBatch
// live in ./upsert.ts so apps/scraper/src/refresh.ts can reuse them for the
// Phase 2 image-refresh sweep without importing from this CLI entrypoint.
// ---------------------------------------------------------------------------

// Abandon enrichment retries for listings whose detail page has been
// returning nothing enrichable for this many days. See upsert.ts:wasEnriched
// and findEnrichmentDoneIds for the full contract.
const ENRICHMENT_GIVE_UP_DAYS = 3;

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

  // Log function: route to dashboard if active, otherwise console.log.
  // Either way, also tee to the log file when `--log` is set so the file
  // captures every per-source line in plain text.
  const log = dashboard
    ? (msg: string) => {
        dashboard.log(source, msg);
        writeLogFile(`${ts()} [${source}] ${msg}`);
      }
    : (msg: string) => {
        const line = `${ts()} [${source}] ${msg}`;
        console.log(line);
        writeLogFile(line);
      };

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

        // A listing is "done" when:
        //   - Scraper has a detail phase: enriched_at has ever been set,
        //     OR enriched_at is null AND created_at is older than
        //     ENRICHMENT_GIVE_UP_DAYS (failed enrichment cap).
        //   - Scraper has NO detail phase (e.g. bezrealitky — all data
        //     comes from the list page, enrichListings is a no-op):
        //     "known" = done. Because enriched_at is never set for these
        //     sources, the enriched_at-based gate would keep re-processing
        //     every listing on every page every cycle — effectively
        //     running a full scrape each 5 min.
        const externalIds = page.listings.map((l) => l.external_id);
        const doneIds = scraper.hasDetailPhase
          ? await findEnrichmentDoneIds(db, externalIds, {
              giveUpAfterDays: ENRICHMENT_GIVE_UP_DAYS,
            })
          : await findExistingExternalIds(db, externalIds);
        const toProcess = page.listings.filter(
          (l) => !doneIds.has(l.external_id),
        );

        // All done on this page -> we've paged back into fully-processed
        // territory; stop paginating this category.
        if (toProcess.length === 0) {
          log(`  ${page.category} page ${page.page}: all done, skipping rest`);
          skippedCategories.add(page.category);
          scraper.skipCategory(page.category);
          continue;
        }

        log(`  ${page.category} page ${page.page}: ${toProcess.length} to process / ${page.listings.length} total`);

        // Enrich the to-process set (new + retries) inline
        if (scraper.hasDetailPhase && toProcess.length > 0) {
          if (dashboard) dashboard.setStatus(source, "enriching");
          await scraper.enrichListings(toProcess, {
            concurrency: opts.watcherDetailConcurrency,
          });
          stampEnrichedAt(toProcess);
          if (dashboard) dashboard.setStatus(source, "scanning");
        }

        // Upsert to-process. Retries are INSERT … ON CONFLICT DO UPDATE,
        // which also refreshes scraped_at on the existing row.
        const stats = await upsertBatch(db, toProcess, log);
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
          // Apply give-up even when skipHours is 0 — abandoning stale
          // failures should hold regardless of the per-source refresh
          // cadence.
          if ((skipHours && skipHours > 0) || ENRICHMENT_GIVE_UP_DAYS > 0) {
            const externalIds = page.listings.map((l) => l.external_id);
            const toSkip = await findRecentlyEnrichedIds(
              db,
              externalIds,
              skipHours ?? 0,
              ENRICHMENT_GIVE_UP_DAYS,
            );
            if (toSkip.size > 0) {
              toEnrich = page.listings.filter((l) => !toSkip.has(l.external_id));
              if (toEnrich.length < page.listings.length) {
                log(`  Skipping enrichment for ${page.listings.length - toEnrich.length} listings (recently-enriched or given up)`);
              }
            }
          }

          if (toEnrich.length > 0) {
            if (dashboard) dashboard.setStatus(source, "enriching");
            await scraper.enrichListings(toEnrich);
            stampEnrichedAt(toEnrich);
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
          stampEnrichedAt(newListings);
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
    const errorMsg = formatErrorChain(err);
    log(`Fatal error: ${errorMsg}`);
    if (err instanceof Error && err.stack) log(err.stack);
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
    writeLogFile(msg);
  };

  console.warn = (...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    const match = msg.match(/\[(\w+)\]\s*(.*)/);
    if (match) {
      dashboard.log(match[1], msg);
    } else {
      dashboard.log("runner", msg);
    }
    writeLogFile(msg);
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
  const { sources: sourcesArg, dryRun, watch, full, cleanup, dedupe, interval, noDashboard, logFile } = parseArgs();
  const env = getEnv();

  // Open the log file (if --log) before anything else so banners /
  // startup messages also land in it.
  if (logFile) {
    const dir = path.dirname(logFile);
    if (dir && dir !== ".") {
      try { mkdirSync(dir, { recursive: true }); } catch {}
    }
    logFileStream = createWriteStream(logFile, { flags: "a" });
    // Header so multiple runs in the same file are distinguishable.
    logFileStream.write(
      `\n=== ${new Date().toISOString()} pid=${process.pid} argv=${process.argv.slice(2).join(" ")} ===\n`,
    );
    // Pre-dashboard notice (always visible regardless of --no-dashboard
    // or non-TTY): tells the user where the log lives.
    process.stderr.write(`${ts()} [runner] Logging to ${logFile}\n`);
  }

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
  const closeLogStream = () => {
    if (logFileStream) {
      try { logFileStream.end(); } catch {}
      logFileStream = null;
    }
  };
  const onSignal = (signal: string) => {
    // Clean up dashboard terminal state before anything else
    if (dashboard) {
      dashboard.cleanup();
      if (consoleRestore) consoleRestore();
    }

    if (!watch) {
      // Non-watch mode: exit immediately on first signal
      console.log(`\n${ts()} [runner] Received ${signal}, exiting.`);
      closeLogStream();
      process.exit(0);
    }
    if (shouldStop) {
      // Watch mode, second signal -> force exit
      console.log(`\n${ts()} [runner] Received ${signal} again, forcing exit.`);
      closeLogStream();
      process.exit(0);
    }
    console.log(`\n${ts()} [runner] Received ${signal}, stopping after current cycle...`);
    shouldStop = true;
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  // Best-effort flush on natural process exit too.
  process.on("exit", closeLogStream);

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

  // Standalone dedupe mode -- cluster cross-source duplicates (geo + size + price + transaction_type)
  if (dedupe) {
    const label = dryRun ? "dry-run" : "clustering";
    console.log(`${ts()} [runner] Running deduplication ${label} (geo + size + price + transaction_type)...`);
    const conn = createDb();
    try {
      const { clustered, clusters } = await clusterDuplicates(conn.db, { dryRun });
      const verb = dryRun ? "would be" : "were";
      console.log(
        `${ts()} [runner] Deduplication ${dryRun ? "preview" : "complete"}: ${clusters} clusters ${verb} formed, ${clustered} listings ${verb} grouped`,
      );
    } finally {
      await conn.sql.end();
    }
    process.exit(0);
  }

  if (watch) {
    let cycle = 0;
    while (!shouldStop) {
      cycle++;
      const cycleStart = Date.now();
      const cycleDeadlineMs = cycleStart + interval * 1000;

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

      // Incremental dedup — cluster newly scraped rows against existing
      // clusters + each other. A failure here must not kill the watch
      // loop: we log it and continue into the sleep, then retry next
      // cycle. Policy lives here, not in the wrapper, so the wrapper stays
      // contract-consistent with the other deactivator helpers.
      if (!dryRun) {
        const conn = createDb();
        try {
          await clusterNewDuplicates(conn.db);
        } catch (err) {
          console.error(`${ts()} [runner] Incremental dedup failed, continuing:`, err);
        } finally {
          try {
            await conn.sql.end();
          } catch {
            // ignore close errors — matches runCycle pattern
          }
        }
      }

      // Freshness sweep — walk oldest-checked active listings per source
      // within the remaining-cycle window. Hard deadline so the next
      // cycle always starts on schedule. Failures here must not kill the
      // watch loop, matching the dedup policy above.
      if (!dryRun && !shouldStop) {
        const conn = createDb();
        try {
          const sweepScrapers: Record<string, BaseScraper> = {};
          for (const s of sources) sweepScrapers[s] = createScraper(s, true);
          await runFreshnessSweep(conn.db, sweepScrapers, {
            deadlineMs: cycleDeadlineMs,
          });

          // Image-refresh sweep (Phase 2) — HEAD thumbnails for rot and
          // re-enrich rotted / long-stale rows. Runs with the SAME
          // scraper instances (token buckets + init already primed) but
          // skips no-detail-phase sources internally. Same hard deadline
          // so the watch loop keeps its 5-min cadence.
          await runImageRefreshSweep(conn.db, sweepScrapers, {
            deadlineMs: cycleDeadlineMs,
          });
        } catch (err) {
          console.error(`${ts()} [runner] Freshness / image-refresh sweep failed, continuing:`, err);
        } finally {
          try {
            await conn.sql.end();
          } catch {
            // ignore close errors — matches runCycle pattern
          }
        }
      }

      const remaining = cycleDeadlineMs - Date.now();
      if (remaining > 0) {
        console.log(`${ts()} [runner] Sleeping ${Math.round(remaining / 1000)}s until next cycle...`);
        await sleep(remaining);
      } else {
        console.log(`${ts()} [runner] Cycle overran by ${-Math.round(remaining / 1000)}s; starting next cycle immediately.`);
      }

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
