/**
 * Liveness-check prototype.
 *
 * Iterates active listings in the DB and fetches each source_url to classify
 * its current state. DRY-RUN only — logs a status bucket per source; does not
 * deactivate anything. Soft-404 detection (2xx with "listing removed" content)
 * is NOT implemented in this prototype — we only read the status code and
 * report 2xx/3xx/404/410/429/5xx/network buckets so we can see how each portal
 * actually responds to delisted URLs in the wild.
 *
 * Usage:
 *   npx tsx scripts/liveness-check.ts                 # all sources
 *   npx tsx scripts/liveness-check.ts --source sreality
 *   npx tsx scripts/liveness-check.ts --sample 500    # random 500/source
 *   npx tsx scripts/liveness-check.ts --source realitymix --sample 100
 */
import { config } from "dotenv";
config();

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import pLimit from "p-limit";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

// Per-source concurrency + RPS (aligned with scraper defaults in
// packages/config/src/index.ts; RPS is enforced by the interval between
// acquires, concurrency by p-limit).
interface SourceLimits {
  rps: number;
  concurrency: number;
}

const LIMITS: Record<string, SourceLimits> = {
  sreality: { rps: 25, concurrency: 25 },
  idnes: { rps: 25, concurrency: 25 },
  bazos: { rps: 20, concurrency: 10 },
  ulovdomov: { rps: 8, concurrency: 10 },
  bezrealitky: { rps: 3, concurrency: 5 },
  ceskereality: { rps: 5, concurrency: 5 },
  realitymix: { rps: 5, concurrency: 5 },
  ereality: { rps: 10, concurrency: 8 },
  eurobydleni: { rps: 10, concurrency: 8 },
  realingo: { rps: 5, concurrency: 5 },
};

const TIMEOUT_MS = 15000;

type Bucket =
  | "alive"      // 2xx
  | "redirect"   // 3xx (may be login/soft-404 — caller should inspect)
  | "dead_404"
  | "dead_410"
  | "rate_limited" // 429
  | "server_error" // 5xx
  | "network_error";

function bucketFor(status: number): Bucket {
  if (status >= 200 && status < 300) return "alive";
  if (status >= 300 && status < 400) return "redirect";
  if (status === 404) return "dead_404";
  if (status === 410) return "dead_410";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "network_error";
}

function connect() {
  const username = process.env.DB_USERNAME ?? "flat_finder";
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? "");
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const database = process.env.DB_DATABASE ?? "flat_finder";
  const url = `postgres://${username}:${password}@${host}:${port}/${database}`;

  const caPath = path.resolve(process.cwd(), "certs/ca-certificate.crt");
  const ssl =
    process.env.DB_SSLMODE === "disable"
      ? false
      : fs.existsSync(caPath)
        ? { ca: fs.readFileSync(caPath, "utf-8"), rejectUnauthorized: true }
        : { rejectUnauthorized: false };

  return postgres(url, { ssl, max: 2, connect_timeout: 15 });
}

// Minimal token-bucket rate limiter. Mirrors apps/scraper/src/rate-limiter.ts
// — inlined so this script has zero build-time deps on workspace packages.
class RateLimiter {
  private readonly interval: number;
  private lastTime = 0;
  constructor(rps: number) {
    this.interval = rps > 0 ? 1000 / rps : 0;
  }
  async acquire(): Promise<void> {
    const now = performance.now();
    const wait = this.lastTime + this.interval - now;
    this.lastTime = Math.max(now, this.lastTime + this.interval);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

async function checkOne(
  url: string,
  rateLimiter: RateLimiter,
): Promise<{ bucket: Bucket; status: number; err?: string }> {
  await rateLimiter.acquire();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Use GET; some portals reject HEAD with 405. redirect: "manual" so we
    // capture 3xx responses distinctly rather than following through to a
    // possible login page or soft-404.
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
      },
    });
    // Drain body to release the socket — but we don't inspect content yet.
    await res.body?.cancel().catch(() => {});
    return { bucket: bucketFor(res.status), status: res.status };
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    return {
      bucket: "network_error",
      status: 0,
      err: e.name === "AbortError" ? "timeout" : (e.message ?? "error"),
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { source?: string; sample?: number; limit?: number } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--source") out.source = args[++i];
    else if (a === "--sample") out.sample = Number(args[++i]);
    else if (a === "--limit") out.limit = Number(args[++i]);
  }
  return out;
}

interface Row {
  id: number;
  source: string;
  source_url: string;
}

async function fetchActiveListings(
  sql: postgres.Sql,
  opts: { source?: string; sample?: number; limit?: number },
): Promise<Row[]> {
  if (opts.sample) {
    // Random sample per source. TABLESAMPLE BERNOULLI is approximate but
    // fast; for small samples we use ORDER BY random() which is fine at
    // prototype scale.
    const rows = await sql<Row[]>`
      WITH ranked AS (
        SELECT id, source, source_url,
               row_number() OVER (PARTITION BY source ORDER BY random()) AS rn
        FROM listings
        WHERE is_active = true
          AND source_url IS NOT NULL
          ${opts.source ? sql`AND source = ${opts.source}` : sql``}
      )
      SELECT id, source, source_url FROM ranked WHERE rn <= ${opts.sample}
    `;
    return rows;
  }
  return sql<Row[]>`
    SELECT id, source, source_url
    FROM listings
    WHERE is_active = true
      AND source_url IS NOT NULL
      ${opts.source ? sql`AND source = ${opts.source}` : sql``}
    ${opts.limit ? sql`LIMIT ${opts.limit}` : sql``}
  `;
}

