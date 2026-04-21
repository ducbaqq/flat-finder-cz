/**
 * Freshness / liveness sweep engine.
 *
 * Invoked at the end of each watch cycle with a hard deadline. Walks the
 * oldest-checked active listings per source, hits source_url, and asks the
 * per-source classifier (BaseScraper.classifyLiveness) whether the listing
 * is still alive. Dead listings are deactivated with `deactivation_reason`
 * like `liveness_404`; alive ones have their `last_checked_at` stamped so
 * the priority queue advances.
 *
 * Design notes:
 *   - One worker pool per source, each bounded by p-limit (reusing the
 *     scraper's existing concurrency budget).
 *   - Each worker awaits the scraper's token-bucket rate limiter before
 *     firing — so the combined RPS of watch-mode + sweep stays within the
 *     per-source limits defined in packages/config.
 *   - All sources run in parallel via Promise.all. They share one `db`
 *     connection pool; deactivateById / stampCheckedBatch are cheap point
 *     writes so there's no connection pressure.
 *   - Read cap: 1 MB per body, enough for soft-404 banners without
 *     blowing up on pathological pages.
 *   - Deadline is checked both at the "pick next batch" level (don't
 *     query if we're already out of time) and before each fetch (don't
 *     start a new 10s request with 5s left in the window).
 */

import pLimit from "p-limit";
import {
  deactivateById,
  getListingsByIds,
  pickStaleForImageCheck,
  pickStaleForImageReenrich,
  pickStaleForLiveness,
  reactivateIfLivenessDeactivated,
  stampCheckedBatch,
  stampImageCheckedBatch,
  type Db,
  type LivenessCandidate,
  type ListingRow,
} from "@flat-finder/db";
import type {
  BaseScraper,
  LivenessResponse,
  LivenessVerdict,
} from "./base-scraper.js";
import type { ScraperResult } from "@flat-finder/types";
import { stampEnrichedAt, upsertBatch } from "./upsert.js";
import { rowToScraperResult } from "./row-to-scraper-result.js";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 10_000;
const SAFETY_MARGIN_MS = 20_000; // stop this long before deadline
const BODY_READ_CAP_BYTES = 1_000_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_SOURCE_CONCURRENCY = 4;

export interface FreshnessSweepOpts {
  /** Absolute deadline in ms-since-epoch. Sweep exits before this. */
  deadlineMs: number;
  /** Rows picked per source per inner iteration. Default 50. */
  batchSize?: number;
  /** Parallel liveness checks per source. Default 4. */
  perSourceConcurrency?: number;
  /** If true, do not deactivate — just log the verdict. */
  dryRun?: boolean;
  /** Logger (console.log by default). */
  log?: (...args: unknown[]) => void;
}

export interface PerSourceStats {
  alive: number;
  dead: number;
  unknown: number;
  reactivated: number;
  checked: number;
  errors: number;
}

export type FreshnessSweepStats = Record<string, PerSourceStats>;

export async function runFreshnessSweep(
  db: Db,
  scrapers: Record<string, BaseScraper>,
  opts: FreshnessSweepOpts,
): Promise<FreshnessSweepStats> {
  const log = opts.log ?? console.log;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const concurrency = opts.perSourceConcurrency ?? DEFAULT_SOURCE_CONCURRENCY;

  const stats: FreshnessSweepStats = {};
  const sources = Object.keys(scrapers);
  log(
    `[sweep] Starting freshness sweep for ${sources.length} source(s) — ` +
      `deadline in ${Math.max(0, opts.deadlineMs - Date.now()) / 1000}s`,
  );

  await Promise.all(
    sources.map((source) =>
      sweepSource(db, source, scrapers[source], {
        ...opts,
        batchSize,
        concurrency,
        stats,
        log,
      }),
    ),
  );

  const summary = Object.entries(stats)
    .map(
      ([src, s]) =>
        `${src}: ${s.checked} checked ` +
        `(${s.alive} alive, ${s.dead} dead, ${s.unknown} ?, ` +
        `${s.reactivated} reactivated, ${s.errors} err)`,
    )
    .join(" · ");
  log(`[sweep] Done. ${summary || "no activity"}`);

  return stats;
}

interface InnerOpts extends FreshnessSweepOpts {
  batchSize: number;
  concurrency: number;
  stats: FreshnessSweepStats;
  log: (...args: unknown[]) => void;
}

