#!/usr/bin/env tsx
/**
 * Scraper Performance Benchmark
 *
 * Runs each scraper source independently for a configurable duration,
 * captures detailed per-source metrics, and writes results to JSON.
 *
 * Does NOT write to the real database — collects results in memory only.
 *
 * Usage:
 *   npx tsx apps/scraper/src/benchmark.ts                     # 60s per source
 *   npx tsx apps/scraper/src/benchmark.ts --duration 120      # 120s per source
 *   npx tsx apps/scraper/src/benchmark.ts --source sreality    # single source
 *   npx tsx apps/scraper/src/benchmark.ts --output optimized   # write to optimized.json
 */

import { getEnv } from "@flat-finder/config";
import type { ScraperResult } from "@flat-finder/types";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

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

interface BenchmarkMetrics {
  source: SourceName;
  durationSeconds: number;
  configuredRps: number;
  configuredConcurrency: number;

  // Phase 1 metrics
  phase1: {
    totalListingsFound: number;
    pagesFetched: number;
    timeMs: number;
    listingsPerMinute: number;
  };

  // Phase 2 metrics
  phase2: {
    newListingsToEnrich: number;
    detailCallsMade: number;
    timeMs: number;
    enrichmentsPerMinute: number;
  };

  // HTTP metrics
  http: {
    totalRequests: number;
    totalResponseTime: number;
    avgLatencyMs: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    p95LatencyMs: number;
    status429Count: number;
    status5xxCount: number;
    retryCount: number;
    errorCount: number;
    timeoutCount: number;
  };

  // Computed
  effectiveRps: number;
  totalTimeMs: number;
  success: boolean;
  fatalError?: string;
  stoppedByTimeout: boolean;
}

interface BenchmarkResult {
  timestamp: string;
  durationPerSourceSeconds: number;
  nodeVersion: string;
  results: BenchmarkMetrics[];
}

// ---------------------------------------------------------------------------
// HTTP instrumentation via monkey-patching
// ---------------------------------------------------------------------------

interface RequestRecord {
  startMs: number;
  endMs: number;
  durationMs: number;
  status: number;
  url: string;
  isRetry: boolean;
}

class HttpMetricsCollector {
  requests: RequestRecord[] = [];
  retryCount = 0;
  errorCount = 0;
  status429Count = 0;
  status5xxCount = 0;
  timeoutCount = 0;

  recordRequest(record: RequestRecord): void {
    this.requests.push(record);
    if (record.status === 429) this.status429Count++;
    if (record.status >= 500) this.status5xxCount++;
    if (record.isRetry) this.retryCount++;
  }

  recordError(isTimeout: boolean): void {
    this.errorCount++;
    if (isTimeout) this.timeoutCount++;
  }

  getSummary(): BenchmarkMetrics["http"] {
    const latencies = this.requests.map((r) => r.durationMs).sort((a, b) => a - b);
    const totalResponseTime = latencies.reduce((s, l) => s + l, 0);
    const p95Index = Math.max(0, Math.floor(latencies.length * 0.95) - 1);

    return {
      totalRequests: this.requests.length,
      totalResponseTime,
      avgLatencyMs: latencies.length > 0 ? Math.round(totalResponseTime / latencies.length) : 0,
      minLatencyMs: latencies.length > 0 ? Math.round(latencies[0]) : 0,
      maxLatencyMs: latencies.length > 0 ? Math.round(latencies[latencies.length - 1]) : 0,
      p95LatencyMs: latencies.length > 0 ? Math.round(latencies[p95Index]) : 0,
      status429Count: this.status429Count,
      status5xxCount: this.status5xxCount,
      retryCount: this.retryCount,
      errorCount: this.errorCount,
      timeoutCount: this.timeoutCount,
    };
  }
}

/**
 * Monkey-patch the global fetch to intercept and measure all HTTP calls
 * made by a specific scraper during its benchmark run.
 */
function instrumentFetch(collector: HttpMetricsCollector): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function instrumentedFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const startMs = performance.now();
    let status = 0;

    try {
      const response = await originalFetch(input, init);
      status = response.status;
      const endMs = performance.now();
      collector.recordRequest({
        startMs,
        endMs,
        durationMs: endMs - startMs,
        status,
        url,
        isRetry: false,
      });
      return response;
    } catch (err) {
      const endMs = performance.now();
      const isTimeout =
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError");
      collector.recordError(isTimeout);
      collector.recordRequest({
        startMs,
        endMs,
        durationMs: endMs - startMs,
        status: isTimeout ? 0 : -1,
        url,
        isRetry: false,
      });
      throw err;
    }
  };

  // Return cleanup function
  return () => {
    globalThis.fetch = originalFetch;
  };
}