interface SourceStats {
  source: string;
  total: number;
  counts: Record<Bucket, number>;
  samples: { alive?: string; dead_404?: string; redirect?: string };
  startedAt: number;
  finishedAt?: number;
}

function emptyStats(source: string, total: number): SourceStats {
  return {
    source,
    total,
    counts: {
      alive: 0,
      redirect: 0,
      dead_404: 0,
      dead_410: 0,
      rate_limited: 0,
      server_error: 0,
      network_error: 0,
    },
    samples: {},
    startedAt: performance.now(),
  };
}

async function checkSource(source: string, rows: Row[]): Promise<SourceStats> {
  const limits = LIMITS[source] ?? { rps: 5, concurrency: 5 };
  const rateLimiter = new RateLimiter(limits.rps);
  const limit = pLimit(limits.concurrency);
  const stats = emptyStats(source, rows.length);

  let done = 0;
  const progressEvery = Math.max(50, Math.floor(rows.length / 20));

  const tasks = rows.map((row) =>
    limit(async () => {
      const result = await checkOne(row.source_url, rateLimiter);
      stats.counts[result.bucket]++;
      done++;
      if (result.bucket === "alive" && !stats.samples.alive)
        stats.samples.alive = row.source_url;
      if (result.bucket === "dead_404" && !stats.samples.dead_404)
        stats.samples.dead_404 = row.source_url;
      if (result.bucket === "redirect" && !stats.samples.redirect)
        stats.samples.redirect = row.source_url;

      if (done % progressEvery === 0 || done === rows.length) {
        const pct = ((done / rows.length) * 100).toFixed(0);
        const elapsed = (performance.now() - stats.startedAt) / 1000;
        const rps = (done / elapsed).toFixed(1);
        console.log(
          `  [${source}] ${done}/${rows.length} (${pct}%) — ` +
            `alive=${stats.counts.alive} 404=${stats.counts.dead_404} 410=${stats.counts.dead_410} ` +
            `3xx=${stats.counts.redirect} 429=${stats.counts.rate_limited} ` +
            `5xx=${stats.counts.server_error} net=${stats.counts.network_error} ` +
            `— ${rps} rps`,
        );
      }
    }),
  );

  await Promise.all(tasks);
  stats.finishedAt = performance.now();
  return stats;
}

function summarize(stats: SourceStats[]) {
  console.log("\n=== Summary ===\n");
  const header = [
    "source",
    "total",
    "alive",
    "404",
    "410",
    "3xx",
    "429",
    "5xx",
    "net_err",
    "wall",
    "eff_rps",
  ];
  const rows: string[][] = [header];
  for (const s of stats) {
    const wall = s.finishedAt
      ? ((s.finishedAt - s.startedAt) / 1000).toFixed(1) + "s"
      : "-";
    const effRps = s.finishedAt
      ? (s.total / ((s.finishedAt - s.startedAt) / 1000)).toFixed(1)
      : "-";
    rows.push([
      s.source,
      String(s.total),
      String(s.counts.alive),
      String(s.counts.dead_404),
      String(s.counts.dead_410),
      String(s.counts.redirect),
      String(s.counts.rate_limited),
      String(s.counts.server_error),
      String(s.counts.network_error),
      wall,
      effRps,
    ]);
  }
  const widths = header.map((_, i) =>
    Math.max(...rows.map((r) => r[i].length)),
  );
  for (const r of rows) {
    console.log(r.map((c, i) => c.padEnd(widths[i])).join("  "));
  }

  console.log("\nSample URLs per source:");
  for (const s of stats) {
    console.log(`  [${s.source}]`);
    if (s.samples.alive) console.log(`    alive:    ${s.samples.alive}`);
    if (s.samples.dead_404) console.log(`    dead_404: ${s.samples.dead_404}`);
    if (s.samples.redirect) console.log(`    redirect: ${s.samples.redirect}`);
  }
  console.log(
    "\nNOTE: 3xx and 2xx can still be delisted (soft-404). " +
      "Next step is per-source content inspection of a few samples to decide " +
      "what marks a URL as dead vs alive.",
  );
}

async function main() {
  const opts = parseArgs();
  const sql = connect();

  try {
    console.log(
      `Loading active listings${opts.source ? ` (source=${opts.source})` : ""}` +
        `${opts.sample ? ` (sample=${opts.sample}/source)` : ""}` +
        `${opts.limit ? ` (limit=${opts.limit})` : ""}...`,
    );
    const rows = await fetchActiveListings(sql, opts);
    console.log(`Loaded ${rows.length} rows.\n`);

    // Group by source
    const bySource = new Map<string, Row[]>();
    for (const r of rows) {
      if (!bySource.has(r.source)) bySource.set(r.source, []);
      bySource.get(r.source)!.push(r);
    }

    // Run all sources in parallel — each source has its own rate limit,
    // and they hit different hosts so there's no cross-source interference.
    const globalStart = performance.now();
    const results = await Promise.all(
      [...bySource.entries()].map(([source, rows]) =>
        checkSource(source, rows),
      ),
    );
    const globalElapsed = (performance.now() - globalStart) / 1000;

    summarize(results);
    console.log(`\nTotal wall time: ${globalElapsed.toFixed(1)}s`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
