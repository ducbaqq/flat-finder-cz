import { test, expect } from "@playwright/test";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - View Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/search", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);
  });

  test("view toggle buttons are visible and functional", async ({ page }) => {
    // Default view should be "hybrid"
    const url = page.url();
    const defaultView = url.includes("view=") ? new URL(url).searchParams.get("view") : "hybrid";
    console.log(`[DATA] Default view: ${defaultView}`);

    // Find toggle group
    const toggleGroup = page.locator("[role='group']").first();
    const toggleVisible = await toggleGroup.isVisible().catch(() => false);
    console.log(`[CHECK] View toggle group visible: ${toggleVisible}`);

    // Check individual buttons
    const listBtn = page.locator("[value='list']").first();
    const hybridBtn = page.locator("[value='hybrid']").first();
    const mapBtn = page.locator("[value='map']").first();

    console.log(`[CHECK] List button visible: ${await listBtn.isVisible().catch(() => false)}`);
    console.log(`[CHECK] Hybrid button visible: ${await hybridBtn.isVisible().catch(() => false)}`);
    console.log(`[CHECK] Map button visible: ${await mapBtn.isVisible().catch(() => false)}`);

    // Check which is active
    const listPressed = await listBtn.getAttribute("data-state").catch(() => "");
    const hybridPressed = await hybridBtn.getAttribute("data-state").catch(() => "");
    const mapPressed = await mapBtn.getAttribute("data-state").catch(() => "");
    console.log(`[DATA] List state: ${listPressed}, Hybrid state: ${hybridPressed}, Map state: ${mapPressed}`);

    await page.screenshot({ path: `${RESULTS_DIR}/04-view-toggle-default.png` });
  });

  test("switch to list view - map hides, listings show full width", async ({ page }) => {
    const listBtn = page.locator("[value='list']").first();
    if (await listBtn.isVisible().catch(() => false)) {
      await listBtn.click();
      await page.waitForTimeout(1500);

      // Check map is NOT visible
      const map = page.locator(".leaflet-container").first();
      const mapVisible = await map.isVisible().catch(() => false);
      console.log(`[CHECK] Map visible in list view: ${mapVisible}`);

      // Check listings are visible
      const listings = page.locator("article");
      const listingCount = await listings.count();
      console.log(`[DATA] Listings visible in list view: ${listingCount}`);

      // Check URL
      const url = page.url();
      console.log(`[CHECK] URL has view=list: ${url.includes("view=list")}`);

      // Check grid is multi-column (not constrained)
      await page.screenshot({ path: `${RESULTS_DIR}/04-view-list.png` });
    }
  });

  test("switch to map view - listings hide, map shows full width", async ({ page }) => {
    const mapBtn = page.locator("[value='map']").first();
    if (await mapBtn.isVisible().catch(() => false)) {
      await mapBtn.click();
      await page.waitForTimeout(2000);

      // Check map IS visible
      const map = page.locator(".leaflet-container").first();
      const mapVisible = await map.isVisible().catch(() => false);
      console.log(`[CHECK] Map visible in map view: ${mapVisible}`);

      // Check listings are NOT visible (no article elements)
      const listings = page.locator("article");
      const listingCount = await listings.count();
      console.log(`[DATA] Listings visible in map view: ${listingCount}`);

      // Check URL
      const url = page.url();
      console.log(`[CHECK] URL has view=map: ${url.includes("view=map")}`);

      await page.screenshot({ path: `${RESULTS_DIR}/04-view-map.png` });
    }
  });

  test("switch to hybrid view - both map and listings visible", async ({ page }) => {
    // First go to list, then to hybrid to ensure we test the transition
    const listBtn = page.locator("[value='list']").first();
    if (await listBtn.isVisible().catch(() => false)) {
      await listBtn.click();
      await page.waitForTimeout(1000);
    }

    const hybridBtn = page.locator("[value='hybrid']").first();
    if (await hybridBtn.isVisible().catch(() => false)) {
      await hybridBtn.click();
      await page.waitForTimeout(2000);

      // Both should be visible
      const map = page.locator(".leaflet-container").first();
      const mapVisible = await map.isVisible().catch(() => false);
      console.log(`[CHECK] Map visible in hybrid view: ${mapVisible}`);

      const listings = page.locator("article");
      const listingCount = await listings.count();
      console.log(`[DATA] Listings visible in hybrid view: ${listingCount}`);

      const url = page.url();
      console.log(`[CHECK] URL has view=hybrid: ${url.includes("view=hybrid")}`);

      await page.screenshot({ path: `${RESULTS_DIR}/04-view-hybrid.png` });
    }
  });
});