async function sweepSource(
  db: Db,
  source: string,
  scraper: BaseScraper | undefined,
  opts: InnerOpts,
): Promise<void> {
  if (!scraper) return;
  // RateLimiter is created lazily on the scraper via init(); the
  // BaseScraper test in watch mode already triggered this, but the sweep
  // can run standalone (e.g. --cleanup), so force it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (scraper as any).init?.();

  const { deadlineMs, batchSize, concurrency, dryRun, stats, log } = opts;
  const perStat: PerSourceStats = {
    alive: 0,
    dead: 0,
    unknown: 0,
    reactivated: 0,
    checked: 0,
    errors: 0,
  };
  stats[source] = perStat;

  const limiter = pLimit(concurrency);

  while (Date.now() < deadlineMs - SAFETY_MARGIN_MS) {
    const batch = await pickStaleForLiveness(db, source, batchSize);
    if (batch.length === 0) break;

    const alivelyIds: number[] = [];

    await Promise.all(
      batch.map((row) =>
        limiter(async () => {
          if (Date.now() >= deadlineMs - SAFETY_MARGIN_MS) return;
          if (!row.source_url) return;

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rl = (scraper as any).http?.rateLimiter;
            if (rl?.acquire) await rl.acquire();

            const res = await fetchLiveness(row.source_url);
            const verdict = scraper.classifyLiveness(res);
            perStat.checked++;
            await handleVerdict(db, row, verdict, res, {
              perStat,
              alivelyIds,
              dryRun: dryRun ?? false,
              log,
            });
          } catch (err) {
            perStat.errors++;
            log(
              `[sweep] ${source}#${row.id} error:`,
              err instanceof Error ? err.message : err,
            );
          }
        }),
      ),
    );

    // Stamp last_checked_at for listings that came back alive in one
    // batched UPDATE. "Dead" rows were already stamped via deactivateById.
    if (alivelyIds.length > 0 && !dryRun) {
      try {
        await stampCheckedBatch(db, alivelyIds);
      } catch (err) {
        log(
          `[sweep] ${source} stampCheckedBatch failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}

async function handleVerdict(
  db: Db,
  row: LivenessCandidate,
  verdict: LivenessVerdict,
  res: LivenessResponse,
  ctx: {
    perStat: PerSourceStats;
    alivelyIds: number[];
    dryRun: boolean;
    log: (...args: unknown[]) => void;
  },
): Promise<void> {
  const { perStat, alivelyIds, dryRun, log } = ctx;
  if (verdict === "dead") {
    perStat.dead++;
    const reason = `liveness_${res.status || (res.networkError ? "net" : "dead")}`;
    if (!dryRun) {
      await deactivateById(db, row.id, reason);
    }
    log(
      `[sweep] ${row.source}#${row.id} DEAD (${reason}) — ${row.source_url}`,
    );
    return;
  }

  if (verdict === "alive") {
    perStat.alive++;
    alivelyIds.push(row.id);
    // Try to auto-reactivate — no-op unless this row is in the
    // recently-deactivated state; cheap because the filter is selective.
    if (!dryRun) {
      try {
        const flipped = await reactivateIfLivenessDeactivated(db, row.id);
        if (flipped) perStat.reactivated++;
      } catch {
        // ignore — reactivation is best-effort
      }
    }
    return;
  }

  // unknown — stamp anyway so we don't spin on the same row forever.
  perStat.unknown++;
  alivelyIds.push(row.id);
}

async function fetchLiveness(url: string): Promise<LivenessResponse> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    // Read up to BODY_READ_CAP_BYTES of the body. For soft-404 detection
    // we need the text; truncating keeps memory bounded even on
    // pathological pages.
    let body = "";
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("text")) {
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder("utf-8", { fatal: false });
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          body += decoder.decode(value, { stream: true });
          if (total >= BODY_READ_CAP_BYTES) {
            await reader.cancel();
            break;
          }
        }
      }
    } else {
      // Drain body to free the socket without parsing.
      try {
        await res.arrayBuffer();
      } catch {
        // ignore
      }
    }

    return {
      status: res.status,
      location: res.headers.get("location") ?? "",
      url: res.url || url,
      body: body.toLowerCase(),
      networkError: false,
    };
  } catch {
    return {
      status: 0,
      location: "",
      url,
      body: "",
      networkError: true,
    };
  } finally {
    clearTimeout(t);
  }
}