// ---------------------------------------------------------------------------
// Scraper factory (same as index.ts)
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
      });
    case "realingo":
      return new ReaLingoScraper({
        ...common,
        rps: env.REALINGO_RPS,
        concurrency: env.REALINGO_CONCURRENCY,
      });
  }
}

function getConfiguredRps(source: SourceName): number {
  const env = getEnv();
  const map: Record<SourceName, number> = {
    sreality: env.SREALITY_RPS,
    bezrealitky: env.BEZREALITKY_RPS,
    ulovdomov: env.ULOVDOMOV_RPS,
    bazos: env.BAZOS_RPS,
    ereality: env.EREALITY_RPS,
    eurobydleni: env.EUROBYDLENI_RPS,
    ceskereality: env.CESKEREALITY_RPS,
    realitymix: env.REALITYMIX_RPS,
    idnes: env.IDNES_RPS,
    realingo: env.REALINGO_RPS,
  };
  return map[source];
}

function getConfiguredConcurrency(source: SourceName): number {
  const env = getEnv();
  const map: Record<SourceName, number> = {
    sreality: env.SREALITY_CONCURRENCY,
    bezrealitky: env.BEZREALITKY_CONCURRENCY,
    ulovdomov: env.ULOVDOMOV_CONCURRENCY,
    bazos: env.BAZOS_CONCURRENCY,
    ereality: env.EREALITY_CONCURRENCY,
    eurobydleni: env.EUROBYDLENI_CONCURRENCY,
    ceskereality: env.CESKEREALITY_CONCURRENCY,
    realitymix: env.REALITYMIX_CONCURRENCY,
    idnes: env.IDNES_CONCURRENCY,
    realingo: env.REALINGO_CONCURRENCY,
  };
  return map[source];
}

// ---------------------------------------------------------------------------
// Benchmark a single source
// ---------------------------------------------------------------------------

