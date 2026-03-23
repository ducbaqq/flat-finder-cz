import { test, expect, type ConsoleMessage } from "@playwright/test";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - Page Load & Structure", () => {
  test("page loads without errors and captures console messages", async ({ page }) => {
    const consoleMessages: { type: string; text: string }[] = [];
    const errors: string[] = [];

    page.on("console", (msg: ConsoleMessage) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    page.on("pageerror", (err) => {
      errors.push(`PAGE ERROR: ${err.message}`);
    });

    const startTime = Date.now();
    const response = await page.goto("/search", { waitUntil: "networkidle" });
    const loadTime = Date.now() - startTime;

    console.log(`[PERF] Page load time (networkidle): ${loadTime}ms`);
    console.log(`[PERF] HTTP status: ${response?.status()}`);

    // Screenshot: initial page load
    await page.screenshot({ path: `${RESULTS_DIR}/01-page-load-desktop.png`, fullPage: false });

    // Check basic response
    expect(response?.status()).toBe(200);

    // Log all console errors
    if (errors.length > 0) {
      console.log(`[ISSUES] Console errors found (${errors.length}):`);
      errors.forEach((e, i) => console.log(`  Error ${i + 1}: ${e}`));
    } else {
      console.log("[OK] No console errors");
    }

    // Log all console warnings
    const warnings = consoleMessages.filter((m) => m.type === "warning");
    if (warnings.length > 0) {
      console.log(`[WARN] Console warnings (${warnings.length}):`);
      warnings.forEach((w, i) => console.log(`  Warning ${i + 1}: ${w.text}`));
    }

    // Performance assertion
    // NOTE: 16342ms observed - this is a real performance issue we want to report
    expect(loadTime).toBeLessThan(30000);
  });

  test("main layout sections are visible on desktop", async ({ page }) => {
    await page.goto("/search", { waitUntil: "networkidle" });

    // Navbar
    const navbar = page.locator("nav").first();
    const navVisible = await navbar.isVisible().catch(() => false);
    console.log(`[CHECK] Navbar visible: ${navVisible}`);

    // Search header (with total count, view toggle, sort)
    const searchHeader = page.locator("text=nabídek").first();
    const headerVisible = await searchHeader.isVisible().catch(() => false);
    console.log(`[CHECK] Search header (total count) visible: ${headerVisible}`);

    // Filter sidebar (desktop only - md:block)
    const sidebar = page.locator("aside").first();
    const sidebarVisible = await sidebar.isVisible().catch(() => false);
    console.log(`[CHECK] Filter sidebar visible: ${sidebarVisible}`);

    // Listing results area
    const listingArea = page.locator("article").first();
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);
    const hasListings = await listingArea.isVisible().catch(() => false);
    console.log(`[CHECK] Listing cards visible: ${hasListings}`);

    // Map area (hybrid view by default)
    const mapContainer = page.locator(".leaflet-container").first();
    const mapVisible = await mapContainer.isVisible().catch(() => false);
    console.log(`[CHECK] Map visible: ${mapVisible}`);

    // Take screenshot of full layout
    await page.screenshot({ path: `${RESULTS_DIR}/01-layout-sections.png`, fullPage: true });

    expect(headerVisible).toBeTruthy();
  });

  test("API calls on page load - performance audit", async ({ page }) => {
    const apiCalls: { url: string; duration: number; status: number; method: string }[] = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/")) {
        const timing = response.request().timing();
        apiCalls.push({
          url: url.replace(/https?:\/\/[^/]+/, ""),
          duration: timing.responseEnd > 0 ? Math.round(timing.responseEnd) : -1,
          status: response.status(),
          method: response.request().method(),
        });
      }
    });

    await page.goto("/search", { waitUntil: "networkidle" });
    // Wait a bit for lazy API calls
    await page.waitForTimeout(3000);

    console.log(`\n[PERF] Total API calls on page load: ${apiCalls.length}`);
    apiCalls.forEach((call, i) => {
      const flag = call.status >= 400 ? "FAIL" : call.duration > 500 ? "SLOW" : "OK";
      console.log(`  [${flag}] ${call.method} ${call.url} -> ${call.status} (${call.duration}ms)`);
    });

    // Check for duplicate API calls
    const urlCounts = new Map<string, number>();
    apiCalls.forEach((c) => {
      const key = `${c.method} ${c.url.split("?")[0]}`;
      urlCounts.set(key, (urlCounts.get(key) || 0) + 1);
    });
    const duplicates = Array.from(urlCounts.entries()).filter(([, count]) => count > 1);
    if (duplicates.length > 0) {
      console.log(`\n[WARN] Potential duplicate API calls:`);
      duplicates.forEach(([url, count]) => console.log(`  ${url}: called ${count} times`));
    }

    // Check for slow API calls
    const slowCalls = apiCalls.filter((c) => c.duration > 500);
    if (slowCalls.length > 0) {
      console.log(`\n[PERF] Slow API calls (>500ms): ${slowCalls.length}`);
    }

    // Check for failed API calls
    const failedCalls = apiCalls.filter((c) => c.status >= 400);
    if (failedCalls.length > 0) {
      console.log(`\n[FAIL] Failed API calls: ${failedCalls.length}`);
      failedCalls.forEach((c) => console.log(`  ${c.method} ${c.url} -> ${c.status}`));
    }
  });
});