// ============================================================================
// Phase 2 — Image-rot detection + re-enrichment
// ============================================================================
//
// Runs after runFreshnessSweep in the watch loop. Goal: keep thumbnail_url
// and image_urls fresh without waiting for a listing to disappear off the
// portal. Two interleaved passes per source:
//
//   A) Prophylactic re-enrich: up to N rows where enriched_at is older
//      than IMAGE_REFRESH_STALE_DAYS. No HEAD check — just re-fetch the
//      detail page, which refreshes every enrichable field, including
//      images. Catches rot we haven't detected yet and keeps specs/price
//      current on long-lived listings.
//
//   B) HEAD-driven detection: up to N rows ordered by last_image_checked_at
//      NULLS FIRST. HEAD the thumbnail_url; on 404/410 push the row into
//      a re-enrich batch. Stamp last_image_checked_at on every row we
//      HEAD'd (pass or fail) so the priority queue advances.
//
// Sources without a detail phase (bezrealitky — hasDetailPhase = false)
// are skipped entirely: enrichListings is a no-op so re-enrichment can't
// fix anything for them, and their image URLs have so far stayed stable.

const IMAGE_HEAD_TIMEOUT_MS = 8_000;
const IMAGE_REENRICH_DEADLINE_MARGIN_MS = 15_000;
const IMAGE_REFRESH_STALE_DAYS_DEFAULT = 7;
const IMAGE_HEAD_BATCH_SIZE_DEFAULT = 50;
const IMAGE_REENRICH_BATCH_SIZE_DEFAULT = 10;
const IMAGE_HEAD_CONCURRENCY_DEFAULT = 4;

export interface ImageRefreshSweepOpts {
  /** Absolute deadline in ms-since-epoch. Sweep exits before this. */
  deadlineMs: number;
  /** Prophylactic re-enrich threshold. Default 7 days. */
  staleDays?: number;
  /** Max HEAD checks per source per inner iteration. Default 50. */
  headBatchSize?: number;
  /** Max prophylactic re-enrichments per source per inner iteration. Default 10. */
  reenrichBatchSize?: number;
  /** Parallel HEADs per source. Default 4. */
  headConcurrency?: number;
  /** Skip DB writes — log only. */
  dryRun?: boolean;
  log?: (...args: unknown[]) => void;
}

export interface ImageRefreshStats {
  checked: number;       // HEAD requests fired
  rotted: number;        // HEAD came back 404/410
  reenrichedRot: number; // successful re-enrich of a rotted row
  reenrichedStale: number; // successful prophylactic re-enrich
  errors: number;
}

export type ImageRefreshSweepStats = Record<string, ImageRefreshStats>;

export async function runImageRefreshSweep(
  db: Db,
  scrapers: Record<string, BaseScraper>,
  opts: ImageRefreshSweepOpts,
): Promise<ImageRefreshSweepStats> {
  const log = opts.log ?? console.log;
  const stats: ImageRefreshSweepStats = {};

  // Only sources with a detail phase — enrichListings is a no-op otherwise.
  const sources = Object.keys(scrapers).filter(
    (s) => scrapers[s]?.hasDetailPhase,
  );
  const skipped = Object.keys(scrapers).filter(
    (s) => !scrapers[s]?.hasDetailPhase,
  );

  log(
    `[image-refresh] Starting for ${sources.length} source(s)` +
      (skipped.length > 0 ? ` (skipped no-detail-phase: ${skipped.join(",")})` : "") +
      ` — deadline in ${Math.max(0, opts.deadlineMs - Date.now()) / 1000}s`,
  );

  await Promise.all(
    sources.map((source) =>
      sweepImagesForSource(db, source, scrapers[source], { ...opts, stats, log }),
    ),
  );

  const summary = Object.entries(stats)
    .map(
      ([src, s]) =>
        `${src}: ${s.checked} HEAD ` +
        `(${s.rotted} rotted, ${s.reenrichedRot} refreshed, ` +
        `${s.reenrichedStale} stale-refreshed, ${s.errors} err)`,
    )
    .join(" · ");
  log(`[image-refresh] Done. ${summary || "no activity"}`);

  return stats;
}

interface InnerImageOpts extends ImageRefreshSweepOpts {
  stats: ImageRefreshSweepStats;
  log: (...args: unknown[]) => void;
}

