import { test, expect, type ConsoleMessage } from "@playwright/test";

const R = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - Final Evidence Capture", () => {
  test("01 - Desktop page load + layout + console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(`PAGE ERROR: ${err.message}`));

    const start = Date.now();
    await page.goto("/search", { waitUntil: "domcontentloaded" });

    // Wait for content
    await page.waitForSelector("article", { timeout: 45000 }).catch(() => {});
    const loadTime = Date.now() - start;

    console.log(`[PERF] Time to first listing: ${loadTime}ms`);
    console.log(`[ERRORS] Console errors: ${errors.length}`);
    errors.forEach((e) => console.log(`  ERROR: ${e}`));

    // Check all major sections
    const navbar = await page.locator("nav").first().isVisible().catch(() => false);
    const sidebar = await page.locator("aside").first().isVisible().catch(() => false);
    const listings = await page.locator("article").count().catch(() => 0);
    const map = await page.locator(".leaflet-container").first().isVisible().catch(() => false);
    const total = await page.locator("text=nabídek").first().textContent().catch(() => "?");

    console.log(`[LAYOUT] Navbar: ${navbar}, Sidebar: ${sidebar}, Listings: ${listings}, Map: ${map}`);
    console.log(`[DATA] Total: ${total}`);

    await page.screenshot({ path: `${R}/final-01-desktop-layout.png`, fullPage: false });
    await page.screenshot({ path: `${R}/final-01-desktop-full.png`, fullPage: true });
  });

  test("02 - Filter sidebar with all sections", async ({ page }) => {
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("aside", { timeout: 30000 }).catch(() => {});

    // Expand all accordions
    const sidebar = page.locator("aside").first();
    const triggers = sidebar.locator("button[data-state]");
    const triggerCount = await triggers.count();
    for (let i = 0; i < triggerCount; i++) {
      await triggers.nth(i).click().catch(() => {});
      await page.waitForTimeout(200);
    }

    await page.screenshot({ path: `${R}/final-02-sidebar-expanded.png`, fullPage: true });

    // Test transaction type
    const rentBtn = sidebar.locator("text=Pronájem").first();
    if (await rentBtn.isVisible().catch(() => false)) {
      await rentBtn.click();
      await page.waitForTimeout(2000);

      const url = page.url();
      const countText = await page.locator("text=nabídek").first().textContent().catch(() => "?");
      console.log(`[FILTER] After rent: URL=${url}, Count=${countText}`);

      // BUG: Count goes to 0 when selecting Pronajem
      const count = parseInt((countText || "0").replace(/\D/g, ""));
      console.log(`[CHECK] Rent filter count: ${count} (should be > 0 if data exists for rent)`);

      await page.screenshot({ path: `${R}/final-02-filter-rent.png` });
    }
  });

  test("03 - Property type filters + filter chips", async ({ page }) => {
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 45000 }).catch(() => {});

    const initialCount = await page.locator("text=nabídek").first().textContent().catch(() => "?");
    console.log(`[DATA] Initial count: ${initialCount}`);

    // Click Byty
    const bytyBtn = page.locator("button:has-text('Byty')").first();
    if (await bytyBtn.isVisible()) {
      await bytyBtn.click();
      await page.waitForTimeout(2000);
      const afterByty = await page.locator("text=nabídek").first().textContent().catch(() => "?");
      console.log(`[DATA] After Byty: ${afterByty} (URL: ${page.url()})`);
      await page.screenshot({ path: `${R}/final-03-filter-byty.png` });
    }

    // Check chips
    const clearBtn = page.locator("text=Vymazat vše").first();
    const chipsVisible = await clearBtn.isVisible().catch(() => false);
    console.log(`[CHECK] Active filter chips + clear button: ${chipsVisible}`);
    await page.screenshot({ path: `${R}/final-03-filter-chips.png` });

    // Clear filters
    if (chipsVisible) {
      await clearBtn.click();
      await page.waitForTimeout(2000);
      const afterClear = await page.locator("text=nabídek").first().textContent().catch(() => "?");
      console.log(`[DATA] After clear: ${afterClear} (URL: ${page.url()})`);
    }
  });

  test("04 - Price filter interaction", async ({ page }) => {
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("aside", { timeout: 30000 }).catch(() => {});

    const sidebar = page.locator("aside").first();
    const inputs = sidebar.locator("input");
    const count = await inputs.count();

    console.log(`[DATA] Sidebar inputs:`);
    for (let i = 0; i < count; i++) {
      const ph = await inputs.nth(i).getAttribute("placeholder").catch(() => "?");
      const type = await inputs.nth(i).getAttribute("type").catch(() => "?");
      console.log(`  Input ${i}: type=${type}, placeholder="${ph}"`);
    }

    // BUG: First input is location, filling it sets location not price_min
    // Input 0: location, Input 1: price min, Input 2: price max, Input 3: size min, Input 4: size max
    const priceMinInput = inputs.nth(1);
    await priceMinInput.click();
    await priceMinInput.fill("5000000");
    await priceMinInput.press("Tab");
    await page.waitForTimeout(2000);

    const url = page.url();
    console.log(`[CHECK] URL after price_min: ${url}`);
    console.log(`[CHECK] price_min in URL: ${url.includes("price_min=")}`);

    await page.screenshot({ path: `${R}/final-04-price-filter.png` });
  });

  test("05 - Sort dropdown", async ({ page }) => {
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 45000 }).catch(() => {});

    const sortTrigger = page.locator("[role='combobox']").first();
    await sortTrigger.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${R}/final-05-sort-dropdown.png` });

    const options = page.locator("[role='option']");
    const optCount = await options.count();
    for (let i = 0; i < optCount; i++) {
      console.log(`[DATA] Sort option ${i}: ${await options.nth(i).textContent()}`);
    }

    // Select price ascending
    await page.locator("[role='option']:has-text('Cena')").first().click();
    await page.waitForTimeout(2000);
    console.log(`[CHECK] URL after sort: ${page.url()}`);
    await page.screenshot({ path: `${R}/final-05-sorted.png` });
  });

  test("06 - Pagination", async ({ page }) => {
    await page.goto("/search?view=list", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 45000 }).catch(() => {});

    const pageIndicator = await page.locator("text=/\\d+ \\/ \\d+/").first().textContent().catch(() => "not found");
    console.log(`[DATA] Page indicator: ${pageIndicator}`);

    const prevDisabled = await page.locator("button:has-text('Předchozí')").first().isDisabled().catch(() => false);
    console.log(`[CHECK] Previous disabled on page 1: ${prevDisabled}`);

    await page.screenshot({ path: `${R}/final-06-pagination-page1.png` });

    const nextBtn = page.locator("button:has-text('Další')").first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(3000);

      const pageIndicator2 = await page.locator("text=/\\d+ \\/ \\d+/").first().textContent().catch(() => "?");
      console.log(`[DATA] After next: ${pageIndicator2}, URL: ${page.url()}`);
      await page.screenshot({ path: `${R}/final-06-pagination-page2.png` });
    }
  });

  test("07 - View toggle: list/hybrid/map", async ({ page }) => {
    // List view
    await page.goto("/search?view=list", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 45000 }).catch(() => {});
    const mapInList = await page.locator(".leaflet-container").first().isVisible().catch(() => false);
    console.log(`[CHECK] Map hidden in list view: ${!mapInList}`);
    await page.screenshot({ path: `${R}/final-07-view-list.png` });

    // Map view
    await page.goto("/search?view=map", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const mapInMap = await page.locator(".leaflet-container").first().isVisible().catch(() => false);
    const listingsInMap = await page.locator("article").count();
    console.log(`[CHECK] Map visible in map view: ${mapInMap}, Listings: ${listingsInMap}`);
    await page.screenshot({ path: `${R}/final-07-view-map.png` });

    // Hybrid view
    await page.goto("/search?view=hybrid", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const mapInHybrid = await page.locator(".leaflet-container").first().isVisible().catch(() => false);
    const listingsInHybrid = await page.locator("article").count();
    console.log(`[CHECK] Hybrid: Map=${mapInHybrid}, Listings=${listingsInHybrid}`);
    await page.screenshot({ path: `${R}/final-07-view-hybrid.png` });
  });

  test("08 - Map markers and clusters", async ({ page }) => {
    await page.goto("/search?view=map", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const interactive = await page.locator(".leaflet-interactive").count();
    const priceLabels = await page.locator(".custom-marker-price").count();
    const clusterTooltips = await page.locator(".cluster-count-tooltip").count();
    const tiles = await page.locator(".leaflet-tile-loaded").count();

    console.log(`[MAP] Interactive elements: ${interactive}`);
    console.log(`[MAP] Price labels: ${priceLabels}`);
    console.log(`[MAP] Cluster tooltips: ${clusterTooltips}`);
    console.log(`[MAP] Tiles loaded: ${tiles}`);

    await page.screenshot({ path: `${R}/final-08-map-clusters.png` });

    // Zoom in
    for (let i = 0; i < 3; i++) {
      await page.locator(".leaflet-control-zoom-in").first().click();
      await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(3000);

    const afterZoomPrice = await page.locator(".custom-marker-price").count();
    const afterZoomInteractive = await page.locator(".leaflet-interactive").count();
    console.log(`[MAP] After zoom in: interactive=${afterZoomInteractive}, price=${afterZoomPrice}`);
    await page.screenshot({ path: `${R}/final-08-map-zoomed-in.png` });
  });

  test("09 - Detail modal complete test", async ({ page }) => {
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 45000 }).catch(() => {});

    const firstCard = page.locator("article").first();
    await firstCard.click();

    const dialog = page.locator("[role='dialog']").first();
    try {
      await dialog.waitFor({ state: "visible", timeout: 10000 });
    } catch {
      await page.screenshot({ path: `${R}/final-09-modal-failed.png` });
      console.log("[FAIL] Modal did not open");
      return;
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${R}/final-09-modal-content.png` });

    // Check fields
    const title = await dialog.locator("h2").first().textContent().catch(() => "");
    const hasBadges = await dialog.locator("[class*='badge'], [class*='Badge']").count();
    const hasImages = await dialog.locator("img").count();
    const hasSourceLink = await dialog.locator("a[target='_blank']").first().isVisible().catch(() => false);
    const hasDesc = await dialog.locator("text=Popis").first().isVisible().catch(() => false);
    const hasMiniMap = await dialog.locator(".leaflet-container").first().isVisible().catch(() => false);

    console.log(`[MODAL] Title: "${title}"`);
    console.log(`[MODAL] Badges: ${hasBadges}`);
    console.log(`[MODAL] Images: ${hasImages}`);
    console.log(`[MODAL] Source link: ${hasSourceLink}`);
    console.log(`[MODAL] Description: ${hasDesc}`);
    console.log(`[MODAL] Mini map: ${hasMiniMap}`);

    // Scroll to bottom of modal
    await dialog.locator("[data-radix-scroll-area-viewport]").first().evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${R}/final-09-modal-bottom.png` });

    // Close with Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const closed = !(await dialog.isVisible().catch(() => true));
    console.log(`[CHECK] Modal closed via Escape: ${closed}`);
  });

  test("10 - Mobile layout (375x812)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    const sidebarHidden = !(await page.locator("aside").first().isVisible().catch(() => true));
    const filterBtnVisible = await page.locator("button:has-text('Filtry')").first().isVisible().catch(() => false);
    const viewToggleHidden = !(await page.locator("[value='list']").first().isVisible().catch(() => true));
    const quickFiltersHidden = !(await page.locator("button:has-text('Byty')").first().isVisible().catch(() => true));

    console.log(`[MOBILE] Sidebar hidden: ${sidebarHidden}`);
    console.log(`[MOBILE] Filter button visible: ${filterBtnVisible}`);
    console.log(`[MOBILE] View toggle hidden: ${viewToggleHidden}`);
    console.log(`[MOBILE] Quick filters hidden: ${quickFiltersHidden}`);

    await page.screenshot({ path: `${R}/final-10-mobile-layout.png` });

    // Open filter sheet
    if (filterBtnVisible) {
      await page.locator("button:has-text('Filtry')").first().click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${R}/final-10-mobile-filter-sheet.png` });
      await page.keyboard.press("Escape");
    }

    // Check bottom nav
    const navs = page.locator("nav");
    const navCount = await navs.count();
    for (let i = 0; i < navCount; i++) {
      const box = await navs.nth(i).boundingBox().catch(() => null);
      const text = await navs.nth(i).textContent().catch(() => "");
      if (box && box.y > 700) {
        console.log(`[MOBILE] Bottom nav found: y=${box.y}, text="${text?.substring(0, 40)}"`);
      }
    }

    await page.screenshot({ path: `${R}/final-10-mobile-bottom.png`, fullPage: true });
  });

  test("11 - Empty state", async ({ page }) => {
    await page.goto("/search?price_min=999999999&price_max=999999999&view=list", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    const emptyVisible = await page.locator("text=Žádné výsledky").first().isVisible().catch(() => false);
    const helperVisible = await page.locator("text=Zkuste upravit filtry").first().isVisible().catch(() => false);
    const cardCount = await page.locator("article").count();

    console.log(`[EMPTY] 'Žádné výsledky' visible: ${emptyVisible}`);
    console.log(`[EMPTY] Helper text visible: ${helperVisible}`);
    console.log(`[EMPTY] Cards shown: ${cardCount}`);

    await page.screenshot({ path: `${R}/final-11-empty-state.png` });
  });

  test("12 - API performance + duplicate call check", async ({ page }) => {
    const apiCalls: { url: string; status: number; start: number; duration: number }[] = [];

    page.on("request", (req) => {
      if (req.url().includes("/api/")) {
        (req as any).__start = Date.now();
      }
    });

    page.on("response", (res) => {
      if (res.url().includes("/api/")) {
        const start = (res.request() as any).__start || Date.now();
        apiCalls.push({
          url: res.url().replace(/https?:\/\/[^/]+/, ""),
          status: res.status(),
          start,
          duration: Date.now() - start,
        });
      }
    });

    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);

    console.log(`\n=== API CALLS ON PAGE LOAD (${apiCalls.length}) ===`);
    apiCalls.forEach((c) => {
      const flag = c.status >= 400 ? "FAIL" : c.duration > 500 ? "SLOW" : "OK";
      console.log(`  [${flag}] ${c.url.substring(0, 100)} -> ${c.status} (${c.duration}ms)`);
    });

    const dupes = new Map<string, number>();
    apiCalls.forEach((c) => {
      const key = c.url.split("?")[0];
      dupes.set(key, (dupes.get(key) || 0) + 1);
    });
    const duplicateEndpoints = Array.from(dupes.entries()).filter(([, n]) => n > 1);
    if (duplicateEndpoints.length > 0) {
      console.log(`\n[ISSUE] Duplicate API calls detected:`);
      duplicateEndpoints.forEach(([url, n]) => console.log(`  ${url}: ${n} calls`));
    }

    const failedCalls = apiCalls.filter((c) => c.status >= 400);
    const slowCalls = apiCalls.filter((c) => c.duration > 500);
    console.log(`\n[SUMMARY] Failed: ${failedCalls.length}, Slow (>500ms): ${slowCalls.length}, Total: ${apiCalls.length}`);
  });

  test("13 - Marker click blocked by attribution control", async ({ page }) => {
    // This documents the bug where leaflet-control-attribution overlaps markers
    await page.goto("/search?view=map", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    // Check attribution control position
    const attribution = page.locator(".leaflet-control-attribution").first();
    const attrBox = await attribution.boundingBox().catch(() => null);
    console.log(`[BUG] Attribution control bounds: ${JSON.stringify(attrBox)}`);

    // Check if any markers are behind attribution
    const markers = page.locator(".custom-marker-price");
    const markerCount = await markers.count();
    let blockedMarkers = 0;

    for (let i = 0; i < markerCount; i++) {
      const markerBox = await markers.nth(i).boundingBox().catch(() => null);
      if (markerBox && attrBox) {
        const overlaps =
          markerBox.x < attrBox.x + attrBox.width &&
          markerBox.x + markerBox.width > attrBox.x &&
          markerBox.y < attrBox.y + attrBox.height &&
          markerBox.y + markerBox.height > attrBox.y;
        if (overlaps) blockedMarkers++;
      }
    }

    console.log(`[BUG] Markers blocked by attribution: ${blockedMarkers}/${markerCount}`);
    await page.screenshot({ path: `${R}/final-13-attribution-overlap.png` });
  });

  test("14 - Wide desktop 1920x1080", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const cards = page.locator("article");
    const count = await cards.count();
    console.log(`[DATA] Cards on 1920px: ${count}`);

    // Check for proper hybrid layout (listings on left narrow column, map on right)
    if (count >= 2) {
      const c1 = await cards.nth(0).boundingBox();
      const c2 = await cards.nth(1).boundingBox();
      console.log(`[LAYOUT] Card1: ${JSON.stringify(c1)}`);
      console.log(`[LAYOUT] Card2: ${JSON.stringify(c2)}`);
    }

    await page.screenshot({ path: `${R}/final-14-wide-desktop.png` });
  });

  test("15 - Tablet 768x1024", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/search", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    const sidebarVisible = await page.locator("aside").first().isVisible().catch(() => false);
    const filterBtnVisible = await page.locator("button:has-text('Filtry')").first().isVisible().catch(() => false);
    console.log(`[TABLET] Sidebar visible: ${sidebarVisible}`);
    console.log(`[TABLET] Filter button visible: ${filterBtnVisible}`);

    await page.screenshot({ path: `${R}/final-15-tablet.png` });
  });
});