async function benchmarkSource(
  source: SourceName,
  durationSeconds: number,
): Promise<BenchmarkMetrics> {
  const ts = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
  const log = (msg: string) => console.log(`${ts()} [benchmark:${source}] ${msg}`);

  log(`Starting ${durationSeconds}s benchmark...`);

  const configuredRps = getConfiguredRps(source);
  const configuredConcurrency = getConfiguredConcurrency(source);
  log(`Config: RPS=${configuredRps}, Concurrency=${configuredConcurrency}`);

  const collector = new HttpMetricsCollector();
  const restoreFetch = instrumentFetch(collector);

  const deadlineMs = performance.now() + durationSeconds * 1000;
  let stoppedByTimeout = false;

  // Phase 1: List scan
  let phase1Listings = 0;
  let phase1Pages = 0;
  const phase1Start = performance.now();
  const allListings: ScraperResult[] = [];

  // Phase 2 tracking
  let phase2Enrichments = 0;
  let phase2TimeMs = 0;
  let newListingsCount = 0;

  try {
    const scraper = createScraper(source);

    // --- Phase 1: Fetch pages until time runs out ---
    for await (const page of scraper.fetchPages()) {
      phase1Pages++;
      phase1Listings += page.listings.length;
      allListings.push(...page.listings);

      if (phase1Pages % 5 === 0) {
        log(`  Phase 1: ${phase1Pages} pages, ${phase1Listings} listings so far...`);
      }

      // Check time budget — leave 40% for phase 2
      if (performance.now() > deadlineMs * 0.6 + phase1Start * 0.4) {
        log(`  Phase 1 time budget reached after ${phase1Pages} pages, moving to Phase 2...`);
        stoppedByTimeout = true;
        break;
      }
    }

    const phase1End = performance.now();
    const phase1TimeMs = phase1End - phase1Start;

    log(`Phase 1 complete: ${phase1Pages} pages, ${phase1Listings} listings in ${(phase1TimeMs / 1000).toFixed(1)}s`);

    // --- Phase 2: Enrich a sample of listings ---
    // Since DB is empty in benchmark, all listings are "new"
    // Limit enrichment to what we can do in remaining time
    const remainingMs = Math.max(0, deadlineMs - performance.now());
    const phase2Start = performance.now();

    if (scraper.hasDetailPhase && allListings.length > 0 && remainingMs > 5000) {
      // Take a representative sample — up to 100 listings or what time allows
      const sampleSize = Math.min(allListings.length, 100);
      const sample = allListings.slice(0, sampleSize);
      newListingsCount = sample.length;

      log(`Phase 2: Enriching ${sample.length} listings (${(remainingMs / 1000).toFixed(1)}s remaining)...`);

      // Create a timeout race
      const enrichPromise = scraper.enrichListings(sample);
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), remainingMs - 2000),
      );

      const result = await Promise.race([
        enrichPromise.then(() => "done" as const),
        timeoutPromise,
      ]);

      phase2Enrichments = sample.length;
      if (result === "timeout") {
        log(`  Phase 2 timed out`);
        stoppedByTimeout = true;
      }
    } else if (!scraper.hasDetailPhase) {
      log(`Phase 2: Skipped (no detail phase for ${source})`);
    } else {
      log(`Phase 2: Skipped (no time remaining or no listings)`);
    }

    phase2TimeMs = performance.now() - phase2Start;
    const totalTimeMs = performance.now() - phase1Start;

    log(`Phase 2 complete: ${phase2Enrichments} enrichments in ${(phase2TimeMs / 1000).toFixed(1)}s`);

    // Compute metrics
    const httpSummary = collector.getSummary();
    const totalElapsedS = totalTimeMs / 1000;

    const metrics: BenchmarkMetrics = {
      source,
      durationSeconds,
      configuredRps,
      configuredConcurrency,
      phase1: {
        totalListingsFound: phase1Listings,
        pagesFetched: phase1Pages,
        timeMs: Math.round(phase1TimeMs),
        listingsPerMinute: phase1TimeMs > 0
          ? Math.round((phase1Listings / phase1TimeMs) * 60000)
          : 0,
      },
      phase2: {
        newListingsToEnrich: newListingsCount,
        detailCallsMade: phase2Enrichments,
        timeMs: Math.round(phase2TimeMs),
        enrichmentsPerMinute: phase2TimeMs > 0
          ? Math.round((phase2Enrichments / phase2TimeMs) * 60000)
          : 0,
      },
      http: httpSummary,
      effectiveRps: totalElapsedS > 0
        ? Math.round((httpSummary.totalRequests / totalElapsedS) * 100) / 100
        : 0,
      totalTimeMs: Math.round(totalTimeMs),
      success: true,
      stoppedByTimeout,
    };

    log(
      `Done. Listings: ${phase1Listings}, Requests: ${httpSummary.totalRequests}, ` +
      `Effective RPS: ${metrics.effectiveRps}, Avg latency: ${httpSummary.avgLatencyMs}ms, ` +
      `429s: ${httpSummary.status429Count}, Errors: ${httpSummary.errorCount}`,
    );

    return metrics;
  } catch (err) {
    const totalTimeMs = performance.now() - phase1Start;
    const httpSummary = collector.getSummary();
    const errorMsg = err instanceof Error ? err.message : String(err);

    log(`Fatal error: ${errorMsg}`);

    return {
      source,
      durationSeconds,
      configuredRps,
      configuredConcurrency,
      phase1: {
        totalListingsFound: phase1Listings,
        pagesFetched: phase1Pages,
        timeMs: Math.round(performance.now() - phase1Start),
        listingsPerMinute: 0,
      },
      phase2: {
        newListingsToEnrich: newListingsCount,
        detailCallsMade: phase2Enrichments,
        timeMs: Math.round(phase2TimeMs),
        enrichmentsPerMinute: 0,
      },
      http: httpSummary,
      effectiveRps: 0,
      totalTimeMs: Math.round(totalTimeMs),
      success: false,
      fatalError: errorMsg,
      stoppedByTimeout: false,
    };
  } finally {
    restoreFetch();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOpts {
  sources: SourceName[];
  durationSeconds: number;
  outputName: string;
}

function parseBenchmarkArgs(): CliOpts {
  const args = process.argv.slice(2);
  const opts: CliOpts = {
    sources: ALL_SOURCES,
    durationSeconds: 60,
    outputName: "baseline",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--source" && i + 1 < args.length) {
      const val = args[++i] as SourceName;
      if (!ALL_SOURCES.includes(val)) {
        console.error(`Invalid source: ${val}. Must be one of: ${ALL_SOURCES.join(", ")}`);
        process.exit(2);
      }
      opts.sources = [val];
    } else if (arg === "--duration" && i + 1 < args.length) {
      opts.durationSeconds = parseInt(args[++i], 10);
      if (isNaN(opts.durationSeconds) || opts.durationSeconds < 10) {
        console.error("Duration must be at least 10 seconds.");
        process.exit(2);
      }
    } else if (arg === "--output" && i + 1 < args.length) {
      opts.outputName = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Scraper Performance Benchmark

Usage:
  npx tsx apps/scraper/src/benchmark.ts [options]

Options:
  --source <name>       Single source to benchmark (default: all)
  --duration <seconds>  Duration per source (default: 60)
  --output <name>       Output file name without .json (default: baseline)
  --help                Show this help
`);
      process.exit(0);
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Summary printer
// ---------------------------------------------------------------------------

function printSummary(results: BenchmarkMetrics[]): void {
  console.log("\n" + "=".repeat(120));
  console.log("BENCHMARK RESULTS SUMMARY");
  console.log("=".repeat(120));

  // Header
  console.log(
    "Source".padEnd(14) +
    "Listings".padStart(9) +
    "L/min".padStart(8) +
    "Pages".padStart(7) +
    "Detail".padStart(8) +
    "Reqs".padStart(7) +
    "EffRPS".padStart(8) +
    "CfgRPS".padStart(8) +
    "AvgLat".padStart(8) +
    "P95Lat".padStart(8) +
    "429s".padStart(6) +
    "Errors".padStart(8) +
    "P1 time".padStart(9) +
    "P2 time".padStart(9) +
    "Status".padStart(8),
  );
  console.log("-".repeat(120));

  // Sort by listings per minute descending
  const sorted = [...results].sort(
    (a, b) => b.phase1.listingsPerMinute - a.phase1.listingsPerMinute,
  );

  for (const r of sorted) {
    const status = r.success ? (r.stoppedByTimeout ? "TIMEOUT" : "OK") : "FAILED";
    console.log(
      r.source.padEnd(14) +
      String(r.phase1.totalListingsFound).padStart(9) +
      String(r.phase1.listingsPerMinute).padStart(8) +
      String(r.phase1.pagesFetched).padStart(7) +
      String(r.phase2.detailCallsMade).padStart(8) +
      String(r.http.totalRequests).padStart(7) +
      String(r.effectiveRps).padStart(8) +
      String(r.configuredRps).padStart(8) +
      (r.http.avgLatencyMs + "ms").padStart(8) +
      (r.http.p95LatencyMs + "ms").padStart(8) +
      String(r.http.status429Count).padStart(6) +
      String(r.http.errorCount).padStart(8) +
      ((r.phase1.timeMs / 1000).toFixed(1) + "s").padStart(9) +
      ((r.phase2.timeMs / 1000).toFixed(1) + "s").padStart(9) +
      status.padStart(8),
    );
  }

  console.log("=".repeat(120));

  // Quick analysis
  console.log("\nQUICK ANALYSIS:");
  const withHeadroom = sorted.filter((r) => r.effectiveRps < r.configuredRps * 0.7 && r.success);
  if (withHeadroom.length > 0) {
    console.log("\n  Sources with RPS headroom (actual << configured):");
    for (const r of withHeadroom) {
      const utilization = r.configuredRps > 0
        ? Math.round((r.effectiveRps / r.configuredRps) * 100)
        : 0;
      console.log(`    ${r.source}: ${r.effectiveRps} / ${r.configuredRps} RPS (${utilization}% utilization)`);
    }
  }

  const with429s = sorted.filter((r) => r.http.status429Count > 0);
  if (with429s.length > 0) {
    console.log("\n  Sources hitting rate limits (429 responses):");
    for (const r of with429s) {
      console.log(`    ${r.source}: ${r.http.status429Count} x 429 responses`);
    }
  }

  const slowPhase2 = sorted.filter(
    (r) => r.phase2.timeMs > r.phase1.timeMs && r.phase2.detailCallsMade > 0,
  );
  if (slowPhase2.length > 0) {
    console.log("\n  Sources where Phase 2 (detail) is slower than Phase 1 (list):");
    for (const r of slowPhase2) {
      const ratio = r.phase1.timeMs > 0
        ? (r.phase2.timeMs / r.phase1.timeMs).toFixed(1)
        : "N/A";
      console.log(`    ${r.source}: P1=${(r.phase1.timeMs / 1000).toFixed(1)}s, P2=${(r.phase2.timeMs / 1000).toFixed(1)}s (${ratio}x slower)`);
    }
  }

  const highLatency = sorted.filter((r) => r.http.avgLatencyMs > 500 && r.success);
  if (highLatency.length > 0) {
    console.log("\n  Sources with high average latency (>500ms):");
    for (const r of highLatency) {
      console.log(`    ${r.source}: avg=${r.http.avgLatencyMs}ms, p95=${r.http.p95LatencyMs}ms`);
    }
  }
}

// ---------------------------------------------------------------------------
// Comparison printer (for post-optimization)
// ---------------------------------------------------------------------------

export function printComparison(
  baseline: BenchmarkMetrics[],
  optimized: BenchmarkMetrics[],
): void {
  console.log("\n" + "=".repeat(130));
  console.log("BEFORE vs AFTER OPTIMIZATION COMPARISON");
  console.log("=".repeat(130));

  console.log(
    "Source".padEnd(14) +
    "  Listings/min     " +
    "  Avg Latency      " +
    "  Error Rate       " +
    "  Eff RPS          " +
    "  P1 time          " +
    "  P2 time",
  );
  console.log("-".repeat(130));

  for (const opt of optimized) {
    const base = baseline.find((b) => b.source === opt.source);
    if (!base) continue;

    const lpmBefore = base.phase1.listingsPerMinute;
    const lpmAfter = opt.phase1.listingsPerMinute;
    const lpmChange = lpmBefore > 0 ? Math.round(((lpmAfter - lpmBefore) / lpmBefore) * 100) : 0;

    const latBefore = base.http.avgLatencyMs;
    const latAfter = opt.http.avgLatencyMs;
    const latChange = latBefore > 0 ? Math.round(((latAfter - latBefore) / latBefore) * 100) : 0;

    const errBefore = base.http.errorCount;
    const errAfter = opt.http.errorCount;

    const rpsBefore = base.effectiveRps;
    const rpsAfter = opt.effectiveRps;
    const rpsChange = rpsBefore > 0 ? Math.round(((rpsAfter - rpsBefore) / rpsBefore) * 100) : 0;

    const p1Before = (base.phase1.timeMs / 1000).toFixed(1);
    const p1After = (opt.phase1.timeMs / 1000).toFixed(1);

    const p2Before = (base.phase2.timeMs / 1000).toFixed(1);
    const p2After = (opt.phase2.timeMs / 1000).toFixed(1);

    const changeStr = (pct: number) => (pct >= 0 ? `+${pct}%` : `${pct}%`);

    console.log(
      opt.source.padEnd(14) +
      `${lpmBefore} -> ${lpmAfter} (${changeStr(lpmChange)})`.padEnd(20) +
      `${latBefore}ms -> ${latAfter}ms (${changeStr(latChange)})`.padEnd(20) +
      `${errBefore} -> ${errAfter}`.padEnd(20) +
      `${rpsBefore} -> ${rpsAfter} (${changeStr(rpsChange)})`.padEnd(20) +
      `${p1Before}s -> ${p1After}s`.padEnd(20) +
      `${p2Before}s -> ${p2After}s`,
    );
  }

  console.log("=".repeat(130));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseBenchmarkArgs();

  console.log("=".repeat(80));
  console.log("Flat Finder CZ - Scraper Performance Benchmark");
  console.log(`Sources:  ${opts.sources.join(", ")}`);
  console.log(`Duration: ${opts.durationSeconds}s per source`);
  console.log(`Output:   ${opts.outputName}.json`);
  console.log(`Total estimated time: ${opts.sources.length * opts.durationSeconds}s (${(opts.sources.length * opts.durationSeconds / 60).toFixed(1)} min)`);
  console.log("=".repeat(80));

  const results: BenchmarkMetrics[] = [];

  for (let i = 0; i < opts.sources.length; i++) {
    const source = opts.sources[i];
    console.log(`\n${"#".repeat(60)}`);
    console.log(`# [${i + 1}/${opts.sources.length}] Benchmarking: ${source}`);
    console.log(`${"#".repeat(60)}\n`);

    const metrics = await benchmarkSource(source, opts.durationSeconds);
    results.push(metrics);

    // Brief pause between sources to let connections close
    if (i < opts.sources.length - 1) {
      console.log(`\nPausing 3s before next source...\n`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Print summary
  printSummary(results);

  // Write results to JSON
  const outputDir = resolve(
    import.meta.dirname,
    "../benchmark-results",
  );
  mkdirSync(outputDir, { recursive: true });

  const outputPath = resolve(outputDir, `${opts.outputName}.json`);
  const benchmarkResult: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    durationPerSourceSeconds: opts.durationSeconds,
    nodeVersion: process.version,
    results,
  };

  writeFileSync(outputPath, JSON.stringify(benchmarkResult, null, 2));
  console.log(`\nResults written to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Benchmark fatal error:", err);
  process.exit(1);
});