async function sweepImagesForSource(
  db: Db,
  source: string,
  scraper: BaseScraper | undefined,
  opts: InnerImageOpts,
): Promise<void> {
  if (!scraper || !scraper.hasDetailPhase) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (scraper as any).init?.();

  const {
    deadlineMs,
    staleDays = IMAGE_REFRESH_STALE_DAYS_DEFAULT,
    headBatchSize = IMAGE_HEAD_BATCH_SIZE_DEFAULT,
    reenrichBatchSize = IMAGE_REENRICH_BATCH_SIZE_DEFAULT,
    headConcurrency = IMAGE_HEAD_CONCURRENCY_DEFAULT,
    dryRun,
    stats,
    log,
  } = opts;

  const perStat: ImageRefreshStats = {
    checked: 0,
    rotted: 0,
    reenrichedRot: 0,
    reenrichedStale: 0,
    errors: 0,
  };
  stats[source] = perStat;

  const limiter = pLimit(headConcurrency);

  while (Date.now() < deadlineMs - IMAGE_REENRICH_DEADLINE_MARGIN_MS) {
    // --- Pass A: prophylactic re-enrich of rows enriched > staleDays ago ---
    const staleBatch = await pickStaleForImageReenrich(
      db,
      source,
      reenrichBatchSize,
      staleDays,
    );
    if (staleBatch.length > 0) {
      const { success, errors } = await reenrichRows(
        db,
        source,
        scraper,
        staleBatch.map((r) => r.id),
        { dryRun: dryRun ?? false, log },
      );
      perStat.reenrichedStale += success;
      perStat.errors += errors;
      if (!dryRun) {
        try {
          await stampImageCheckedBatch(db, staleBatch.map((r) => r.id));
        } catch (err) {
          log(
            `[image-refresh] ${source} stampImageCheckedBatch (stale) failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    if (Date.now() >= deadlineMs - IMAGE_REENRICH_DEADLINE_MARGIN_MS) break;

    // --- Pass B: HEAD-driven rot detection ---
    const checkBatch = await pickStaleForImageCheck(db, source, headBatchSize);
    if (checkBatch.length === 0 && staleBatch.length === 0) break;
    if (checkBatch.length === 0) continue;

    const rottedIds: number[] = [];
    await Promise.all(
      checkBatch.map((row) =>
        limiter(async () => {
          if (Date.now() >= deadlineMs - IMAGE_REENRICH_DEADLINE_MARGIN_MS) return;
          try {
            // Share the scraper's RPS budget — HEAD is still a request.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rl = (scraper as any).http?.rateLimiter;
            if (rl?.acquire) await rl.acquire();

            const status = await headThumbnail(row.thumbnail_url);
            perStat.checked++;
            if (status === 404 || status === 410) {
              perStat.rotted++;
              rottedIds.push(row.id);
            }
          } catch (err) {
            perStat.errors++;
            if (perStat.errors <= 3) {
              log(
                `[image-refresh] ${source}#${row.id} HEAD error:`,
                err instanceof Error ? err.message : err,
              );
            }
          }
        }),
      ),
    );

    if (rottedIds.length > 0) {
      const { success, errors } = await reenrichRows(
        db,
        source,
        scraper,
        rottedIds,
        { dryRun: dryRun ?? false, log },
      );
      perStat.reenrichedRot += success;
      perStat.errors += errors;
    }

    // Stamp last_image_checked_at on everything we HEAD'd this pass, pass
    // or fail — rotted rows that got re-enriched also get their enriched_at
    // bumped inside reenrichRows, so the prophylactic query won't pick
    // them up again until staleDays elapse.
    if (!dryRun) {
      try {
        await stampImageCheckedBatch(db, checkBatch.map((r) => r.id));
      } catch (err) {
        log(
          `[image-refresh] ${source} stampImageCheckedBatch (check) failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}

async function headThumbnail(url: string): Promise<number> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), IMAGE_HEAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      // Referer helps some CDNs (notably idnes's sta-reality2.1gr.cz) avoid
      // 403-ing non-browser clients. We don't need to match the exact page;
      // the portal's root is enough.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      },
    });
    return res.status;
  } catch {
    // Network errors (timeout, DNS, TLS) look like "unknown" — return 0 so
    // the caller treats it as neither dead nor alive.
    return 0;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Reconstruct ScraperResult stubs from DB rows, run the scraper's detail
 * enrichment, stamp enriched_at where it took, and upsert.
 */
async function reenrichRows(
  db: Db,
  source: string,
  scraper: BaseScraper,
  ids: number[],
  opts: { dryRun: boolean; log: (...args: unknown[]) => void },
): Promise<{ success: number; errors: number }> {
  if (ids.length === 0) return { success: 0, errors: 0 };
  const rows = await getListingsByIds(db, ids);
  if (rows.length === 0) return { success: 0, errors: 0 };

  const stubs = rows.map(rowToScraperResult);

  try {
    await scraper.enrichListings(stubs);
  } catch (err) {
    opts.log(
      `[image-refresh] ${source} enrichListings threw:`,
      err instanceof Error ? err.message : err,
    );
    return { success: 0, errors: stubs.length };
  }

  stampEnrichedAt(stubs);

  if (opts.dryRun) {
    return { success: stubs.length, errors: 0 };
  }

  const res = await upsertBatch(db, stubs, (msg) =>
    opts.log(`[image-refresh] ${source} ${msg}`),
  );
  return { success: stubs.length - res.errorCount, errors: res.errorCount };
}

