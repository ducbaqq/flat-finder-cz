import { test, expect } from "@playwright/test";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - URL State Management", () => {
  test("filters update URL params", async ({ page }) => {
    await page.goto("/search", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);

    // Apply property type filter
    const bytyBtn = page.locator("button:has-text('Byty')").first();
    if (await bytyBtn.isVisible()) {
      await bytyBtn.click();
      await page.waitForTimeout(1500);
    }

    const url1 = page.url();
    console.log(`[DATA] URL after property type filter: ${url1}`);
    expect(url1).toContain("property_type=apartment");

    await page.screenshot({ path: `${RESULTS_DIR}/06-url-filter-applied.png` });
  });

  test("navigating to URL with filters restores filter state", async ({ page }) => {
    // Navigate directly with filter params
    await page.goto("/search?transaction_type=rent&property_type=apartment&sort=price_asc", {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);

    // Check that filters are applied visually
    // Check if "Byty" is highlighted
    const bytyBtn = page.locator("button:has-text('Byty')").first();
    const bytyClasses = await bytyBtn.getAttribute("class").catch(() => "");
    const isActive = bytyClasses?.includes("bg-primary");
    console.log(`[CHECK] 'Byty' button is active (highlighted): ${isActive}`);
    console.log(`[DATA] Byty button classes: ${bytyClasses?.substring(0, 100)}`);

    // Check sort
    const sortTrigger = page.locator("[role='combobox']").first();
    const sortText = await sortTrigger.textContent().catch(() => "");
    console.log(`[CHECK] Sort shows 'Cena': ${sortText}`);

    // Check active filter chips
    const chips = page.locator("[class*='badge'], [class*='Badge']");
    const chipCount = await chips.count();
    console.log(`[DATA] Active filter chips: ${chipCount}`);

    // Check that transaction toggle shows "rent" selected
    const sidebar = page.locator("aside").first();
    const rentBtn = sidebar.locator("[value='rent']").first();
    const rentState = await rentBtn.getAttribute("data-state").catch(() => "");
    console.log(`[CHECK] Rent toggle state: ${rentState}`);

    await page.screenshot({ path: `${RESULTS_DIR}/06-url-state-restored.png` });
  });

  test("pagination updates URL", async ({ page }) => {
    await page.goto("/search", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);

    const nextBtn = page.locator("button:has-text('Další')").first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(2000);

      const url = page.url();
      console.log(`[CHECK] URL after page 2: ${url}`);
      expect(url).toContain("page=2");

      // Go to page 3
      const nextBtn2 = page.locator("button:has-text('Další')").first();
      if (await nextBtn2.isVisible().catch(() => false) && !(await nextBtn2.isDisabled())) {
        await nextBtn2.click();
        await page.waitForTimeout(2000);

        const url3 = page.url();
        console.log(`[CHECK] URL after page 3: ${url3}`);
        expect(url3).toContain("page=3");
      }
    }

    await page.screenshot({ path: `${RESULTS_DIR}/06-url-pagination.png` });
  });

  test("browser back/forward navigation with filters", async ({ page }) => {
    await page.goto("/search", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);

    const initialUrl = page.url();
    console.log(`[DATA] Initial URL: ${initialUrl}`);

    // Apply filter 1
    const bytyBtn = page.locator("button:has-text('Byty')").first();
    if (await bytyBtn.isVisible()) {
      await bytyBtn.click();
      await page.waitForTimeout(1500);
    }
    const url1 = page.url();
    console.log(`[DATA] After filter 1: ${url1}`);

    // Apply filter 2 (change sort)
    const sortTrigger = page.locator("[role='combobox']").first();
    if (await sortTrigger.isVisible()) {
      await sortTrigger.click();
      await page.waitForTimeout(500);
      const priceOpt = page.locator("[role='option']:has-text('Cena')").first();
      if (await priceOpt.isVisible()) {
        await priceOpt.click();
        await page.waitForTimeout(1500);
      }
    }
    const url2 = page.url();
    console.log(`[DATA] After filter 2: ${url2}`);

    // Go back
    await page.goBack();
    await page.waitForTimeout(2000);
    const backUrl = page.url();
    console.log(`[DATA] After browser back: ${backUrl}`);
    console.log(`[CHECK] Back restored previous state: ${backUrl === url1}`);

    // Go forward
    await page.goForward();
    await page.waitForTimeout(2000);
    const forwardUrl = page.url();
    console.log(`[DATA] After browser forward: ${forwardUrl}`);
    console.log(`[CHECK] Forward restored next state: ${forwardUrl === url2}`);

    await page.screenshot({ path: `${RESULTS_DIR}/06-url-back-forward.png` });
  });

  test("view toggle persists in URL", async ({ page }) => {
    await page.goto("/search", { waitUntil: "networkidle" });

    // Switch to list view
    const listBtn = page.locator("[value='list']").first();
    if (await listBtn.isVisible()) {
      await listBtn.click();
      await page.waitForTimeout(1000);

      const url = page.url();
      console.log(`[CHECK] URL has view=list: ${url.includes("view=list")}`);
    }

    // Navigate directly to map view URL
    await page.goto("/search?view=map", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    // Verify map is showing
    const map = page.locator(".leaflet-container").first();
    const mapVisible = await map.isVisible().catch(() => false);
    console.log(`[CHECK] Map visible when navigating to view=map: ${mapVisible}`);

    await page.screenshot({ path: `${RESULTS_DIR}/06-url-view-persist.png` });
  });
});
