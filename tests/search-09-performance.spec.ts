import { test, expect } from "@playwright/test";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - Performance", () => {
  test("measure initial page load performance", async ({ page }) => {
    const apiTimings: { url: string; start: number; end: number; duration: number; status: number }[] = [];
    let firstApiStart = 0;

    page.on("request", (req) => {
      if (req.url().includes("/api/")) {
        const now = Date.now();
        if (!firstApiStart) firstApiStart = now;
        (req as any).__startTime = now;
      }
    });

    page.on("response", async (res) => {
      if (res.url().includes("/api/")) {
        const startTime = (res.request() as any).__startTime || 0;
        const duration = startTime ? Date.now() - startTime : -1;
        apiTimings.push({
          url: res.url().replace(/https?:\/\/[^/]+/, ""),
          start: startTime,
          end: Date.now(),
          duration,
          status: res.status(),
        });
      }
    });

    const navStart = Date.now();
    await page.goto("/search");

    // Wait for DOMContentLoaded
    const domReady = Date.now() - navStart;

    await page.waitForLoadState("networkidle");
    const networkIdle = Date.now() - navStart;

    // Wait for listings to appear
    await page.waitForSelector("article", { timeout: 15000 }).catch(() => null);
    const firstContentful = Date.now() - navStart;

    // Wait for map tiles
    await page.waitForSelector(".leaflet-tile-loaded", { timeout: 15000 }).catch(() => null);
    const mapReady = Date.now() - navStart;

    console.log("\n=== PERFORMANCE METRICS ===");
    console.log(`[PERF] DOM ready: ${domReady}ms`);
    console.log(`[PERF] Network idle: ${networkIdle}ms`);
    console.log(`[PERF] First listing visible: ${firstContentful}ms`);
    console.log(`[PERF] Map tiles loaded: ${mapReady}ms`);

    console.log(`\n=== API CALL TIMINGS (${apiTimings.length} total) ===`);
    apiTimings.sort((a, b) => a.start - b.start);
    apiTimings.forEach((t, i) => {
      const flag = t.status >= 400 ? "FAIL" : t.duration > 500 ? "SLOW" : "OK";
      console.log(`  [${flag}] ${t.url.substring(0, 100)} -> ${t.status} (${t.duration}ms)`);
    });

    // Check for slow calls
    const slowCalls = apiTimings.filter((t) => t.duration > 500);
    console.log(`\n[PERF] Slow API calls (>500ms): ${slowCalls.length}`);
    slowCalls.forEach((t) => {
      console.log(`  SLOW: ${t.url.substring(0, 80)} took ${t.duration}ms`);
    });

    // Check for failed calls
    const failedCalls = apiTimings.filter((t) => t.status >= 400);
    console.log(`[PERF] Failed API calls: ${failedCalls.length}`);

    // Check for duplicates
    const urlCounts = new Map<string, number>();
    apiTimings.forEach((t) => {
      const key = t.url.split("?")[0];
      urlCounts.set(key, (urlCounts.get(key) || 0) + 1);
    });
    const dupes = Array.from(urlCounts.entries()).filter(([, c]) => c > 1);
    if (dupes.length > 0) {
      console.log(`\n[WARN] Duplicate API endpoints called:`);
      dupes.forEach(([url, count]) => console.log(`  ${url}: ${count} calls`));
    }

    await page.screenshot({ path: `${RESULTS_DIR}/09-performance-loaded.png` });
  });

  test("measure filter change response time", async ({ page }) => {
    await page.goto("/search?view=list", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);

    let apiCallStart = 0;
    let apiCallEnd = 0;

    page.on("request", (req) => {
      if (req.url().includes("/api/listings")) {
        apiCallStart = Date.now();
      }
    });

    page.on("response", (res) => {
      if (res.url().includes("/api/listings")) {
        apiCallEnd = Date.now();
      }
    });

    // Apply filter and measure
    const bytyBtn = page.locator("button:has-text('Byty')").first();
    if (await bytyBtn.isVisible()) {
      const filterClickTime = Date.now();
      await bytyBtn.click();
      await page.waitForTimeout(500);
      await page.waitForLoadState("networkidle");
      await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);
      const filterDone = Date.now();

      const totalTime = filterDone - filterClickTime;
      const apiTime = apiCallEnd - apiCallStart;

      console.log(`[PERF] Filter change total time: ${totalTime}ms`);
      console.log(`[PERF] API response time for listings: ${apiTime}ms`);
    }

    await page.screenshot({ path: `${RESULTS_DIR}/09-performance-filter.png` });
  });

  test("rapid filter changes - debounce check", async ({ page }) => {
    await page.goto("/search?view=list", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);

    const apiCalls: { url: string; time: number }[] = [];

    page.on("request", (req) => {
      if (req.url().includes("/api/listings")) {
        apiCalls.push({ url: req.url(), time: Date.now() });
      }
    });

    // Rapidly click different filters
    const filters = ["Byty", "Domy", "Vše", "Byty", "Vše"];
    for (const label of filters) {
      const btn = page.locator(`button:has-text('${label}')`).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(100); // Rapid clicks
      }
    }

    await page.waitForTimeout(3000);
    await page.waitForLoadState("networkidle");

    console.log(`[PERF] API calls after ${filters.length} rapid filter changes: ${apiCalls.length}`);
    console.log(`[CHECK] Debounced (fewer calls than clicks): ${apiCalls.length < filters.length}`);

    apiCalls.forEach((c, i) => {
      const timeSinceLast = i > 0 ? c.time - apiCalls[i - 1].time : 0;
      console.log(`  Call ${i + 1}: +${timeSinceLast}ms ${c.url.substring(0, 80)}...`);
    });

    await page.screenshot({ path: `${RESULTS_DIR}/09-performance-debounce.png` });
  });

  test("measure pagination response time", async ({ page }) => {
    await page.goto("/search?view=list", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);

    const nextBtn = page.locator("button:has-text('Další')").first();
    if (await nextBtn.isVisible().catch(() => false)) {
      let apiStart = 0;
      let apiEnd = 0;

      page.on("request", (req) => {
        if (req.url().includes("/api/listings") && req.url().includes("page=2")) {
          apiStart = Date.now();
        }
      });

      page.on("response", (res) => {
        if (res.url().includes("/api/listings") && res.url().includes("page=2")) {
          apiEnd = Date.now();
        }
      });

      const clickTime = Date.now();
      await nextBtn.click();
      await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);
      await page.waitForLoadState("networkidle");
      const totalTime = Date.now() - clickTime;

      console.log(`[PERF] Pagination total time: ${totalTime}ms`);
      console.log(`[PERF] Pagination API time: ${apiEnd > 0 ? apiEnd - apiStart : "N/A"}ms`);
    }

    await page.screenshot({ path: `${RESULTS_DIR}/09-performance-pagination.png` });
  });
});
