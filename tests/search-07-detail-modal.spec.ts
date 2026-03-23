import { test, expect } from "@playwright/test";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - Detail Modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/search?view=list", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);
  });

  test("modal shows all required fields", async ({ page }) => {
    const firstCard = page.locator("article").first();
    await firstCard.click();
    await page.waitForTimeout(3000);

    const dialog = page.locator("[role='dialog']").first();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: `${RESULTS_DIR}/07-modal-full.png` });

    // Check each required field
    const checks: Record<string, boolean> = {};

    // Title (h2)
    const title = dialog.locator("h2").first();
    checks["title"] = await title.isVisible().catch(() => false);
    const titleText = await title.textContent().catch(() => "");
    console.log(`[CHECK] Title: ${checks["title"]} -> "${titleText}"`);

    // Price
    const price = dialog.locator("[class*='text-primary'][class*='font-bold'], [class*='font-bold'][class*='text-primary']").first();
    checks["price"] = await price.isVisible().catch(() => false);
    const priceText = await price.textContent().catch(() => "");
    console.log(`[CHECK] Price: ${checks["price"]} -> "${priceText}"`);

    // Images/Gallery
    const carousel = dialog.locator("[class*='carousel'], [class*='Carousel']").first();
    const imgFallback = dialog.locator("text=Žádné fotky").first();
    const hasGallery = await carousel.isVisible().catch(() => false);
    const hasNoPhotos = await imgFallback.isVisible().catch(() => false);
    checks["images"] = hasGallery || hasNoPhotos;
    console.log(`[CHECK] Image gallery: ${hasGallery}, No-photos fallback: ${hasNoPhotos}`);

    // Description
    const desc = dialog.locator("text=Popis").first();
    checks["description"] = await desc.isVisible().catch(() => false);
    console.log(`[CHECK] Description section: ${checks["description"]}`);

    // Address
    const addressIcon = dialog.locator("svg").filter({ has: page.locator("[class*='MapPin'], path") });
    // Look for text near MapPin icon
    const addressArea = dialog.locator("[class*='muted-foreground']");
    const addressCount = await addressArea.count();
    console.log(`[DATA] Muted foreground elements in modal: ${addressCount}`);

    // Source badge
    const sourceBadge = dialog.locator("[class*='badge'], [class*='Badge']").first();
    checks["source_badge"] = await sourceBadge.isVisible().catch(() => false);
    const sourceText = await sourceBadge.textContent().catch(() => "");
    console.log(`[CHECK] Source badge: ${checks["source_badge"]} -> "${sourceText}"`);

    // View original link
    const viewOriginal = dialog.locator("a[target='_blank']").first();
    checks["source_link"] = await viewOriginal.isVisible().catch(() => false);
    const linkText = await viewOriginal.textContent().catch(() => "");
    const linkHref = await viewOriginal.getAttribute("href").catch(() => "");
    console.log(`[CHECK] Source link: ${checks["source_link"]} -> "${linkText}" (${linkHref})`);

    // Specs (DetailSpecs component)
    const specsSection = dialog.locator("[class*='grid']");
    const specsCount = await specsSection.count();
    console.log(`[DATA] Grid sections in modal (specs area): ${specsCount}`);

    // Mini map
    const miniMap = dialog.locator(".leaflet-container").first();
    checks["mini_map"] = await miniMap.isVisible().catch(() => false);
    console.log(`[CHECK] Mini map: ${checks["mini_map"]}`);

    // Summary
    const passed = Object.values(checks).filter((v) => v).length;
    const total = Object.keys(checks).length;
    console.log(`\n[SUMMARY] Modal field checks: ${passed}/${total} passed`);
    Object.entries(checks).forEach(([k, v]) => {
      console.log(`  ${v ? "PASS" : "FAIL"}: ${k}`);
    });
  });

  test("image gallery carousel works (next/prev)", async ({ page }) => {
    const firstCard = page.locator("article").first();
    await firstCard.click();
    await page.waitForTimeout(3000);

    const dialog = page.locator("[role='dialog']").first();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Check carousel buttons
    const prevBtn = dialog.locator("button[class*='CarouselPrevious'], button:has(svg[class*='lucide-chevron-left']), button:has(svg):near(:text(''))").first();
    const nextBtn = dialog.locator("button[class*='CarouselNext'], button:has(svg[class*='lucide-chevron-right'])").first();

    // Look for carousel nav buttons more generically
    const carouselBtns = dialog.locator("button").filter({ has: page.locator("svg") });
    const carouselBtnCount = await carouselBtns.count();
    console.log(`[DATA] Buttons with SVG icons in modal: ${carouselBtnCount}`);

    // Try to find carousel prev/next specifically
    const prevCarousel = dialog.locator("button[class*='left']").first();
    const nextCarousel = dialog.locator("button[class*='right']").first();

    const prevVisible = await prevCarousel.isVisible().catch(() => false);
    const nextVisible = await nextCarousel.isVisible().catch(() => false);
    console.log(`[CHECK] Carousel prev button (left): ${prevVisible}`);
    console.log(`[CHECK] Carousel next button (right): ${nextVisible}`);

    await page.screenshot({ path: `${RESULTS_DIR}/07-modal-gallery-initial.png` });

    if (nextVisible) {
      await nextCarousel.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${RESULTS_DIR}/07-modal-gallery-next.png` });
      console.log("[OK] Carousel next clicked");
    }
  });

  test("modal closes with X button", async ({ page }) => {
    const firstCard = page.locator("article").first();
    await firstCard.click();
    await page.waitForTimeout(2000);

    const dialog = page.locator("[role='dialog']").first();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Find close button
    const closeBtn = page.locator("[role='dialog'] button[class*='close'], button:has(svg[class*='x']), [role='dialog'] button:has(svg.lucide-x)").first();
    const closeBtnAlt = page.locator("button[class*='DialogClose'], button.absolute.right-4.top-4, button[class*='right-']").first();

    let closeFound = false;
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      closeFound = true;
    } else if (await closeBtnAlt.isVisible().catch(() => false)) {
      await closeBtnAlt.click();
      closeFound = true;
    } else {
      // Try generic approach - find all buttons in dialog overlay area
      const dialogOverlay = page.locator("[data-state='open']");
      const allButtons = dialogOverlay.locator("button");
      const btnCount = await allButtons.count();
      console.log(`[DATA] Buttons in dialog area: ${btnCount}`);

      // The close button is usually the first button in the dialog content
      for (let i = 0; i < btnCount; i++) {
        const btn = allButtons.nth(i);
        const text = await btn.textContent().catch(() => "");
        const cls = await btn.getAttribute("class").catch(() => "");
        console.log(`  Button ${i}: text="${text?.trim()}", class="${cls?.substring(0, 60)}"`);
      }
    }

    await page.waitForTimeout(1000);
    const dialogStillVisible = await dialog.isVisible().catch(() => false);
    console.log(`[CHECK] Dialog closed via X button: ${!dialogStillVisible} (close button found: ${closeFound})`);

    await page.screenshot({ path: `${RESULTS_DIR}/07-modal-closed-x.png` });
  });

  test("modal closes with Escape key", async ({ page }) => {
    const firstCard = page.locator("article").first();
    await firstCard.click();
    await page.waitForTimeout(2000);

    const dialog = page.locator("[role='dialog']").first();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    console.log("[ACTION] Pressing Escape key");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    const dialogVisible = await dialog.isVisible().catch(() => false);
    console.log(`[CHECK] Dialog closed via Escape: ${!dialogVisible}`);

    await page.screenshot({ path: `${RESULTS_DIR}/07-modal-closed-escape.png` });
    expect(dialogVisible).toBeFalsy();
  });

  test("modal closes when clicking overlay", async ({ page }) => {
    const firstCard = page.locator("article").first();
    await firstCard.click();
    await page.waitForTimeout(2000);

    const dialog = page.locator("[role='dialog']").first();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click the overlay (outside the dialog content)
    const overlay = page.locator("[data-state='open'][class*='DialogOverlay'], [data-state='open'][class*='overlay'], div[class*='fixed'][class*='inset']").first();
    const overlayVisible = await overlay.isVisible().catch(() => false);
    console.log(`[CHECK] Overlay element found: ${overlayVisible}`);

    if (overlayVisible) {
      // Click top-left corner which should be overlay
      await overlay.click({ position: { x: 10, y: 10 }, force: true });
    } else {
      // Click at top-left of viewport
      await page.mouse.click(10, 10);
    }

    await page.waitForTimeout(1000);
    const dialogVisible = await dialog.isVisible().catch(() => false);
    console.log(`[CHECK] Dialog closed via overlay click: ${!dialogVisible}`);

    await page.screenshot({ path: `${RESULTS_DIR}/07-modal-closed-overlay.png` });
  });

  test("loading skeleton shown while detail loads", async ({ page }) => {
    // This is hard to catch, but we can try
    const firstCard = page.locator("article").first();

    // Set up a promise to screenshot immediately after click
    const clickPromise = firstCard.click();

    // Wait just a tiny bit
    await page.waitForTimeout(200);

    const skeleton = page.locator("[role='dialog'] [class*='skeleton'], [role='dialog'] [class*='Skeleton']");
    const skeletonCount = await skeleton.count().catch(() => 0);
    console.log(`[CHECK] Skeleton elements in modal during load: ${skeletonCount}`);

    await page.screenshot({ path: `${RESULTS_DIR}/07-modal-loading.png` });
  });
});
