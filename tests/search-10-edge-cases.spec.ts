import { test, expect } from "@playwright/test";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - Edge Cases", () => {
  test("search with impossible filters shows empty state", async ({ page }) => {
    await page.goto("/search?price_min=999999999&property_type=apartment&transaction_type=rent", {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(3000);

    const emptyState = page.locator("text=Žádné výsledky");
    const emptyVisible = await emptyState.isVisible().catch(() => false);
    console.log(`[CHECK] Empty state visible: ${emptyVisible}`);

    const helperText = page.locator("text=Zkuste upravit filtry");
    const helperVisible = await helperText.isVisible().catch(() => false);
    console.log(`[CHECK] Helper text visible: ${helperVisible}`);

    // Check there are no listing cards
    const cards = page.locator("article");
    const cardCount = await cards.count();
    console.log(`[DATA] Listing cards shown: ${cardCount}`);
    console.log(`[CHECK] No false results: ${cardCount === 0}`);

    await page.screenshot({ path: `${RESULTS_DIR}/10-edge-empty-state.png` });
  });

  test("very long listing titles truncate properly", async ({ page }) => {
    await page.goto("/search?view=list", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);

    const cards = page.locator("article");
    const count = await cards.count();

    let foundLongTitle = false;
    for (let i = 0; i < Math.min(count, 20); i++) {
      const title = cards.nth(i).locator("h3").first();
      const text = await title.textContent().catch(() => "");
      const box = await title.boundingBox().catch(() => null);

      if ((text?.length ?? 0) > 30) {
        console.log(`[DATA] Card ${i} title (${text?.length} chars): "${text?.substring(0, 60)}..."`);
        console.log(`[DATA] Card ${i} title box: w=${box?.width}, h=${box?.height}`);

        // Check for line-clamp class
        const cls = await title.getAttribute("class").catch(() => "");
        const hasClamp = cls?.includes("line-clamp");
        console.log(`[CHECK] Card ${i} has line-clamp: ${hasClamp}`);

        // Check that title doesn't overflow
        const cardBox = await cards.nth(i).boundingBox().catch(() => null);
        if (box && cardBox) {
          const overflows = box.width > cardBox.width;
          console.log(`[CHECK] Card ${i} title overflows card: ${overflows}`);
          if (overflows) {
            console.log(`[ISSUE] Title overflows: title width ${box.width} > card width ${cardBox.width}`);
          }
        }

        foundLongTitle = true;
        break;
      }
    }

    if (!foundLongTitle) {
      console.log("[WARN] No long titles found in first 20 cards to test truncation");
    }

    await page.screenshot({ path: `${RESULTS_DIR}/10-edge-long-titles.png` });
  });

  test("listings with no images show fallback", async ({ page }) => {
    await page.goto("/search?view=list", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);

    const cards = page.locator("article");
    const count = await cards.count();

    let noImageCards = 0;
    let fallbackWorking = 0;

    for (let i = 0; i < Math.min(count, 10); i++) {
      const img = cards.nth(i).locator("img").first();
      const src = await img.getAttribute("src").catch(() => "");

      if (src?.includes("picsum.photos")) {
        noImageCards++;
        console.log(`[DATA] Card ${i} uses fallback image: ${src?.substring(0, 60)}`);

        // Check image actually loaded
        const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth).catch(() => 0);
        if (naturalWidth > 0) {
          fallbackWorking++;
        }
      }
    }

    console.log(`[DATA] Cards using fallback images: ${noImageCards}/${Math.min(count, 10)}`);
    console.log(`[CHECK] Fallback images loading: ${fallbackWorking}/${noImageCards}`);

    // Check the PropertyCard onError handler
    console.log("[INFO] PropertyCard has onError handler that switches to fallback picsum image");

    await page.screenshot({ path: `${RESULTS_DIR}/10-edge-no-images.png` });
  });

  test("direct URL navigation with all filter params", async ({ page }) => {
    const fullUrl = "/search?transaction_type=rent&property_type=apartment&price_min=10000&price_max=30000&size_min=30&size_max=80&layout=2%2Bkk&sort=price_asc&view=list&page=1";

    await page.goto(fullUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    const url = page.url();
    console.log(`[DATA] Full URL: ${url}`);

    // Check filter chips show
    const chips = page.locator("[class*='badge'], [class*='Badge']");
    const chipCount = await chips.count();
    console.log(`[DATA] Active filter chips: ${chipCount}`);

    // Enumerate chips
    for (let i = 0; i < chipCount; i++) {
      const text = await chips.nth(i).textContent().catch(() => "");
      console.log(`  Chip ${i}: "${text}"`);
    }

    // Check count
    const countEl = page.locator("text=nabídek").first();
    const countText = await countEl.textContent().catch(() => "");
    console.log(`[DATA] Results count: ${countText}`);

    await page.screenshot({ path: `${RESULTS_DIR}/10-edge-full-url.png` });
  });

  test("detail modal for listing with no images", async ({ page }) => {
    await page.goto("/search?view=list", { waitUntil: "networkidle" });
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);

    // Click a listing and check the modal gallery fallback
    const firstCard = page.locator("article").first();
    if (await firstCard.isVisible()) {
      await firstCard.click();
      await page.waitForTimeout(3000);

      const dialog = page.locator("[role='dialog']").first();
      if (await dialog.isVisible()) {
        // Check for "Žádné fotky" fallback
        const noPhotos = dialog.locator("text=Žádné fotky");
        const noPhotosVisible = await noPhotos.isVisible().catch(() => false);
        console.log(`[CHECK] 'No photos' fallback in modal: ${noPhotosVisible}`);

        // Check for carousel
        const carousel = dialog.locator("[class*='carousel'], [class*='Carousel']");
        const carouselVisible = await carousel.isVisible().catch(() => false);
        console.log(`[CHECK] Carousel visible in modal: ${carouselVisible}`);

        // Count images
        const imgs = dialog.locator("img");
        const imgCount = await imgs.count();
        console.log(`[DATA] Images in modal: ${imgCount}`);

        await page.screenshot({ path: `${RESULTS_DIR}/10-edge-modal-images.png` });
      }

      await page.keyboard.press("Escape");
    }
  });

  test("map view with no results", async ({ page }) => {
    await page.goto("/search?view=map&price_min=999999999", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    const map = page.locator(".leaflet-container").first();
    const mapVisible = await map.isVisible().catch(() => false);
    console.log(`[CHECK] Map still renders with no results: ${mapVisible}`);

    const markers = await page.locator(".leaflet-marker-icon, .leaflet-interactive, .custom-marker-price").count();
    console.log(`[DATA] Markers on map with no results: ${markers}`);

    await page.screenshot({ path: `${RESULTS_DIR}/10-edge-map-no-results.png` });
  });

  test("tablet viewport (768x1024)", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/search", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    // Check sidebar visibility (md:block means visible at 768px)
    const sidebar = page.locator("aside").first();
    const sidebarVisible = await sidebar.isVisible().catch(() => false);
    console.log(`[CHECK] Sidebar visible on tablet (768px): ${sidebarVisible}`);

    // Check view toggle visibility
    const viewToggle = page.locator("[value='list']").first();
    const toggleVisible = await viewToggle.isVisible().catch(() => false);
    console.log(`[CHECK] View toggle visible on tablet: ${toggleVisible}`);

    // Check listing grid
    const cards = page.locator("article");
    const count = await cards.count();
    console.log(`[DATA] Cards on tablet: ${count}`);

    if (count >= 2) {
      const card1 = await cards.first().boundingBox();
      const card2 = await cards.nth(1).boundingBox();
      if (card1 && card2) {
        const sameRow = Math.abs(card1.y - card2.y) < 10;
        console.log(`[CHECK] Two-column grid on tablet: ${sameRow}`);
        console.log(`[DATA] Card 1: x=${card1.x}, y=${card1.y}, w=${card1.width}`);
        console.log(`[DATA] Card 2: x=${card2.x}, y=${card2.y}, w=${card2.width}`);
      }
    }

    await page.screenshot({ path: `${RESULTS_DIR}/10-edge-tablet.png`, fullPage: false });
  });

  test("wide desktop viewport (1920x1080)", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/search", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    const sidebar = page.locator("aside").first();
    const sidebarBox = await sidebar.boundingBox().catch(() => null);
    console.log(`[DATA] Sidebar dimensions on 1920px: ${JSON.stringify(sidebarBox)}`);

    const cards = page.locator("article");
    const count = await cards.count();
    console.log(`[DATA] Cards on wide desktop: ${count}`);

    // Check 3-column grid
    if (count >= 3) {
      const card1 = await cards.nth(0).boundingBox();
      const card2 = await cards.nth(1).boundingBox();
      const card3 = await cards.nth(2).boundingBox();
      if (card1 && card2 && card3) {
        const threeCol = Math.abs(card1.y - card2.y) < 10 && Math.abs(card2.y - card3.y) < 10;
        console.log(`[CHECK] Three-column grid on 1920px: ${threeCol}`);
      }
    }

    await page.screenshot({ path: `${RESULTS_DIR}/10-edge-wide-desktop.png`, fullPage: false });
  });
});
