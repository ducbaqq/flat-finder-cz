/**
 * RPS (Requests Per Second) limit tester for scraper targets.
 *
 * Usage:
 *   npx tsx src/rps-test.ts <url> [GET|POST] [post-body-json]
 *
 * Tests RPS levels 5, 10, 15, 20, 30, 50 sequentially.
 * For each level: fires 30 sequential requests at the target RPS,
 * counts OK / 429 / other-error, and measures actual throughput.
 * No retries — raw failures surface immediately.
 */

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const RPS_LEVELS = [5, 10, 15, 20, 30, 50];
const REQUESTS_PER_LEVEL = 30;
const COOLDOWN_MS = 5000; // pause between levels to let rate limits reset

interface LevelResult {
  rps: number;
  ok: number;
  rate429: number;
  otherError: number;
  actualRps: number;
  errors: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testLevel(
  url: string,
  method: string,
  body: string | undefined,
  targetRps: number,
): Promise<LevelResult> {
  const intervalMs = 1000 / targetRps;
  let ok = 0;
  let rate429 = 0;
  let otherError = 0;
  const errors: string[] = [];

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
  };

  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    headers["Accept"] = "application/json";
  } else {
    headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    // Add AJAX header for idnes
    if (url.includes("reality.idnes.cz")) {
      headers["X-Requested-With"] = "XMLHttpRequest";
    }
  }

  const start = Date.now();

  for (let i = 0; i < REQUESTS_PER_LEVEL; i++) {
    const reqStart = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, {
        method,
        headers,
        body: body ?? undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.ok) {
        // Consume body to free resources
        await res.text();
        ok++;
      } else if (res.status === 429) {
        await res.text();
        rate429++;
        errors.push(`Request ${i + 1}: HTTP 429`);
      } else if (res.status === 403) {
        await res.text();
        otherError++;
        errors.push(`Request ${i + 1}: HTTP 403 Forbidden`);
      } else {
        await res.text();
        otherError++;
        errors.push(`Request ${i + 1}: HTTP ${res.status}`);
      }
    } catch (err: unknown) {
      otherError++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Request ${i + 1}: ${msg}`);
    }

    // Enforce timing for next request
    const elapsed = Date.now() - reqStart;
    const waitMs = intervalMs - elapsed;
    if (waitMs > 0 && i < REQUESTS_PER_LEVEL - 1) {
      await sleep(waitMs);
    }
  }

  const totalMs = Date.now() - start;
  const actualRps = (REQUESTS_PER_LEVEL / totalMs) * 1000;

  return { rps: targetRps, ok, rate429, otherError, actualRps, errors };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: npx tsx src/rps-test.ts <url> [GET|POST] [post-body-json]");
    process.exit(1);
  }

  const url = args[0];
  const method = (args[1] ?? "GET").toUpperCase();
  const body = args[2] ?? undefined;

  console.log(`\n=== RPS Test: ${url} (${method}) ===\n`);

  const results: LevelResult[] = [];
  let maxSafeRps = 0;

  for (const rps of RPS_LEVELS) {
    process.stdout.write(`Testing RPS ${rps.toString().padStart(2)}... `);

    const result = await testLevel(url, method, body, rps);
    results.push(result);

    const status =
      result.rate429 > 0
        ? `RATE LIMITED (${result.rate429}x 429)`
        : result.otherError > 0
          ? `ERRORS (${result.otherError}x)`
          : "OK";

    console.log(
      `${result.ok}/${REQUESTS_PER_LEVEL} OK, ` +
        `${result.rate429} x 429, ${result.otherError} errors ` +
        `(actual ${result.actualRps.toFixed(1)} rps) — ${status}`,
    );

    if (result.rate429 > 0 && result.errors.length > 0) {
      console.log(`    First 429 at: ${result.errors.find((e) => e.includes("429"))}`);
    }
    if (result.otherError > 0) {
      const firstErr = result.errors.find((e) => !e.includes("429"));
      if (firstErr) console.log(`    First error: ${firstErr}`);
    }

    if (result.rate429 === 0 && result.otherError === 0) {
      maxSafeRps = rps;
    }

    // If we got rate limited or many errors, no need to test higher
    if (result.rate429 >= 5 || result.otherError >= 5) {
      console.log(`  Stopping — too many failures at RPS ${rps}`);
      break;
    }

    // Cooldown between levels
    if (rps !== RPS_LEVELS[RPS_LEVELS.length - 1]) {
      await sleep(COOLDOWN_MS);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`URL: ${url}`);
  console.log(`Max safe RPS: ${maxSafeRps > 0 ? maxSafeRps : "< 5 (all levels had failures)"}`);
  console.log();

  // Print table
  console.log("RPS  | OK  | 429 | Err | Actual RPS");
  console.log("-----|-----|-----|-----|----------");
  for (const r of results) {
    console.log(
      `${r.rps.toString().padStart(4)} | ${r.ok.toString().padStart(3)} | ${r.rate429.toString().padStart(3)} | ${r.otherError.toString().padStart(3)} | ${r.actualRps.toFixed(1)}`,
    );
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
