import { test, expect } from "@playwright/test";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";

test.describe("Search Page - Filter Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/search", { waitUntil: "networkidle" });
    // Wait for listings to load
    await page.waitForSelector("article", { timeout: 10000 }).catch(() => null);
  });

  test("filter sidebar is visible on desktop viewport", async ({ page }) => {
    const sidebar = page.locator("aside").first();
    const isVisible = await sidebar.isVisible();
    console.log(`[CHECK] Sidebar visible on desktop: ${isVisible}`);
    await page.screenshot({ path: `${RESULTS_DIR}/02-filter-sidebar-visible.png` });
    expect(isVisible).toBeTruthy();
  });

  test("transaction type toggle (rent/sale) changes results", async ({ page }) => {
    // Get initial count
    const countEl = page.locator("text=nabídek").first();
    const initialText = await countEl.textContent();
    console.log(`[DATA] Initial count text: ${initialText}`);

    await page.screenshot({ path: `${RESULTS_DIR}/02-filter-tx-before.png` });

    // Click "Pronájem" (rent) in sidebar
    const rentButton = page.locator("aside").locator("text=Pronájem").first();
    const rentVisible = await rentButton.isVisible().catch(() => false);
    console.log(`[CHECK] Rent toggle visible in sidebar: ${rentVisible}`);

    if (rentVisible) {
      await rentButton.click();
      await page.waitForTimeout(1500);
      await page.waitForLoadState("networkidle");

      const afterRentText = await countEl.textContent();
      console.log(`[DATA] After selecting 'Pronájem': ${afterRentText}`);

      // Check URL changed
      const url = page.url();
      const hasParam = url.includes("transaction_type=rent");
      console.log(`[CHECK] URL has transaction_type=rent: ${hasParam}`);
      console.log(`[DATA] URL: ${url}`);

      await page.screenshot({ path: `${RESULTS_DIR}/02-filter-tx-rent.png` });

      // Click "Prodej" (sale)
      const saleButton = page.locator("aside").locator("text=Prodej").first();
      await saleButton.click();
      await page.waitForTimeout(1500);
      await page.waitForLoadState("networkidle");

      const afterSaleText = await countEl.textContent();
      console.log(`[DATA] After selecting 'Prodej': ${afterSaleText}`);

      const urlSale = page.url();
      const hasSaleParam = urlSale.includes("transaction_type=sale");
      console.log(`[CHECK] URL has transaction_type=sale: ${hasSaleParam}`);

      await page.screenshot({ path: `${RESULTS_DIR}/02-filter-tx-sale.png` });
    }
  });

  test("property type quick filters (Vse/Byty/Domy) work", async ({ page }) => {
    // These are in the SearchHeader, not the sidebar
    const countEl = page.locator("text=nabídek").first();
    const initialText = await countEl.textContent();
    console.log(`[DATA] Initial: ${initialText}`);

    // Click "Byty" quick filter
    const bytyBtn = page.locator("button:has-text('Byty')").first();
    const bytyVisible = await bytyBtn.isVisible().catch(() => false);
    console.log(`[CHECK] 'Byty' quick filter visible: ${bytyVisible}`);

    if (bytyVisible) {
      await bytyBtn.click();
      await page.waitForTimeout(1500);
      await page.waitForLoadState("networkidle");

      const afterBytyText = await countEl.textContent();
      console.log(`[DATA] After 'Byty': ${afterBytyText}`);

      const url = page.url();
      console.log(`[CHECK] URL has property_type=apartment: ${url.includes("property_type=apartment")}`);

      await page.screenshot({ path: `${RESULTS_DIR}/02-filter-property-byty.png` });

      // Click "Domy"
      const domyBtn = page.locator("button:has-text('Domy')").first();
      await domyBtn.click();
      await page.waitForTimeout(1500);
      await page.waitForLoadState("networkidle");

      const afterDomyText = await countEl.textContent();
      console.log(`[DATA] After 'Domy': ${afterDomyText}`);
      console.log(`[CHECK] URL has property_type=house: ${page.url().includes("property_type=house")}`);

      await page.screenshot({ path: `${RESULTS_DIR}/02-filter-property-domy.png` });

      // Click "Vse" to reset
      const vseBtn = page.locator("button:has-text('Vše')").first();
      await vseBtn.click();
      await page.waitForTimeout(1500);
      await page.waitForLoadState("networkidle");

      const afterVseText = await countEl.textContent();
      console.log(`[DATA] After 'Vše' (reset): ${afterVseText}`);

      await page.screenshot({ path: `${RESULTS_DIR}/02-filter-property-vse.png` });
    }
  });

  test("price range filter works", async ({ page }) => {
    // Look for price filter inputs in sidebar
    const sidebar = page.locator("aside").first();

    // Find price-related inputs
    const priceInputs = sidebar.locator('input[type="number"], input[placeholder*="Kč"], input[placeholder*="min"], input[placeholder*="max"], input[placeholder*="Od"], input[placeholder*="Do"]');
    const priceInputCount = await priceInputs.count();
    console.log(`[CHECK] Price-related inputs in sidebar: ${priceInputCount}`);

    // Try to find the price section by label
    const priceLabel = sidebar.locator("text=Cena").first();
    const priceLabelVisible = await priceLabel.isVisible().catch(() => false);
    console.log(`[CHECK] 'Cena' (Price) label visible: ${priceLabelVisible}`);

    // Screenshot before
    await page.screenshot({ path: `${RESULTS_DIR}/02-filter-price-before.png` });

    // Try to interact with range slider or input
    // PriceRangeSlider component - look for slider or input elements
    const allInputs = sidebar.locator("input");
    const inputCount = await allInputs.count();
    console.log(`[DATA] Total inputs in sidebar: ${inputCount}`);

    // List all input placeholders
    for (let i = 0; i < inputCount; i++) {
      const inp = allInputs.nth(i);
      const placeholder = await inp.getAttribute("placeholder").catch(() => "N/A");
      const type = await inp.getAttribute("type").catch(() => "N/A");
      const value = await inp.inputValue().catch(() => "N/A");
      console.log(`  Input ${i}: type=${type}, placeholder=${placeholder}, value=${value}`);
    }

    // Try to fill a min price
    if (inputCount >= 1) {
      const firstInput = allInputs.nth(0);
      await firstInput.click();
      await firstInput.fill("5000000");
      await firstInput.press("Enter");
      await page.waitForTimeout(2000);
      await page.waitForLoadState("networkidle");

      const url = page.url();
      console.log(`[CHECK] URL after price_min set: ${url}`);
      console.log(`[CHECK] Has price_min param: ${url.includes("price_min")}`);

      await page.screenshot({ path: `${RESULTS_DIR}/02-filter-price-after.png` });
    }
  });

  test("location autocomplete works", async ({ page }) => {
    const sidebar = page.locator("aside").first();

    // Find location input
    const locationInput = sidebar.locator('input[placeholder*="Lokalita"], input[placeholder*="Město"], input[placeholder*="hledat"], input[placeholder*="adresa"]').first();
    const locationVisible = await locationInput.isVisible().catch(() => false);
    console.log(`[CHECK] Location input visible: ${locationVisible}`);

    if (!locationVisible) {
      // Try finding by the label
      const allInputsInSidebar = sidebar.locator("input");
      const count = await allInputsInSidebar.count();
      console.log(`[DATA] Trying all ${count} inputs in sidebar for location...`);

      // List them all
      for (let i = 0; i < count; i++) {
        const inp = allInputsInSidebar.nth(i);
        const placeholder = await inp.getAttribute("placeholder").catch(() => null);
        console.log(`  Input ${i}: placeholder="${placeholder}"`);
      }
    }

    await page.screenshot({ path: `${RESULTS_DIR}/02-filter-location.png` });
  });

  test("layout filter works", async ({ page }) => {
    const sidebar = page.locator("aside").first();

    // Layout filter - look for layout options like 1+kk, 2+1, etc.
    const layoutSection = sidebar.locator("text=Dispozice").first();
    const layoutVisible = await layoutSection.isVisible().catch(() => false);
    console.log(`[CHECK] 'Dispozice' (Layout) section visible: ${layoutVisible}`);

    // Find layout buttons/checkboxes
    const layoutButtons = sidebar.locator("button:has-text('1+kk'), button:has-text('2+kk'), button:has-text('3+kk'), button:has-text('2+1'), button:has-text('3+1')");
    const layoutCount = await layoutButtons.count();
    console.log(`[CHECK] Layout option buttons found: ${layoutCount}`);

    if (layoutCount > 0) {
      // Click a layout option
      await layoutButtons.first().click();
      await page.waitForTimeout(1500);
      await page.waitForLoadState("networkidle");

      const url = page.url();
      console.log(`[CHECK] URL after layout filter: ${url}`);
      console.log(`[CHECK] Has layout param: ${url.includes("layout")}`);

      await page.screenshot({ path: `${RESULTS_DIR}/02-filter-layout-selected.png` });
    }

    await page.screenshot({ path: `${RESULTS_DIR}/02-filter-layout.png` });
  });

  test("accordion filters expand (condition, construction, ownership, etc.)", async ({ page }) => {
    const sidebar = page.locator("aside").first();

    const accordionTriggers = [
      { label: "Stav", key: "condition" },
      { label: "Konstrukce", key: "construction" },
      { label: "Vlastnictví", key: "ownership" },
      { label: "Vybavenost", key: "furnishing" },
      { label: "Vybavení", key: "amenities" },
      { label: "PENB", key: "energy" },
      { label: "Zdroj", key: "source" },
    ];

    for (const { label, key } of accordionTriggers) {
      const trigger = sidebar.locator(`button:has-text("${label}")`).first();
      const isVisible = await trigger.isVisible().catch(() => false);
      console.log(`[CHECK] Accordion '${label}' trigger visible: ${isVisible}`);

      if (isVisible) {
        // Check if content is hidden before click
        await trigger.click();
        await page.waitForTimeout(500);

        // Check if expanded - look for checkboxes or content inside
        const parentItem = trigger.locator("xpath=ancestor::div[@data-state]").first();
        const dataState = await parentItem.getAttribute("data-state").catch(() => "unknown");
        console.log(`[CHECK] Accordion '${label}' state after click: ${dataState}`);
      }
    }

    await page.screenshot({ path: `${RESULTS_DIR}/02-filter-accordions-expanded.png`, fullPage: true });
  });

  test("clear all filters works", async ({ page }) => {
    // First, apply some filters
    const bytyBtn = page.locator("button:has-text('Byty')").first();
    if (await bytyBtn.isVisible().catch(() => false)) {
      await bytyBtn.click();
      await page.waitForTimeout(1000);
    }

    // Check active filter chips appear
    const activeChips = page.locator("text=Vymazat vše").first();
    const chipsVisible = await activeChips.isVisible().catch(() => false);
    console.log(`[CHECK] 'Vymazat vše' (Clear all) button visible after filter: ${chipsVisible}`);

    await page.screenshot({ path: `${RESULTS_DIR}/02-filter-chips-active.png` });

    if (chipsVisible) {
      await activeChips.click();
      await page.waitForTimeout(1500);
      await page.waitForLoadState("networkidle");

      const url = page.url();
      console.log(`[CHECK] URL after clear all: ${url}`);
      console.log(`[CHECK] URL clean (no filter params): ${!url.includes("property_type=") && !url.includes("transaction_type=")}`);

      await page.screenshot({ path: `${RESULTS_DIR}/02-filter-chips-cleared.png` });
    }
  });

  test("individual filter chip removal works", async ({ page }) => {
    // Apply a property type filter
    const bytyBtn = page.locator("button:has-text('Byty')").first();
    if (await bytyBtn.isVisible().catch(() => false)) {
      await bytyBtn.click();
      await page.waitForTimeout(1000);
    }

    // Look for X button on filter chip
    const chipBadge = page.locator("[class*='badge'], [class*='Badge']").filter({ hasText: "Nemovitost" }).first();
    const chipVisible = await chipBadge.isVisible().catch(() => false);
    console.log(`[CHECK] Property type chip visible: ${chipVisible}`);

    if (chipVisible) {
      // Click the X button inside the chip
      const removeBtn = chipBadge.locator("button").first();
      await removeBtn.click();
      await page.waitForTimeout(1000);

      const url = page.url();
      console.log(`[CHECK] URL after chip removal: ${url}`);
      console.log(`[CHECK] property_type removed from URL: ${!url.includes("property_type=")}`);

      await page.screenshot({ path: `${RESULTS_DIR}/02-filter-chip-removed.png` });
    }
  });
});
