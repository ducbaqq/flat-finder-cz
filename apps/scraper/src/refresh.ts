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
  pickStaleForLiveness,
  reactivateIfLivenessDeactivated,
  stampCheckedBatch,
  type Db,
  type LivenessCandidate,
} from "@flat-finder/db";
import type {
  BaseScraper,
  LivenessResponse,
  LivenessVerdict,
} from "./base-scraper.js";

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
