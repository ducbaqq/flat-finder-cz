import { test, expect } from "@playwright/test";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - Listing Results", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/search", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);
  });

  test("listing cards are displayed with correct data", async ({ page }) => {
    const cards = page.locator("article");
    const count = await cards.count();
    console.log(`[DATA] Total listing cards displayed: ${count}`);

    expect(count).toBeGreaterThan(0);

    // Inspect first card contents
    if (count > 0) {
      const firstCard = cards.first();

      // Check for image
      const img = firstCard.locator("img").first();
      const imgSrc = await img.getAttribute("src").catch(() => null);
      console.log(`[DATA] First card image src: ${imgSrc?.substring(0, 80)}...`);

      // Check for title (h3)
      const title = firstCard.locator("h3").first();
      const titleText = await title.textContent().catch(() => null);
      console.log(`[DATA] First card title: ${titleText}`);

      // Check for price
      const priceEl = firstCard.locator("[class*='font-bold']").first();
      const priceText = await priceEl.textContent().catch(() => null);
      console.log(`[DATA] First card price: ${priceText}`);

      // Check for address/city
      const addressEl = firstCard.locator("[class*='line-clamp']").last();
      const addressText = await addressEl.textContent().catch(() => null);
      console.log(`[DATA] First card address: ${addressText}`);

      // Check for source badge
      const sourceBadge = firstCard.locator("[class*='badge'], [class*='Badge']").first();
      const sourceText = await sourceBadge.textContent().catch(() => null);
      console.log(`[DATA] First card source: ${sourceText}`);

      await page.screenshot({ path: `${RESULTS_DIR}/03-listing-card-detail.png` });
    }
  });

  test("loading skeletons are shown during fetch", async ({ page }) => {
    // Navigate with a fresh page to catch skeletons
    const freshPage = page;
    await freshPage.goto("/search");

    // Immediately look for skeleton elements before data loads
    const skeletons = freshPage.locator("[class*='skeleton'], [class*='Skeleton'], [class*='animate-pulse']");
    // Take screenshot as fast as possible
    await freshPage.screenshot({ path: `${RESULTS_DIR}/03-loading-skeletons.png` });

    const skeletonCount = await skeletons.count().catch(() => 0);
    console.log(`[CHECK] Skeleton elements found during load: ${skeletonCount}`);
  });

  test("pagination exists and works", async ({ page }) => {
    // Check pagination controls
    const prevBtn = page.locator("button:has-text('Předchozí')").first();
    const nextBtn = page.locator("button:has-text('Další')").first();

    const prevVisible = await prevBtn.isVisible().catch(() => false);
    const nextVisible = await nextBtn.isVisible().catch(() => false);

    console.log(`[CHECK] 'Předchozí' (Previous) button visible: ${prevVisible}`);
    console.log(`[CHECK] 'Další' (Next) button visible: ${nextVisible}`);

    // Check page indicator
    const pageIndicator = page.locator("text=/\\d+ \\/ \\d+/").first();
    const pageText = await pageIndicator.textContent().catch(() => null);
    console.log(`[DATA] Page indicator: ${pageText}`);

    await page.screenshot({ path: `${RESULTS_DIR}/03-pagination-page1.png` });

    if (nextVisible) {
      // Check Previous is disabled on page 1
      const prevDisabled = await prevBtn.isDisabled().catch(() => false);
      console.log(`[CHECK] Previous button disabled on page 1: ${prevDisabled}`);

      // Click next page
      await nextBtn.click();
      await page.waitForTimeout(2000);
      await page.waitForLoadState("networkidle");

      const url = page.url();
      console.log(`[CHECK] URL after next page: ${url}`);
      console.log(`[CHECK] URL has page=2: ${url.includes("page=2")}`);

      const pageTextAfter = await pageIndicator.textContent().catch(() => null);
      console.log(`[DATA] Page indicator after next: ${pageTextAfter}`);

      await page.screenshot({ path: `${RESULTS_DIR}/03-pagination-page2.png` });

      // Now go back
      const prevBtnAfter = page.locator("button:has-text('Předchozí')").first();
      const prevEnabled = !(await prevBtnAfter.isDisabled().catch(() => true));
      console.log(`[CHECK] Previous button enabled on page 2: ${prevEnabled}`);

      if (prevEnabled) {
        await prevBtnAfter.click();
        await page.waitForTimeout(2000);
        await page.waitForLoadState("networkidle");

        const urlBack = page.url();
        console.log(`[CHECK] URL after going back: ${urlBack}`);
      }
    }
  });

  test("sort dropdown works", async ({ page }) => {
    // Find the sort select
    const sortTrigger = page.locator("[class*='SelectTrigger'], button:has-text('Nejnovější'), [role='combobox']").first();
    const sortVisible = await sortTrigger.isVisible().catch(() => false);
    console.log(`[CHECK] Sort select visible: ${sortVisible}`);

    const sortText = await sortTrigger.textContent().catch(() => null);
    console.log(`[DATA] Sort default value: ${sortText}`);

    await page.screenshot({ path: `${RESULTS_DIR}/03-sort-before.png` });

    if (sortVisible) {
      await sortTrigger.click();
      await page.waitForTimeout(500);

      // Screenshot the dropdown open
      await page.screenshot({ path: `${RESULTS_DIR}/03-sort-dropdown-open.png` });

      // Check available options
      const options = page.locator("[role='option']");
      const optionCount = await options.count();
      console.log(`[DATA] Sort options count: ${optionCount}`);

      for (let i = 0; i < optionCount; i++) {
        const optText = await options.nth(i).textContent().catch(() => "");
        console.log(`  Option ${i}: ${optText}`);
      }

      // Select "Cena up" (price ascending)
      const priceAsc = page.locator("[role='option']:has-text('Cena')").first();
      if (await priceAsc.isVisible().catch(() => false)) {
        await priceAsc.click();
        await page.waitForTimeout(2000);
        await page.waitForLoadState("networkidle");

        const url = page.url();
        console.log(`[CHECK] URL after sort change: ${url}`);
        console.log(`[CHECK] URL has sort param: ${url.includes("sort=")}`);

        await page.screenshot({ path: `${RESULTS_DIR}/03-sort-price-asc.png` });
      }
    }
  });

  test("clicking listing opens detail modal", async ({ page }) => {
    const firstCard = page.locator("article").first();
    const cardVisible = await firstCard.isVisible().catch(() => false);

    if (cardVisible) {
      const titleBefore = await firstCard.locator("h3").first().textContent().catch(() => "");
      console.log(`[DATA] Clicking card with title: ${titleBefore}`);

      await firstCard.click();
      await page.waitForTimeout(2000);

      // Check for dialog/modal
      const dialog = page.locator("[role='dialog']").first();
      const dialogVisible = await dialog.isVisible().catch(() => false);
      console.log(`[CHECK] Detail modal opened: ${dialogVisible}`);

      await page.screenshot({ path: `${RESULTS_DIR}/03-detail-modal-opened.png` });

      if (dialogVisible) {
        // Check modal contents
        const modalTitle = dialog.locator("h2").first();
        const modalTitleText = await modalTitle.textContent().catch(() => null);
        console.log(`[DATA] Modal title: ${modalTitleText}`);

        // Check for price
        const price = dialog.locator("[class*='font-bold'], [class*='text-primary']").first();
        const priceText = await price.textContent().catch(() => null);
        console.log(`[DATA] Modal price: ${priceText}`);

        // Check for image gallery
        const images = dialog.locator("img");
        const imageCount = await images.count();
        console.log(`[DATA] Modal images: ${imageCount}`);

        // Check for source link
        const sourceLink = dialog.locator("a[target='_blank']").first();
        const sourceLinkVisible = await sourceLink.isVisible().catch(() => false);
        console.log(`[CHECK] 'View original' link visible: ${sourceLinkVisible}`);
        if (sourceLinkVisible) {
          const href = await sourceLink.getAttribute("href").catch(() => null);
          console.log(`[DATA] Source link href: ${href}`);
        }

        // Check for description
        const desc = dialog.locator("text=Popis").first();
        const descVisible = await desc.isVisible().catch(() => false);
        console.log(`[CHECK] Description section visible: ${descVisible}`);

        // Check for address
        const addressEl = dialog.locator("[class*='muted-foreground']").filter({ hasText: /Praha|Brno|,/ }).first();
        const address = await addressEl.textContent().catch(() => null);
        console.log(`[DATA] Modal address: ${address}`);
      }
    }
  });

  test("empty state shown for no-results filter", async ({ page }) => {
    // Apply extreme price filter that should return 0 results
    await page.goto("/search?price_min=999999999&price_max=999999999", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    // Check for empty state
    const emptyState = page.locator("text=Žádné výsledky").first();
    const emptyVisible = await emptyState.isVisible().catch(() => false);
    console.log(`[CHECK] Empty state 'Žádné výsledky' visible: ${emptyVisible}`);

    // Check for the helper text
    const helperText = page.locator("text=Zkuste upravit filtry").first();
    const helperVisible = await helperText.isVisible().catch(() => false);
    console.log(`[CHECK] Helper text visible: ${helperVisible}`);

    // Check for the SearchX icon
    const icon = page.locator("svg").first();
    console.log(`[CHECK] Icon element present: ${await icon.isVisible().catch(() => false)}`);

    await page.screenshot({ path: `${RESULTS_DIR}/03-empty-state.png` });
  });
});
