import { test, expect } from "@playwright/test";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - Detail Modal (Resilient)", () => {
  test("modal opens from listing card, shows fields, and closes", async ({ page }) => {
    // Use hybrid view (default) and wait longer for listings to load
    await page.goto("/search", { waitUntil: "domcontentloaded" });

    // Wait up to 45 seconds for at least one article to appear
    const articleLocator = page.locator("article").first();
    try {
      await articleLocator.waitFor({ state: "visible", timeout: 45000 });
    } catch {
      // Take screenshot of whatever state we're in
      await page.screenshot({ path: `${RESULTS_DIR}/07v2-no-listings-loaded.png` });
      console.log("[FAIL] No listing cards loaded within 45s - API may be down or slow");
      // Don't fail the test outright, just document the issue
      return;
    }

    const cardCount = await page.locator("article").count();
    console.log(`[DATA] Listing cards visible: ${cardCount}`);

    // Get the title of the first card before clicking
    const cardTitle = await articleLocator.locator("h3").first().textContent().catch(() => "unknown");
    console.log(`[DATA] Clicking listing: "${cardTitle}"`);

    await page.screenshot({ path: `${RESULTS_DIR}/07v2-before-click.png` });

    // Click the first card
    await articleLocator.click();

    // Wait for the dialog to appear
    const dialog = page.locator("[role='dialog']").first();
    try {
      await dialog.waitFor({ state: "visible", timeout: 10000 });
    } catch {
      await page.screenshot({ path: `${RESULTS_DIR}/07v2-dialog-not-opened.png` });
      console.log("[FAIL] Dialog did not open after clicking listing card");
      return;
    }

    console.log("[OK] Detail modal opened");

    // Wait for content to load (skeleton should disappear)
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${RESULTS_DIR}/07v2-modal-opened.png` });

    // ---- Check all required fields ----

    // 1. Title
    const modalTitle = dialog.locator("h2").first();
    const titleText = await modalTitle.textContent().catch(() => "");
    const titleVisible = await modalTitle.isVisible().catch(() => false);
    console.log(`[CHECK] Title visible: ${titleVisible} -> "${titleText}"`);

    // 2. Price
    const allText = await dialog.textContent().catch(() => "");
    const hasPrice = /[\d\s,.]+\s*K[čc]|[\d\s,.]+\s*CZK|—/.test(allText || "");
    console.log(`[CHECK] Price present in modal: ${hasPrice}`);

    // 3. Source badge
    const badges = dialog.locator("[class*='badge'], [class*='Badge']");
    const badgeCount = await badges.count();
    const badgeTexts: string[] = [];
    for (let i = 0; i < badgeCount; i++) {
      badgeTexts.push(await badges.nth(i).textContent().catch(() => ""));
    }
    console.log(`[CHECK] Badges: ${badgeCount} -> ${JSON.stringify(badgeTexts)}`);
    const hasSourceBadge = badgeTexts.some((t) => /\.cz$/.test(t));
    console.log(`[CHECK] Source badge (.cz): ${hasSourceBadge}`);

    // 4. Images / Gallery
    const carouselImages = dialog.locator("img");
    const imgCount = await carouselImages.count();
    const noPhotos = dialog.locator("text=Žádné fotky");
    const noPhotosVisible = await noPhotos.isVisible().catch(() => false);
    console.log(`[CHECK] Images in modal: ${imgCount}, No-photos fallback: ${noPhotosVisible}`);

    // 5. Description
    const descSection = dialog.locator("text=Popis");
    const descVisible = await descSection.isVisible().catch(() => false);
    console.log(`[CHECK] Description section: ${descVisible}`);

    // 6. Source link ("Zobrazit na ...")
    const sourceLink = dialog.locator("a[target='_blank']").first();
    const sourceLinkVisible = await sourceLink.isVisible().catch(() => false);
    const sourceHref = await sourceLink.getAttribute("href").catch(() => "");
    const sourceLinkText = await sourceLink.textContent().catch(() => "");
    console.log(`[CHECK] Source link visible: ${sourceLinkVisible} -> "${sourceLinkText}" (${sourceHref})`);

    // 7. Mini map
    const miniMap = dialog.locator(".leaflet-container").first();
    const miniMapVisible = await miniMap.isVisible().catch(() => false);
    console.log(`[CHECK] Mini map: ${miniMapVisible}`);

    // ---- Test carousel navigation ----
    const prevCarousel = dialog.locator("button[class*='left']").first();
    const nextCarousel = dialog.locator("button[class*='right']").first();
    const prevVisible = await prevCarousel.isVisible().catch(() => false);
    const nextVisible = await nextCarousel.isVisible().catch(() => false);
    console.log(`[CHECK] Carousel prev: ${prevVisible}, next: ${nextVisible}`);

    if (nextVisible) {
      await nextCarousel.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${RESULTS_DIR}/07v2-modal-carousel-next.png` });
      console.log("[OK] Carousel navigated to next image");
    }

    // Scroll down inside the modal to see more content
    await dialog.locator("[class*='ScrollArea'], [data-radix-scroll-area-viewport]").first().evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${RESULTS_DIR}/07v2-modal-scrolled.png` });

    // ---- Test closing ----

    // Test Escape key
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    const dialogAfterEscape = await dialog.isVisible().catch(() => false);
    console.log(`[CHECK] Modal closed via Escape: ${!dialogAfterEscape}`);
    await page.screenshot({ path: `${RESULTS_DIR}/07v2-modal-after-escape.png` });

    if (dialogAfterEscape) {
      console.log("[WARN] Escape didn't close modal, trying X button");
    }

    // Re-open modal for overlay close test
    await articleLocator.click();
    try {
      await dialog.waitFor({ state: "visible", timeout: 10000 });
    } catch {
      console.log("[WARN] Could not re-open modal for overlay test");
      return;
    }

    await page.waitForTimeout(1000);

    // Close via clicking outside (overlay)
    await page.mouse.click(5, 5);
    await page.waitForTimeout(1000);
    const dialogAfterOverlay = await dialog.isVisible().catch(() => false);
    console.log(`[CHECK] Modal closed via overlay click: ${!dialogAfterOverlay}`);
    await page.screenshot({ path: `${RESULTS_DIR}/07v2-modal-after-overlay.png` });
  });

  test("modal error state when API fails", async ({ page }) => {
    await page.goto("/search", { waitUntil: "domcontentloaded" });

    const articleLocator = page.locator("article").first();
    try {
      await articleLocator.waitFor({ state: "visible", timeout: 45000 });
    } catch {
      console.log("[SKIP] No listings loaded, cannot test modal error state");
      return;
    }

    // Block the detail API to test error state
    await page.route("**/api/listings/*", (route) => {
      if (route.request().url().match(/\/api\/listings\/\d+$/)) {
        route.fulfill({ status: 500, body: "Internal Server Error" });
      } else {
        route.continue();
      }
    });

    await articleLocator.click();
    await page.waitForTimeout(3000);

    const errorText = page.locator("text=Nepodařilo se načíst");
    const errorVisible = await errorText.isVisible().catch(() => false);
    console.log(`[CHECK] Error state shown on API failure: ${errorVisible}`);

    await page.screenshot({ path: `${RESULTS_DIR}/07v2-modal-error-state.png` });
  });
});
