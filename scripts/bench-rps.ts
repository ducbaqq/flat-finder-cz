/**
 * Benchmark max RPS for ceskereality and idnes.
 *
 * Tests increasing concurrency levels against each site, measuring:
 *  - Effective RPS (successful requests / wall time)
 *  - Error rate (429s, 5xx, timeouts)
 *  - Avg / p50 / p95 / p99 latency
 *
 * Usage: npx tsx scripts/bench-rps.ts [ceskereality|idnes|both]
 */

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

interface BenchResult {
  concurrency: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  error429Count: number;
  error5xxCount: number;
  timeoutCount: number;
  wallTimeMs: number;
  effectiveRps: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

async function fetchOne(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = 15000,
): Promise<{ status: number; latencyMs: number; error?: string }> {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        ...headers,
      },
      signal: controller.signal,
    });
    const latencyMs = performance.now() - t0;
    // Consume body to free connection
    await res.text();
    return { status: res.status, latencyMs };
  } catch (err: unknown) {
    const latencyMs = performance.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("Abort")) {
      return { status: 0, latencyMs, error: "timeout" };
    }
    return { status: 0, latencyMs, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function benchConcurrency(
  label: string,
  urls: string[],
  concurrency: number,
  totalRequests: number,
  headers?: Record<string, string>,
): Promise<BenchResult> {
  const latencies: number[] = [];
  let successCount = 0;
  let errorCount = 0;
  let error429Count = 0;
  let error5xxCount = 0;
  let timeoutCount = 0;

  // Use a simple concurrency pool
  let urlIdx = 0;
  const getNextUrl = () => urls[urlIdx++ % urls.length];

  const t0 = performance.now();
  const inflight = new Set<Promise<void>>();
  let launched = 0;

  while (launched < totalRequests) {
    while (inflight.size < concurrency && launched < totalRequests) {
      const url = getNextUrl();
      launched++;
      const p = fetchOne(url, headers).then((r) => {
        latencies.push(r.latencyMs);
        if (r.status >= 200 && r.status < 400) {
          successCount++;
        } else if (r.status === 429) {
          error429Count++;
          errorCount++;
        } else if (r.status >= 500) {
          error5xxCount++;
          errorCount++;
        } else if (r.error === "timeout") {
          timeoutCount++;
          errorCount++;
        } else {
          errorCount++;
        }
        inflight.delete(p);
      });
      inflight.add(p);
    }
    // Wait for at least one to finish
    if (inflight.size >= concurrency) {
      await Promise.race(inflight);
    }
  }

  // Wait for remaining
  await Promise.all(inflight);
  const wallTimeMs = performance.now() - t0;

  latencies.sort((a, b) => a - b);

  return {
    concurrency,
    totalRequests: launched,
    successCount,
    errorCount,
    error429Count,
    error5xxCount,
    timeoutCount,
    wallTimeMs,
    effectiveRps: (successCount / wallTimeMs) * 1000,
    avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
  };
}

function printResult(label: string, r: BenchResult) {
  console.log(
    `  conc=${String(r.concurrency).padStart(3)} | ` +
      `${r.successCount}/${r.totalRequests} ok | ` +
      `429=${r.error429Count} 5xx=${r.error5xxCount} timeout=${r.timeoutCount} | ` +
      `${r.effectiveRps.toFixed(1)} eff RPS | ` +
      `avg=${r.avgLatencyMs.toFixed(0)}ms p50=${r.p50Ms.toFixed(0)}ms p95=${r.p95Ms.toFixed(0)}ms p99=${r.p99Ms.toFixed(0)}ms | ` +
      `wall=${(r.wallTimeMs / 1000).toFixed(1)}s`,
  );
}

async function benchCeskereality() {
  console.log("\n=== CeskeReality RPS Benchmark ===");
  console.log("Target: https://www.ceskereality.cz (HTML list pages)\n");

  const urls = [
    "https://www.ceskereality.cz/prodej/byty/",
    "https://www.ceskereality.cz/prodej/byty/?strana=2",
    "https://www.ceskereality.cz/prodej/byty/?strana=3",
    "https://www.ceskereality.cz/pronajem/byty/",
    "https://www.ceskereality.cz/pronajem/byty/?strana=2",
    "https://www.ceskereality.cz/prodej/rodinne-domy/",
    "https://www.ceskereality.cz/prodej/pozemky/",
    "https://www.ceskereality.cz/pronajem/rodinne-domy/",
  ];

  const levels = [1, 2, 3, 5, 8, 10, 15, 20];
  const results: BenchResult[] = [];

  for (const conc of levels) {
    const reqCount = Math.min(conc * 5, 40); // enough to measure, not too many
    const r = await benchConcurrency("ceskereality", urls, conc, reqCount);
    results.push(r);
    printResult("ceskereality", r);

    // Stop if we're getting mostly 429s
    if (r.error429Count > r.totalRequests * 0.3) {
      console.log("  ↳ >30% 429 errors, stopping escalation");
      break;
    }

    // Brief cooldown between levels
    await new Promise((r) => setTimeout(r, 2000));
  }

  return results;
}

async function benchIdnes() {
  console.log("\n=== Idnes Reality RPS Benchmark ===");
  console.log("Target: https://reality.idnes.cz (AJAX JSON endpoint)\n");

  const urls = [
    "https://reality.idnes.cz/s/prodej/byty/?page=1",
    "https://reality.idnes.cz/s/prodej/byty/?page=2",
    "https://reality.idnes.cz/s/prodej/byty/?page=3",
    "https://reality.idnes.cz/s/pronajem/byty/?page=1",
    "https://reality.idnes.cz/s/pronajem/byty/?page=2",
    "https://reality.idnes.cz/s/prodej/domy/?page=1",
    "https://reality.idnes.cz/s/prodej/pozemky/?page=1",
    "https://reality.idnes.cz/s/pronajem/domy/?page=1",
  ];

  const ajaxHeaders = {
    "X-Requested-With": "XMLHttpRequest",
    Referer: "https://reality.idnes.cz/s/prodej/byty/",
  };

  const levels = [1, 3, 5, 10, 15, 20, 30, 40, 50];
  const results: BenchResult[] = [];

  for (const conc of levels) {
    const reqCount = Math.min(conc * 5, 60);
    const r = await benchConcurrency("idnes", urls, conc, reqCount, ajaxHeaders);
    results.push(r);
    printResult("idnes", r);

    if (r.error429Count > r.totalRequests * 0.3) {
      console.log("  ↳ >30% 429 errors, stopping escalation");
      break;
    }
    if (r.errorCount > r.totalRequests * 0.5) {
      console.log("  ↳ >50% errors, stopping escalation");
      break;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  return results;
}

async function main() {
  const target = process.argv[2] ?? "both";

  if (target === "ceskereality" || target === "both") {
    await benchCeskereality();
  }
  if (target === "idnes" || target === "both") {
    await benchIdnes();
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
