import { test, expect } from "@playwright/test";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - Mobile Responsive (375x812)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/search", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
  });

  test("mobile layout renders correctly", async ({ page }) => {
    await page.screenshot({ path: `${RESULTS_DIR}/08-mobile-initial.png`, fullPage: false });

    // Sidebar should be hidden on mobile
    const sidebar = page.locator("aside").first();
    const sidebarVisible = await sidebar.isVisible().catch(() => false);
    console.log(`[CHECK] Desktop sidebar hidden on mobile: ${!sidebarVisible}`);
    expect(sidebarVisible).toBeFalsy();

    // Listings should exist
    const listings = page.locator("article");
    const listingCount = await listings.count();
    console.log(`[DATA] Listings on mobile: ${listingCount}`);

    // Check single column layout
    if (listingCount >= 2) {
      const card1 = await listings.first().boundingBox();
      const card2 = await listings.nth(1).boundingBox();
      if (card1 && card2) {
        const isSingleColumn = card2.y > card1.y + card1.height - 10;
        console.log(`[CHECK] Single column layout: ${isSingleColumn}`);
        console.log(`[DATA] Card 1: x=${card1.x}, y=${card1.y}, w=${card1.width}`);
        console.log(`[DATA] Card 2: x=${card2.x}, y=${card2.y}, w=${card2.width}`);
      }
    }

    await page.screenshot({ path: `${RESULTS_DIR}/08-mobile-layout.png`, fullPage: true });
  });

  test("filter sheet button visible and works on mobile", async ({ page }) => {
    // Look for the mobile filter button ("Filtry")
    const filterBtn = page.locator("button:has-text('Filtry')").first();
    const filterBtnVisible = await filterBtn.isVisible().catch(() => false);
    console.log(`[CHECK] Mobile 'Filtry' button visible: ${filterBtnVisible}`);

    await page.screenshot({ path: `${RESULTS_DIR}/08-mobile-filter-btn.png` });

    if (filterBtnVisible) {
      await filterBtn.click();
      await page.waitForTimeout(1000);

      // Check sheet opened
      const sheet = page.locator("[role='dialog'], [data-state='open']").first();
      const sheetVisible = await sheet.isVisible().catch(() => false);
      console.log(`[CHECK] Filter sheet opened: ${sheetVisible}`);

      // Check filter content inside sheet
      const sheetTitle = page.locator("text=Filtry").first();
      const hasTxToggle = page.locator("text=Pronájem").first();
      const hasLocation = page.locator("text=Lokalita").first();
      const hasPrice = page.locator("text=Cena").first();

      console.log(`[CHECK] Sheet title: ${await sheetTitle.isVisible().catch(() => false)}`);
      console.log(`[CHECK] Transaction toggle: ${await hasTxToggle.isVisible().catch(() => false)}`);
      console.log(`[CHECK] Location filter: ${await hasLocation.isVisible().catch(() => false)}`);
      console.log(`[CHECK] Price filter: ${await hasPrice.isVisible().catch(() => false)}`);

      await page.screenshot({ path: `${RESULTS_DIR}/08-mobile-filter-sheet-open.png`, fullPage: true });

      // Try using a filter in the sheet
      const rentBtn = page.locator("text=Pronájem").first();
      if (await rentBtn.isVisible()) {
        await rentBtn.click();
        await page.waitForTimeout(1000);
        console.log("[OK] Applied rent filter in mobile sheet");
      }

      // Close sheet by clicking overlay or pressing Escape
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      await page.screenshot({ path: `${RESULTS_DIR}/08-mobile-after-filter.png` });
    }
  });

  test("mobile bottom navigation is visible", async ({ page }) => {
    // MobileBottomNav component
    const bottomNav = page.locator("nav[class*='fixed'], nav[class*='bottom'], [class*='bottom-nav'], [class*='MobileBottomNav']").first();
    const bottomNavAlt = page.locator("nav").last();

    const navVisible = await bottomNav.isVisible().catch(() => false);
    const navAltVisible = await bottomNavAlt.isVisible().catch(() => false);
    console.log(`[CHECK] Bottom nav visible (specific): ${navVisible}`);
    console.log(`[CHECK] Last nav element visible: ${navAltVisible}`);

    // Look for it at the bottom of the viewport
    const allNavs = page.locator("nav");
    const navCount = await allNavs.count();
    console.log(`[DATA] Total nav elements: ${navCount}`);

    for (let i = 0; i < navCount; i++) {
      const nav = allNavs.nth(i);
      const box = await nav.boundingBox().catch(() => null);
      const text = await nav.textContent().catch(() => "");
      console.log(`  Nav ${i}: bounds=${JSON.stringify(box)}, text="${text?.substring(0, 50)}"`);
    }

    // Scroll to bottom to see bottom nav
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${RESULTS_DIR}/08-mobile-bottom-nav.png` });
  });

  test("view toggle hidden on mobile", async ({ page }) => {
    // View toggle has "hidden sm:flex" so should be hidden on 375px
    const toggleGroup = page.locator("[role='group'][class*='hidden']").first();
    const toggleVisible = await page.locator("[value='list']").first().isVisible().catch(() => false);
    console.log(`[CHECK] View toggle buttons visible on mobile: ${toggleVisible}`);
    // Should be hidden
    console.log(`[CHECK] View toggle correctly hidden on mobile: ${!toggleVisible}`);

    await page.screenshot({ path: `${RESULTS_DIR}/08-mobile-no-view-toggle.png` });
  });

  test("quick filter chips hidden on mobile", async ({ page }) => {
    // Quick filters have "hidden sm:flex"
    const vseBtn = page.locator("button:has-text('Vše')").first();
    const bytyBtn = page.locator("button:has-text('Byty')").first();
    const vseVisible = await vseBtn.isVisible().catch(() => false);
    const bytyVisible = await bytyBtn.isVisible().catch(() => false);

    console.log(`[CHECK] 'Vše' quick filter visible on mobile: ${vseVisible}`);
    console.log(`[CHECK] 'Byty' quick filter visible on mobile: ${bytyVisible}`);
    console.log(`[CHECK] Quick filters correctly hidden on mobile: ${!vseVisible && !bytyVisible}`);
  });

  test("listing cards look correct on mobile", async ({ page }) => {
    const cards = page.locator("article");
    const count = await cards.count();

    if (count > 0) {
      const firstCard = cards.first();
      const box = await firstCard.boundingBox();
      console.log(`[DATA] First card dimensions: w=${box?.width}, h=${box?.height}`);
      console.log(`[CHECK] Card fills mobile width: ${(box?.width ?? 0) > 330}`);

      // Check card image
      const img = firstCard.locator("img").first();
      const imgBox = await img.boundingBox().catch(() => null);
      console.log(`[DATA] Card image dimensions: w=${imgBox?.width}, h=${imgBox?.height}`);

      await page.screenshot({ path: `${RESULTS_DIR}/08-mobile-card.png` });
    }
  });

  test("sort select works on mobile", async ({ page }) => {
    const sortTrigger = page.locator("[role='combobox']").first();
    const sortVisible = await sortTrigger.isVisible().catch(() => false);
    console.log(`[CHECK] Sort select visible on mobile: ${sortVisible}`);

    if (sortVisible) {
      await sortTrigger.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${RESULTS_DIR}/08-mobile-sort-open.png` });

      // Select an option
      const option = page.locator("[role='option']").first();
      if (await option.isVisible()) {
        await option.click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test("detail modal works on mobile", async ({ page }) => {
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);

    const firstCard = page.locator("article").first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.click();
      await page.waitForTimeout(3000);

      const dialog = page.locator("[role='dialog']").first();
      const dialogVisible = await dialog.isVisible().catch(() => false);
      console.log(`[CHECK] Detail modal opens on mobile: ${dialogVisible}`);

      if (dialogVisible) {
        const box = await dialog.locator("[class*='DialogContent']").first().boundingBox().catch(() => null);
        console.log(`[DATA] Modal dimensions on mobile: ${JSON.stringify(box)}`);
      }

      await page.screenshot({ path: `${RESULTS_DIR}/08-mobile-modal.png` });

      // Close it
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    }
  });
});
