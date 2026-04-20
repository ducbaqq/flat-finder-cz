/**
 * Freshness-sweep dry run.
 *
 * Samples active listings from the DB, hits their source_url with the
 * same fetch+classify pipeline the watch-loop sweep uses, and reports
 * per-source verdict distributions. Does NOT write to the DB, does NOT
 * require the 0004_add_last_checked_at migration to be applied — the
 * sample query avoids the new column so you can audit classifiers
 * against production before shipping any schema change.
 *
 * Usage:
 *   npx tsx scripts/sweep-dry-run.ts                           # all sources, 50/source
 *   npx tsx scripts/sweep-dry-run.ts --source sreality --sample 200
 *   npx tsx scripts/sweep-dry-run.ts --source idnes --verbose  # print every verdict
 *
 * Exit code is always 0 — the script is an observational tool, not a
 * gate. Treat the output as "what would happen if I enabled the sweep."
 */
import { createDb } from "@flat-finder/db";
import { sql } from "drizzle-orm";
import pLimit from "p-limit";
import type {
  BaseScraper,
  LivenessResponse,
  LivenessVerdict,
} from "../apps/scraper/src/base-scraper.js";
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
import { getEnv } from "@flat-finder/config";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 10_000;
const BODY_READ_CAP_BYTES = 1_000_000;

const ALL_SOURCES = [
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
] as const;

type Args = {
  sources: string[];
  sample: number;
  verbose: boolean;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { sources: [...ALL_SOURCES], sample: 50, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--source" && args[i + 1]) {
      out.sources = [args[++i]];
    } else if (a.startsWith("--source=")) {
      out.sources = [a.slice("--source=".length)];
    } else if (a === "--sample" && args[i + 1]) {
      out.sample = Math.max(1, parseInt(args[++i], 10) || 50);
    } else if (a.startsWith("--sample=")) {
      out.sample = Math.max(1, parseInt(a.slice("--sample=".length), 10) || 50);
    } else if (a === "--verbose") {
      out.verbose = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npx tsx scripts/sweep-dry-run.ts [--source <name>] [--sample N] [--verbose]",
      );
      process.exit(0);
    }
  }
  return out;
}

function makeScraper(source: string): BaseScraper | null {
  const env = getEnv();
  const common = {
    maxRetries: 0,
    retryBaseMs: 0,
    timeoutMs: FETCH_TIMEOUT_MS,
    watchMode: true,
  };
  switch (source) {
    case "sreality":
      return new SrealityScraper({ ...common, rps: env.SREALITY_RPS, concurrency: env.SREALITY_CONCURRENCY });
    case "bezrealitky":
      return new BezrealitkyScraper({ ...common, rps: env.BEZREALITKY_RPS, concurrency: env.BEZREALITKY_CONCURRENCY });
    case "ulovdomov":
      return new UlovDomovScraper({ ...common, rps: env.ULOVDOMOV_RPS, concurrency: env.ULOVDOMOV_CONCURRENCY });
    case "bazos":
      return new BazosScraper({ ...common, rps: env.BAZOS_RPS, concurrency: env.BAZOS_CONCURRENCY });
    case "ereality":
      return new ERealityScraper({ ...common, rps: env.EREALITY_RPS, concurrency: env.EREALITY_CONCURRENCY });
    case "eurobydleni":
      return new EurobydleniScraper({ ...common, rps: env.EUROBYDLENI_RPS, concurrency: env.EUROBYDLENI_CONCURRENCY });
    case "ceskereality":
      return new CeskeRealityScraper({ ...common, rps: env.CESKEREALITY_RPS, concurrency: env.CESKEREALITY_CONCURRENCY, categoryParallelism: env.CESKEREALITY_CATEGORY_PARALLELISM, skipEnrichmentHours: env.CESKEREALITY_SKIP_ENRICHMENT_HOURS });
    case "realitymix":
      return new RealitymixScraper({ ...common, rps: env.REALITYMIX_RPS, concurrency: env.REALITYMIX_CONCURRENCY });
    case "idnes":
      return new IdnesScraper({ ...common, rps: env.IDNES_RPS, concurrency: env.IDNES_CONCURRENCY, categoryParallelism: env.IDNES_CATEGORY_PARALLELISM, skipEnrichmentHours: env.IDNES_SKIP_ENRICHMENT_HOURS });
    case "realingo":
      return new ReaLingoScraper({ ...common, rps: env.REALINGO_RPS, concurrency: env.REALINGO_CONCURRENCY });
    default:
      return null;
  }
}

interface Row {
  id: number;
  source_url: string;
}

async function pickSample(db: ReturnType<typeof createDb>["db"], source: string, limit: number): Promise<Row[]> {
  const rows = await db.execute<Row>(sql`
    SELECT id, source_url
    FROM listings
    WHERE is_active = true
      AND source = ${source}
      AND source_url IS NOT NULL
    ORDER BY random()
    LIMIT ${limit}
  `);
  // postgres-js returns an array-like; ensure plain array
  return Array.from(rows as unknown as Row[]);
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
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
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
    return { status: 0, location: "", url, body: "", networkError: true };
  } finally {
    clearTimeout(t);
  }
}

interface Bucket {
  verdict: LivenessVerdict;
  count: number;
  sample: Array<{ id: number; url: string; status: number; location?: string }>;
}

async function runForSource(
  db: ReturnType<typeof createDb>["db"],
  source: string,
  sampleSize: number,
  verbose: boolean,
): Promise<void> {
  const scraper = makeScraper(source);
  if (!scraper) {
    console.warn(`[dry-run] unknown source "${source}" — skipping`);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (scraper as any).init?.();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rl = (scraper as any).http?.rateLimiter;

  const t0 = Date.now();
  const rows = await pickSample(db, source, sampleSize);
  if (rows.length === 0) {
    console.log(`[${source}] no active rows with source_url — skipping`);
    return;
  }

  const buckets: Record<LivenessVerdict, Bucket> = {
    alive: { verdict: "alive", count: 0, sample: [] },
    dead: { verdict: "dead", count: 0, sample: [] },
    unknown: { verdict: "unknown", count: 0, sample: [] },
  };
  let errors = 0;

  const limiter = pLimit(4);
  await Promise.all(
    rows.map((row) =>
      limiter(async () => {
        try {
          if (rl?.acquire) await rl.acquire();
          const res = await fetchLiveness(row.source_url);
          const verdict = scraper.classifyLiveness(res);
          const bucket = buckets[verdict];
          bucket.count++;
          if (bucket.sample.length < 3) {
            bucket.sample.push({ id: row.id, url: row.source_url, status: res.status, location: res.location || undefined });
          }
          if (verbose) {
            console.log(
              `  ${verdict.padEnd(7)} status=${res.status} id=${row.id} ${row.source_url}` +
                (res.location ? ` -> ${res.location}` : ""),
            );
          }
        } catch (err) {
          errors++;
          if (verbose) console.log(`  ERROR id=${row.id}:`, err instanceof Error ? err.message : err);
        }
      }),
    ),
  );

  const total = rows.length;
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[${source}] ${total} checked in ${elapsed}s`);
  console.log(`  alive:   ${buckets.alive.count.toString().padStart(4)} (${pct(buckets.alive.count)})`);
  console.log(`  dead:    ${buckets.dead.count.toString().padStart(4)} (${pct(buckets.dead.count)})`);
  console.log(`  unknown: ${buckets.unknown.count.toString().padStart(4)} (${pct(buckets.unknown.count)})`);
  if (errors > 0) console.log(`  errors:  ${errors}`);
  for (const verdict of ["dead", "unknown", "alive"] as const) {
    const b = buckets[verdict];
    if (b.sample.length === 0) continue;
    console.log(`  sample ${verdict}:`);
    for (const s of b.sample) {
      console.log(
        `    status=${s.status}${s.location ? ` -> ${s.location}` : ""}  ${s.url}`,
      );
    }
  }
}

async function main() {
  const args = parseArgs();
  console.log(
    `Freshness-sweep DRY RUN — sources=[${args.sources.join(", ")}] sample=${args.sample} verbose=${args.verbose}\n`,
  );
  const conn = createDb();
  try {
    for (const source of args.sources) {
      await runForSource(conn.db, source, args.sample, args.verbose);
    }
  } finally {
    await conn.sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
