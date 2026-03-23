import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const RESULTS_DIR = "/Users/ducba/personal/flat-finder-cz/test-results";
const BASE_URL = "http://localhost:3000";

// Ensure results directory exists
fs.mkdirSync(RESULTS_DIR, { recursive: true });

// Shared state for collecting console messages
const consoleMessages: { type: string; text: string; url: string }[] = [];
const networkErrors: { url: string; status: number; statusText: string }[] = [];
const slowRequests: { url: string; duration: number }[] = [];

function setupConsoleCapture(page: Page) {
  page.on("console", (msg: ConsoleMessage) => {
    consoleMessages.push({
      type: msg.type(),
      text: msg.text(),
      url: page.url(),
    });
  });

  page.on("pageerror", (err) => {
    consoleMessages.push({
      type: "pageerror",
      text: err.message,
      url: page.url(),
    });
  });
}

function setupNetworkCapture(page: Page) {
  const requestTimings = new Map<string, number>();

  page.on("request", (req) => {
    requestTimings.set(req.url(), Date.now());
  });

  page.on("response", (res) => {
    const startTime = requestTimings.get(res.url());
    if (startTime) {
      const duration = Date.now() - startTime;
      if (duration > 1000) {
        slowRequests.push({ url: res.url(), duration });
      }
    }
    if (res.status() >= 400) {
      networkErrors.push({
        url: res.url(),
        status: res.status(),
        statusText: res.statusText(),
      });
    }
  });

  page.on("requestfailed", (req) => {
    networkErrors.push({
      url: req.url(),
      status: 0,
      statusText: req.failure()?.errorText || "Request failed",
    });
  });
}

// ============================================================
// TEST 1: PAGE LOAD & PERFORMANCE METRICS
// ============================================================
test("1. Page Load & Performance Metrics", async ({ page }) => {
  setupConsoleCapture(page);
  setupNetworkCapture(page);

  let totalRequests = 0;
  let totalTransferSize = 0;
  page.on("response", async (res) => {
    totalRequests++;
    try {
      const headers = res.headers();
      const size = parseInt(headers["content-length"] || "0", 10);
      totalTransferSize += size;
    } catch {}
  });

  const startTime = Date.now();
  const response = await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const loadTime = Date.now() - startTime;

  // Screenshot: full page load
  await page.screenshot({
    path: path.join(RESULTS_DIR, "01-full-page-desktop.png"),
    fullPage: true,
  });

  // Check response status
  expect(response?.status()).toBeLessThan(400);

  // Performance metrics from browser
  const performanceMetrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByType("paint");
    const fcp = paint.find((e) => e.name === "first-contentful-paint");

    // Get LCP via PerformanceObserver
    return {
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
      loadEvent: Math.round(nav.loadEventEnd - nav.startTime),
      ttfb: Math.round(nav.responseStart - nav.startTime),
      fcp: fcp ? Math.round(fcp.startTime) : null,
      domInteractive: Math.round(nav.domInteractive - nav.startTime),
      transferSize: nav.transferSize,
      encodedBodySize: nav.encodedBodySize,
      decodedBodySize: nav.decodedBodySize,
    };
  });

  // Get LCP separately
  const lcpValue = await page.evaluate(() => {
    return new Promise<number | null>((resolve) => {
      let lcp: number | null = null;
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          lcp = Math.round(entries[entries.length - 1].startTime);
        }
      });
      observer.observe({ type: "largest-contentful-paint", buffered: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(lcp);
      }, 500);
    });
  });

  // Get CLS
  const clsValue = await page.evaluate(() => {
    return new Promise<number | null>((resolve) => {
      let cls = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as any).hadRecentInput) {
            cls += (entry as any).value;
          }
        }
      });
      observer.observe({ type: "layout-shift", buffered: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(Math.round(cls * 10000) / 10000);
      }, 500);
    });
  });

  // Write performance report
  const perfReport = {
    loadTime,
    totalRequests,
    totalTransferSize,
    metrics: performanceMetrics,
    lcp: lcpValue,
    cls: clsValue,
    networkErrors,
    slowRequests,
    consoleErrors: consoleMessages.filter(
      (m) => m.type === "error" || m.type === "pageerror"
    ),
    consoleWarnings: consoleMessages.filter((m) => m.type === "warning"),
  };

  fs.writeFileSync(
    path.join(RESULTS_DIR, "performance-report.json"),
    JSON.stringify(perfReport, null, 2)
  );

  console.log("=== PERFORMANCE METRICS ===");
  console.log(`Time to First Byte: ${performanceMetrics.ttfb}ms`);
  console.log(`First Contentful Paint: ${performanceMetrics.fcp}ms`);
  console.log(`DOM Content Loaded: ${performanceMetrics.domContentLoaded}ms`);
  console.log(`Load Event: ${performanceMetrics.loadEvent}ms`);
  console.log(`Largest Contentful Paint: ${lcpValue}ms`);
  console.log(`Cumulative Layout Shift: ${clsValue}`);
  console.log(`Total Network Requests: ${totalRequests}`);
  console.log(`Total Load Time (networkidle): ${loadTime}ms`);
  console.log(`Network Errors: ${networkErrors.length}`);
  console.log(`Slow Requests (>1s): ${slowRequests.length}`);
  console.log(`Console Errors: ${consoleMessages.filter((m) => m.type === "error" || m.type === "pageerror").length}`);
  console.log(`Console Warnings: ${consoleMessages.filter((m) => m.type === "warning").length}`);
});

// ============================================================
// TEST 2: HERO SECTION
// ============================================================
test("2. Hero Section", async ({ page }) => {
  setupConsoleCapture(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Screenshot hero section
  await page.screenshot({
    path: path.join(RESULTS_DIR, "02-hero-section.png"),
    fullPage: false,
  });

  // Check headline
  const h1 = page.locator("h1");
  await expect(h1).toBeVisible({ timeout: 10000 });
  const h1Text = await h1.textContent();
  console.log(`Hero headline text: "${h1Text}"`);
  expect(h1Text).toContain("Najděte domov");

  // Check subtitle
  const subtitle = page.locator("text=Prohledáváme všechny největší české portály");
  await expect(subtitle).toBeVisible();

  // Check search tabs are present
  const searchBox = page.locator("text=Koupit");
  await expect(searchBox).toBeVisible();
  const rentTab = page.locator("text=Pronajmout");
  await expect(rentTab).toBeVisible();

  // Check search input
  const locationInput = page.locator('input[placeholder*="Město"]');
  await expect(locationInput).toBeVisible();

  // Check search button
  const searchBtn = page.locator("button:has-text('Hledat')");
  await expect(searchBtn).toBeVisible();

  // Check trust bar / eyebrow (listings count)
  const eyebrow = page.locator("text=ověřených nabídek");
  const eyebrowVisible = await eyebrow.isVisible().catch(() => false);
  console.log(`Trust bar (listings count) visible: ${eyebrowVisible}`);

  console.log("=== HERO SECTION RESULTS ===");
  console.log(`Headline visible: YES`);
  console.log(`Headline text: "${h1Text}"`);
  console.log(`Search tabs visible: YES`);
  console.log(`Location input visible: YES`);
  console.log(`Search button visible: YES`);
  console.log(`Trust bar visible: ${eyebrowVisible}`);
});

// ============================================================
// TEST 3: SEARCH FUNCTIONALITY
// ============================================================
test("3. Search Tabs Interaction", async ({ page }) => {
  setupConsoleCapture(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Test transaction type tabs
  const buyTab = page.locator("button:has-text('Koupit')");
  const rentTab = page.locator("button:has-text('Pronajmout')");

  // Default should be "rent" (Pronajmout) based on code
  // Click Koupit
  await buyTab.click();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(RESULTS_DIR, "03a-search-buy-selected.png"),
    fullPage: false,
  });

  // Check buy tab is highlighted
  const buyTabClasses = await buyTab.getAttribute("class");
  console.log(`Buy tab classes after click: ${buyTabClasses}`);

  // Click Pronajmout
  await rentTab.click();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(RESULTS_DIR, "03b-search-rent-selected.png"),
    fullPage: false,
  });

  // Type location and search
  const locationInput = page.locator('input[placeholder*="Město"]');
  await locationInput.fill("Praha");
  await page.screenshot({
    path: path.join(RESULTS_DIR, "03c-search-with-location.png"),
    fullPage: false,
  });

  // Click search button and verify navigation
  const searchBtn = page.locator("button:has-text('Hledat')");
  await searchBtn.click();
  await page.waitForURL("**/search**", { timeout: 10000 });

  const currentUrl = page.url();
  console.log(`After search, URL: ${currentUrl}`);
  expect(currentUrl).toContain("search");
  expect(currentUrl).toContain("transaction_type=rent");
  expect(currentUrl).toContain("location=Praha");

  await page.screenshot({
    path: path.join(RESULTS_DIR, "03d-search-results-page.png"),
    fullPage: false,
  });

  // Test Enter key search
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const locationInput2 = page.locator('input[placeholder*="Město"]');
  await locationInput2.fill("Brno");
  await locationInput2.press("Enter");
  await page.waitForURL("**/search**", { timeout: 10000 });
  const urlAfterEnter = page.url();
  console.log(`After Enter key search, URL: ${urlAfterEnter}`);
  expect(urlAfterEnter).toContain("location=Brno");
});

// ============================================================
// TEST 4: LATEST LISTINGS SECTION
// ============================================================
test("4. Latest Listings Section", async ({ page }) => {
  setupConsoleCapture(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Scroll to latest listings
  const listingsSection = page.locator("text=Nejnovější nabídky");
  await listingsSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000); // Wait for animations and data loading

  await page.screenshot({
    path: path.join(RESULTS_DIR, "04a-latest-listings.png"),
    fullPage: false,
  });

  // Check section heading
  await expect(listingsSection).toBeVisible();

  // Check subtitle
  const subtitle = page.locator("text=Čerstvé nemovitosti ze všech zdrojů");
  await expect(subtitle).toBeVisible();

  // Check for listing cards or skeletons
  const cards = page.locator("article");
  const cardCount = await cards.count();
  console.log(`Number of listing cards: ${cardCount}`);

  if (cardCount > 0) {
    // Check first card has essential elements
    const firstCard = cards.first();

    // Check for image
    const img = firstCard.locator("img");
    const imgVisible = await img.isVisible().catch(() => false);
    console.log(`First card has image: ${imgVisible}`);

    if (imgVisible) {
      // Check for broken images
      const brokenImages = await page.evaluate(() => {
        const imgs = document.querySelectorAll("article img");
        const broken: string[] = [];
        imgs.forEach((img) => {
          const htmlImg = img as HTMLImageElement;
          if (htmlImg.naturalWidth === 0 && htmlImg.complete) {
            broken.push(htmlImg.src);
          }
        });
        return broken;
      });
      console.log(`Broken images found: ${brokenImages.length}`);
      if (brokenImages.length > 0) {
        console.log(`Broken image URLs: ${brokenImages.join(", ")}`);
      }
    }

    // Check for price
    const priceElements = firstCard.locator(".text-primary.font-bold");
    const hasPrice = (await priceElements.count()) > 0;
    console.log(`First card has price: ${hasPrice}`);

    // Check for source badge
    const sourceBadge = firstCard.locator("span:has-text('.cz')");
    const hasSource = (await sourceBadge.count()) > 0;
    console.log(`First card has source badge: ${hasSource}`);

    // Check "Zobrazit vše" button
    const viewAllBtn = page.locator("a:has-text('Zobrazit vše')");
    const viewAllVisible = await viewAllBtn.first().isVisible().catch(() => false);
    console.log(`'Zobrazit vše' button visible: ${viewAllVisible}`);
  } else {
    // Check for skeletons (loading state)
    const skeletons = page.locator("[class*='animate-pulse'], [class*='skeleton']");
    const skeletonCount = await skeletons.count();
    console.log(`Skeleton loaders visible: ${skeletonCount}`);
    console.log("WARNING: No listing cards rendered - either loading failed or no data");
  }

  // Full listings section screenshot
  await page.screenshot({
    path: path.join(RESULTS_DIR, "04b-listings-section-full.png"),
    fullPage: true,
  });
});

// ============================================================
// TEST 5: LISTING DETAIL MODAL
// ============================================================
test("5. Detail Modal", async ({ page }) => {
  setupConsoleCapture(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Scroll to listings and wait for them to load
  const listingsHeading = page.locator("text=Nejnovější nabídky");
  await listingsHeading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);

  const cards = page.locator("article");
  const cardCount = await cards.count();

  if (cardCount === 0) {
    console.log("SKIP: No listing cards to click - cannot test detail modal");
    await page.screenshot({
      path: path.join(RESULTS_DIR, "05-no-cards-to-click.png"),
      fullPage: false,
    });
    return;
  }

  // Click first card
  await cards.first().click();
  await page.waitForTimeout(1500); // Wait for modal + API call

  await page.screenshot({
    path: path.join(RESULTS_DIR, "05a-detail-modal-open.png"),
    fullPage: false,
  });

  // Check modal is visible
  const dialog = page.locator("[role='dialog']");
  const dialogVisible = await dialog.isVisible().catch(() => false);
  console.log(`Detail modal visible: ${dialogVisible}`);

  if (dialogVisible) {
    // Check for loading skeleton or content
    const hasContent = await dialog.locator("h2").first().isVisible().catch(() => false);
    const hasError = await dialog.locator("text=Nepodařilo se").isVisible().catch(() => false);
    const hasLoading = await dialog.locator("[class*='skeleton'], [class*='animate-pulse']").first().isVisible().catch(() => false);

    console.log(`Modal has content: ${hasContent}`);
    console.log(`Modal has error: ${hasError}`);
    console.log(`Modal still loading: ${hasLoading}`);

    if (hasContent) {
      // Check for images
      const modalImages = dialog.locator("img");
      const imgCount = await modalImages.count();
      console.log(`Modal image count: ${imgCount}`);

      // Check for price
      const price = dialog.locator(".text-primary");
      const priceVisible = await price.first().isVisible().catch(() => false);
      console.log(`Modal has price: ${priceVisible}`);

      // Check for source link button
      const sourceBtn = dialog.locator("a:has-text('.cz')");
      const sourceBtnVisible = await sourceBtn.first().isVisible().catch(() => false);
      console.log(`Modal has source link: ${sourceBtnVisible}`);

      // Check for description
      const description = dialog.locator("h3:has-text('Popis')");
      const hasDescription = await description.isVisible().catch(() => false);
      console.log(`Modal has description: ${hasDescription}`);
    }

    // Close modal
    const closeBtn = dialog.locator("button[class*='close'], button:has(svg.lucide-x)");
    if ((await closeBtn.count()) > 0) {
      await closeBtn.first().click();
    } else {
      // Try pressing Escape
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(500);

    const dialogStillVisible = await dialog.isVisible().catch(() => false);
    console.log(`Modal closed successfully: ${!dialogStillVisible}`);

    await page.screenshot({
      path: path.join(RESULTS_DIR, "05b-detail-modal-closed.png"),
      fullPage: false,
    });
  }
});

// ============================================================
// TEST 6: CITY EXPLORER
// ============================================================
test("6. City Explorer Section", async ({ page }) => {
  setupConsoleCapture(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Scroll to city explorer
  const citySection = page.locator("text=Prozkoumejte města");
  const citySectionVisible = await citySection.isVisible().catch(() => false);

  if (!citySectionVisible) {
    // Try scrolling to bottom to trigger intersection observer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
  }

  const citySectionFinal = await citySection.isVisible().catch(() => false);
  console.log(`City Explorer section visible: ${citySectionFinal}`);

  if (citySectionFinal) {
    await citySection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(RESULTS_DIR, "06a-city-explorer.png"),
      fullPage: false,
    });

    // Count city cards
    const cityCards = page.locator("a[href*='/search?location=']");
    const cityCount = await cityCards.count();
    console.log(`Number of city cards: ${cityCount}`);

    if (cityCount > 0) {
      // Read city names
      for (let i = 0; i < Math.min(cityCount, 6); i++) {
        const card = cityCards.nth(i);
        const text = await card.textContent();
        console.log(`City card ${i + 1}: ${text?.trim()}`);
      }

      // Click first city card
      const firstCity = cityCards.first();
      const cityHref = await firstCity.getAttribute("href");
      console.log(`First city link: ${cityHref}`);

      await firstCity.click();
      await page.waitForURL("**/search**", { timeout: 10000 });
      const navUrl = page.url();
      console.log(`After city click, URL: ${navUrl}`);
      expect(navUrl).toContain("location=");

      await page.screenshot({
        path: path.join(RESULTS_DIR, "06b-city-search-results.png"),
        fullPage: false,
      });
    }
  } else {
    console.log("WARNING: City Explorer section not visible - possibly no stats data");
    await page.screenshot({
      path: path.join(RESULTS_DIR, "06a-city-explorer-missing.png"),
      fullPage: true,
    });
  }
});

// ============================================================
// TEST 7: FEATURES SECTION
// ============================================================
test("7. Features Section", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Look for features section
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(500);

  // Try multiple possible headings
  const possibleHeadings = [
    "Proč Domov.cz",
    "Jak to funguje",
    "Funkce",
    "Výhody",
  ];

  let featuresFound = false;
  for (const heading of possibleHeadings) {
    const el = page.locator(`text=${heading}`);
    if (await el.isVisible().catch(() => false)) {
      console.log(`Features section found with heading: "${heading}"`);
      await el.scrollIntoViewIfNeeded();
      featuresFound = true;
      break;
    }
  }

  if (!featuresFound) {
    // Try to find any section between listings and city explorer
    console.log("Features section heading not found by known names - checking page structure");
  }

  await page.screenshot({
    path: path.join(RESULTS_DIR, "07-features-section.png"),
    fullPage: false,
  });
});

// ============================================================
// TEST 8: NAVBAR
// ============================================================
test("8. Navbar", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Check navbar
  const nav = page.locator("header nav");
  await expect(nav).toBeVisible();

  // Check logo
  const logo = page.locator("header a[href='/']").first();
  const logoVisible = await logo.isVisible().catch(() => false);
  console.log(`Logo visible: ${logoVisible}`);

  // Check nav links (desktop)
  const homeLink = page.locator("header >> text=Home");
  const homeVisible = await homeLink.isVisible().catch(() => false);
  console.log(`Home nav link visible: ${homeVisible}`);

  const searchLink = page.locator("header >> text=Hledat");
  const searchVisible = await searchLink.isVisible().catch(() => false);
  console.log(`Search nav link visible: ${searchVisible}`);

  // Check theme toggle
  const themeToggle = page.locator("header button:has-text('Změnit motiv'), header button:has(svg.lucide-sun), header button:has(svg.lucide-moon)");
  const themeToggleVisible = await themeToggle.first().isVisible().catch(() => false);
  console.log(`Theme toggle visible: ${themeToggleVisible}`);

  // Check bell button
  const bellBtn = page.locator("header button:has-text('Hlídací pes'), header button:has(svg.lucide-bell)");
  const bellVisible = await bellBtn.first().isVisible().catch(() => false);
  console.log(`Bell/Watchdog button visible: ${bellVisible}`);

  // Check "Přidat inzerát" button
  const addBtn = page.locator("header >> text=Přidat inzerát");
  const addBtnVisible = await addBtn.isVisible().catch(() => false);
  console.log(`'Přidat inzerát' button visible: ${addBtnVisible}`);

  await page.screenshot({
    path: path.join(RESULTS_DIR, "08a-navbar.png"),
    fullPage: false,
  });

  // Test navbar is sticky (scroll down and check)
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(300);
  const navStillVisible = await nav.isVisible();
  console.log(`Navbar still visible after scroll (sticky): ${navStillVisible}`);

  await page.screenshot({
    path: path.join(RESULTS_DIR, "08b-navbar-after-scroll.png"),
    fullPage: false,
  });
});

// ============================================================
// TEST 9: THEME TOGGLE (DARK MODE)
// ============================================================
test("9. Theme Toggle", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Screenshot in default theme
  await page.screenshot({
    path: path.join(RESULTS_DIR, "09a-theme-default.png"),
    fullPage: false,
  });

  // Find and click theme toggle
  // The theme toggle uses sr-only text "Změnit motiv"
  const themeBtn = page.locator("button").filter({ has: page.locator("span.sr-only:has-text('Změnit motiv')") });
  const themeBtnCount = await themeBtn.count();
  console.log(`Theme toggle buttons found: ${themeBtnCount}`);

  if (themeBtnCount > 0) {
    await themeBtn.first().click();
    await page.waitForTimeout(300);

    await page.screenshot({
      path: path.join(RESULTS_DIR, "09b-theme-dropdown.png"),
      fullPage: false,
    });

    // Click "Tmavý" (Dark)
    const darkOption = page.locator("[role='menuitem']:has-text('Tmavý')");
    const darkOptionVisible = await darkOption.isVisible().catch(() => false);
    console.log(`Dark theme option visible: ${darkOptionVisible}`);

    if (darkOptionVisible) {
      await darkOption.click();
      await page.waitForTimeout(500);

      // Check if dark class is applied
      const hasDarkClass = await page.evaluate(() =>
        document.documentElement.classList.contains("dark")
      );
      console.log(`Dark class on html element: ${hasDarkClass}`);

      await page.screenshot({
        path: path.join(RESULTS_DIR, "09c-theme-dark.png"),
        fullPage: false,
      });

      // Switch to light
      await themeBtn.first().click();
      await page.waitForTimeout(300);
      const lightOption = page.locator("[role='menuitem']:has-text('Světlý')");
      if (await lightOption.isVisible().catch(() => false)) {
        await lightOption.click();
        await page.waitForTimeout(500);
      }

      const hasDarkAfterLight = await page.evaluate(() =>
        document.documentElement.classList.contains("dark")
      );
      console.log(`Dark class after switching to light: ${hasDarkAfterLight}`);

      await page.screenshot({
        path: path.join(RESULTS_DIR, "09d-theme-light.png"),
        fullPage: false,
      });
    }
  } else {
    console.log("WARNING: Theme toggle button not found");
  }
});

// ============================================================
// TEST 10: DARK MODE FULL PAGE
// ============================================================
test("10. Dark Mode Full Page", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Force dark mode
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  });
  await page.waitForTimeout(500);

  // Scroll to bottom to trigger all intersection observers
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < document.body.scrollHeight; i += 300) {
      window.scrollTo(0, i);
      await delay(100);
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(RESULTS_DIR, "10-dark-mode-full.png"),
    fullPage: true,
  });

  // Check for contrast issues - look for text that might be invisible on dark background
  const contrastIssues = await page.evaluate(() => {
    const issues: string[] = [];
    const elements = document.querySelectorAll("p, h1, h2, h3, h4, span, a, button, label");
    elements.forEach((el) => {
      const style = getComputedStyle(el);
      const color = style.color;
      const bg = style.backgroundColor;
      // Simple check: if both color and background are very similar
      if (color === bg && color !== "rgba(0, 0, 0, 0)") {
        issues.push(`${el.tagName}.${el.className.toString().slice(0, 50)}: color=${color} bg=${bg}`);
      }
    });
    return issues;
  });

  console.log(`Potential contrast issues in dark mode: ${contrastIssues.length}`);
  contrastIssues.forEach((issue) => console.log(`  - ${issue}`));
});

// ============================================================
// TEST 11: WATCHDOG MODAL
// ============================================================
test("11. Watchdog Modal", async ({ page }) => {
  setupConsoleCapture(page);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Find and click the bell button
  const bellBtn = page.locator("button").filter({ has: page.locator("span.sr-only:has-text('Hlídací pes')") });
  const bellCount = await bellBtn.count();
  console.log(`Bell buttons found: ${bellCount}`);

  if (bellCount > 0) {
    await bellBtn.first().click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(RESULTS_DIR, "11a-watchdog-modal.png"),
      fullPage: false,
    });

    // Check modal content
    const dialog = page.locator("[role='dialog']");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Check title
    const title = dialog.locator("text=Hlídací pes");
    await expect(title.first()).toBeVisible();

    // Check description
    const desc = dialog.locator("text=Dostanete e-mail");
    const descVisible = await desc.isVisible().catch(() => false);
    console.log(`Modal description visible: ${descVisible}`);

    // Check tabs
    const createTab = dialog.locator("text=Nový hlídací pes");
    const listTab = dialog.locator("text=Moji psi");
    const createTabVisible = await createTab.isVisible().catch(() => false);
    const listTabVisible = await listTab.isVisible().catch(() => false);
    console.log(`Create tab visible: ${createTabVisible}`);
    console.log(`List tab visible: ${listTabVisible}`);

    // Check email input
    const emailInput = dialog.locator("input[type='email'], input#watchdogEmail");
    const emailVisible = await emailInput.first().isVisible().catch(() => false);
    console.log(`Email input visible: ${emailVisible}`);

    // Check save button
    const saveBtn = dialog.locator("button:has-text('Uložit hlídacího psa')");
    const saveVisible = await saveBtn.isVisible().catch(() => false);
    console.log(`Save button visible: ${saveVisible}`);

    // Test: try to save without email (should focus email input)
    if (saveVisible) {
      await saveBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(RESULTS_DIR, "11b-watchdog-empty-submit.png"),
        fullPage: false,
      });
    }

    // Fill in email
    if (emailVisible) {
      await emailInput.first().fill("test@example.com");
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(RESULTS_DIR, "11c-watchdog-with-email.png"),
        fullPage: false,
      });

      // Fill in label
      const labelInput = dialog.locator("input#watchdogLabel");
      if (await labelInput.isVisible().catch(() => false)) {
        await labelInput.fill("Test watchdog");
      }

      // Try to save
      if (saveVisible) {
        await saveBtn.click();
        await page.waitForTimeout(2000);
        await page.screenshot({
          path: path.join(RESULTS_DIR, "11d-watchdog-after-save.png"),
          fullPage: false,
        });

        // Check for toast message
        const toast = page.locator("text=Hlídací pes uložen!, text=Chyba");
        const toastVisible = await toast.first().isVisible().catch(() => false);
        console.log(`Toast message visible after save: ${toastVisible}`);
      }
    }

    // Test "Moji psi" tab
    if (listTabVisible) {
      await listTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(RESULTS_DIR, "11e-watchdog-list-tab.png"),
        fullPage: false,
      });
    }

    // Close modal
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const modalClosed = !(await dialog.isVisible().catch(() => false));
    console.log(`Watchdog modal closed: ${modalClosed}`);
  } else {
    console.log("WARNING: Bell button not found");
  }
});

// ============================================================
// TEST 12: FOOTER
// ============================================================
test("12. Footer", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Scroll to footer
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(RESULTS_DIR, "12-footer.png"),
    fullPage: false,
  });

  const footer = page.locator("footer");
  await expect(footer).toBeVisible();

  // Check footer sections
  const navSection = footer.locator("text=Navigace");
  const navVisible = await navSection.isVisible().catch(() => false);
  console.log(`Footer 'Navigace' section: ${navVisible}`);

  const sourcesSection = footer.locator("text=Zdroje");
  const sourcesVisible = await sourcesSection.isVisible().catch(() => false);
  console.log(`Footer 'Zdroje' section: ${sourcesVisible}`);

  const contactSection = footer.locator("text=Kontakt");
  const contactVisible = await contactSection.isVisible().catch(() => false);
  console.log(`Footer 'Kontakt' section: ${contactVisible}`);

  // Check copyright
  const copyright = footer.locator("text=Domov.cz. Všechna práva vyhrazena");
  const copyrightVisible = await copyright.isVisible().catch(() => false);
  console.log(`Footer copyright visible: ${copyrightVisible}`);

  // Check footer links
  const footerLinks = footer.locator("a");
  const linkCount = await footerLinks.count();
  console.log(`Footer link count: ${linkCount}`);

  for (let i = 0; i < linkCount; i++) {
    const link = footerLinks.nth(i);
    const href = await link.getAttribute("href");
    const text = await link.textContent();
    console.log(`Footer link ${i + 1}: "${text?.trim()}" -> ${href}`);
  }

  // Check external links have target="_blank" and rel="noopener"
  const externalLinks = footer.locator("a[target='_blank']");
  const externalCount = await externalLinks.count();
  console.log(`External links with target=_blank: ${externalCount}`);

  for (let i = 0; i < externalCount; i++) {
    const rel = await externalLinks.nth(i).getAttribute("rel");
    const href = await externalLinks.nth(i).getAttribute("href");
    const hasNoopener = rel?.includes("noopener") || false;
    console.log(`External link ${href}: rel="${rel}", has noopener: ${hasNoopener}`);
  }
});

// ============================================================
// TEST 13: MOBILE RESPONSIVE (iPhone)
// ============================================================
test("13. Mobile Responsive - iPhone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Full page mobile screenshot
  await page.screenshot({
    path: path.join(RESULTS_DIR, "13a-mobile-hero.png"),
    fullPage: false,
  });

  // Check desktop nav is hidden on mobile
  const desktopNav = page.locator("header >> text=Home");
  const desktopNavVisible = await desktopNav.isVisible().catch(() => false);
  console.log(`Desktop nav visible on mobile: ${desktopNavVisible} (should be false)`);

  // Check mobile bottom nav is visible
  const mobileNav = page.locator("nav.fixed.bottom-0, nav[class*='bottom']");
  const mobileNavVisible = await mobileNav.isVisible().catch(() => false);
  console.log(`Mobile bottom nav visible: ${mobileNavVisible}`);

  // Check mobile bottom nav items
  if (mobileNavVisible) {
    const domovLink = mobileNav.locator("text=Domov");
    const hledatLink = mobileNav.locator("text=Hledat");
    const mapaLink = mobileNav.locator("text=Mapa");
    const alertyBtn = mobileNav.locator("text=Alerty");

    console.log(`Mobile nav 'Domov': ${await domovLink.isVisible().catch(() => false)}`);
    console.log(`Mobile nav 'Hledat': ${await hledatLink.isVisible().catch(() => false)}`);
    console.log(`Mobile nav 'Mapa': ${await mapaLink.isVisible().catch(() => false)}`);
    console.log(`Mobile nav 'Alerty': ${await alertyBtn.isVisible().catch(() => false)}`);
  }

  // Check for horizontal overflow
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  console.log(`Has horizontal overflow: ${hasOverflow}`);

  // Scroll through entire page on mobile
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < document.body.scrollHeight; i += 400) {
      window.scrollTo(0, i);
      await delay(150);
    }
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(RESULTS_DIR, "13b-mobile-full-page.png"),
    fullPage: true,
  });

  // Check search box on mobile
  const searchBox = page.locator('input[placeholder*="Město"]');
  await searchBox.scrollIntoViewIfNeeded();
  const searchVisible = await searchBox.isVisible().catch(() => false);
  console.log(`Search input visible on mobile: ${searchVisible}`);

  // Check "Přidat inzerát" button is hidden on mobile
  const addBtn = page.locator("text=Přidat inzerát");
  const addBtnVisible = await addBtn.isVisible().catch(() => false);
  console.log(`'Přidat inzerát' hidden on mobile: ${!addBtnVisible} (should be true for small mobile)`);

  // Check mobile listings layout
  const cards = page.locator("article");
  const cardCount = await cards.count();
  if (cardCount > 0) {
    // Check cards are stacked vertically (single column)
    const firstCardBox = await cards.first().boundingBox();
    const secondCardBox = cardCount > 1 ? await cards.nth(1).boundingBox() : null;
    if (firstCardBox && secondCardBox) {
      const isStacked = secondCardBox.y > firstCardBox.y + firstCardBox.height - 10;
      console.log(`Cards stacked vertically on mobile: ${isStacked}`);
    }
  }

  // Take mobile footer screenshot
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(RESULTS_DIR, "13c-mobile-footer.png"),
    fullPage: false,
  });

  await context.close();
});

// ============================================================
// TEST 14: TABLET RESPONSIVE
// ============================================================
test("14. Tablet Responsive", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 768, height: 1024 },
  });
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  await page.screenshot({
    path: path.join(RESULTS_DIR, "14a-tablet-hero.png"),
    fullPage: false,
  });

  // Scroll full page
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < document.body.scrollHeight; i += 400) {
      window.scrollTo(0, i);
      await delay(100);
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(RESULTS_DIR, "14b-tablet-full-page.png"),
    fullPage: true,
  });

  // Check for horizontal overflow
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  console.log(`Tablet has horizontal overflow: ${hasOverflow}`);

  // Check grid layout on tablet (should be 2-col for listings)
  const cards = page.locator("article");
  const cardCount = await cards.count();
  if (cardCount >= 2) {
    const first = await cards.first().boundingBox();
    const second = await cards.nth(1).boundingBox();
    if (first && second) {
      const sameRow = Math.abs(first.y - second.y) < 20;
      console.log(`Tablet: First two cards on same row (2-col grid): ${sameRow}`);
    }
  }

  await context.close();
});

// ============================================================
// TEST 15: CONSOLE ERRORS & WARNINGS COLLECTION
// ============================================================
test("15. Console Errors Collection", async ({ page }) => {
  const errors: { type: string; text: string }[] = [];
  const warnings: { type: string; text: string }[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push({ type: "error", text: msg.text() });
    }
    if (msg.type() === "warning") {
      warnings.push({ type: "warning", text: msg.text() });
    }
  });

  page.on("pageerror", (err) => {
    errors.push({ type: "pageerror", text: err.message });
  });

  // Load page
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Scroll entire page to trigger lazy loads
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < document.body.scrollHeight; i += 300) {
      window.scrollTo(0, i);
      await delay(100);
    }
  });
  await page.waitForTimeout(2000);

  // Click a listing card if available
  const cards = page.locator("article");
  if ((await cards.count()) > 0) {
    await cards.first().click();
    await page.waitForTimeout(2000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // Open watchdog modal
  const bellBtn = page.locator("button").filter({ has: page.locator("span.sr-only:has-text('Hlídací pes')") });
  if ((await bellBtn.count()) > 0) {
    await bellBtn.first().click();
    await page.waitForTimeout(1000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  console.log("\n=== CONSOLE ERRORS ===");
  if (errors.length === 0) {
    console.log("No console errors found");
  } else {
    errors.forEach((e, i) => {
      console.log(`Error ${i + 1} [${e.type}]: ${e.text.substring(0, 200)}`);
    });
  }

  console.log("\n=== CONSOLE WARNINGS ===");
  if (warnings.length === 0) {
    console.log("No console warnings found");
  } else {
    warnings.forEach((w, i) => {
      console.log(`Warning ${i + 1}: ${w.text.substring(0, 200)}`);
    });
  }

  // Write full error report
  fs.writeFileSync(
    path.join(RESULTS_DIR, "console-errors-report.json"),
    JSON.stringify({ errors, warnings }, null, 2)
  );
});

// ============================================================
// TEST 16: BROKEN IMAGES CHECK
// ============================================================
test("16. Broken Images Check", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Scroll full page to load all lazy images
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < document.body.scrollHeight; i += 300) {
      window.scrollTo(0, i);
      await delay(100);
    }
  });
  await page.waitForTimeout(2000);

  const imageReport = await page.evaluate(() => {
    const images = document.querySelectorAll("img");
    const report: { src: string; naturalWidth: number; naturalHeight: number; complete: boolean; broken: boolean }[] = [];
    images.forEach((img) => {
      const htmlImg = img as HTMLImageElement;
      report.push({
        src: htmlImg.src.substring(0, 100),
        naturalWidth: htmlImg.naturalWidth,
        naturalHeight: htmlImg.naturalHeight,
        complete: htmlImg.complete,
        broken: htmlImg.complete && htmlImg.naturalWidth === 0,
      });
    });
    return report;
  });

  const totalImages = imageReport.length;
  const brokenImages = imageReport.filter((img) => img.broken);
  const loadingImages = imageReport.filter((img) => !img.complete);

  console.log(`Total images on page: ${totalImages}`);
  console.log(`Broken images: ${brokenImages.length}`);
  console.log(`Still loading images: ${loadingImages.length}`);

  if (brokenImages.length > 0) {
    console.log("\nBroken image details:");
    brokenImages.forEach((img, i) => {
      console.log(`  ${i + 1}. ${img.src}`);
    });
  }
});

// ============================================================
// TEST 17: LAYOUT OVERFLOW CHECK
// ============================================================
test("17. Layout & Overflow Check", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  // Check viewport overflow at various widths
  const viewports = [
    { width: 320, height: 568, name: "iPhone SE" },
    { width: 375, height: 812, name: "iPhone 13" },
    { width: 768, height: 1024, name: "iPad" },
    { width: 1024, height: 768, name: "iPad Landscape" },
    { width: 1440, height: 900, name: "Laptop" },
    { width: 1920, height: 1080, name: "Desktop" },
  ];

  const overflowResults: { name: string; width: number; hasOverflow: boolean; scrollWidth: number; clientWidth: number }[] = [];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));

    overflowResults.push({
      name: vp.name,
      width: vp.width,
      ...overflow,
    });

    console.log(
      `${vp.name} (${vp.width}px): overflow=${overflow.hasOverflow}, scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}`
    );
  }

  // Take a wide desktop screenshot
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(RESULTS_DIR, "17-desktop-1920.png"),
    fullPage: false,
  });
});

// ============================================================
// TEST 18: ACCESSIBILITY BASICS
// ============================================================
test("18. Accessibility Basics", async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  const a11yReport = await page.evaluate(() => {
    const issues: string[] = [];

    // Check images without alt text
    const imgs = document.querySelectorAll("img");
    let imgsWithoutAlt = 0;
    imgs.forEach((img) => {
      if (!img.hasAttribute("alt")) {
        imgsWithoutAlt++;
        issues.push(`Image without alt: ${(img as HTMLImageElement).src.substring(0, 80)}`);
      }
    });

    // Check buttons without accessible names
    const buttons = document.querySelectorAll("button");
    let buttonsWithoutName = 0;
    buttons.forEach((btn) => {
      const text = btn.textContent?.trim();
      const ariaLabel = btn.getAttribute("aria-label");
      const srOnly = btn.querySelector(".sr-only");
      if (!text && !ariaLabel && !srOnly) {
        buttonsWithoutName++;
        issues.push(`Button without accessible name: ${btn.className.substring(0, 60)}`);
      }
    });

    // Check inputs without labels
    const inputs = document.querySelectorAll("input");
    let inputsWithoutLabel = 0;
    inputs.forEach((input) => {
      const id = input.id;
      const label = id ? document.querySelector(`label[for="${id}"]`) : null;
      const ariaLabel = input.getAttribute("aria-label");
      const placeholder = input.getAttribute("placeholder");
      if (!label && !ariaLabel && !placeholder) {
        inputsWithoutLabel++;
        issues.push(`Input without label: ${input.className.substring(0, 60)}`);
      }
    });

    // Check heading hierarchy
    const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
    const headingLevels: number[] = [];
    headings.forEach((h) => {
      headingLevels.push(parseInt(h.tagName.substring(1)));
    });

    // Check for multiple h1s
    const h1Count = headingLevels.filter((l) => l === 1).length;

    // Check for skipped heading levels
    let skippedLevels = false;
    for (let i = 1; i < headingLevels.length; i++) {
      if (headingLevels[i] > headingLevels[i - 1] + 1) {
        skippedLevels = true;
        issues.push(`Skipped heading level: h${headingLevels[i - 1]} -> h${headingLevels[i]}`);
      }
    }

    // Check color contrast (basic check for text visibility)
    const focusableElements = document.querySelectorAll("a, button, input, select, textarea");
    let focusableWithoutOutline = 0;

    return {
      imgsWithoutAlt,
      buttonsWithoutName,
      inputsWithoutLabel,
      h1Count,
      skippedHeadingLevels: skippedLevels,
      headingLevels,
      totalIssues: issues.length,
      issues: issues.slice(0, 20), // Limit output
    };
  });

  console.log("\n=== ACCESSIBILITY REPORT ===");
  console.log(`Images without alt: ${a11yReport.imgsWithoutAlt}`);
  console.log(`Buttons without accessible name: ${a11yReport.buttonsWithoutName}`);
  console.log(`Inputs without label: ${a11yReport.inputsWithoutLabel}`);
  console.log(`H1 count: ${a11yReport.h1Count} (should be 1)`);
  console.log(`Skipped heading levels: ${a11yReport.skippedHeadingLevels}`);
  console.log(`Heading hierarchy: ${a11yReport.headingLevels.join(" -> ")}`);
  console.log(`Total a11y issues: ${a11yReport.totalIssues}`);

  if (a11yReport.issues.length > 0) {
    console.log("\nDetailed issues:");
    a11yReport.issues.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue}`);
    });
  }
});

// ============================================================
// TEST 19: NETWORK API CALLS
// ============================================================
test("19. Network API Calls", async ({ page }) => {
  const apiCalls: { url: string; method: string; status: number; duration: number }[] = [];
  const requestTimings = new Map<string, number>();

  page.on("request", (req) => {
    if (req.url().includes("/api/") || req.url().includes("/listings") || req.url().includes("/stats")) {
      requestTimings.set(req.url() + req.method(), Date.now());
    }
  });

  page.on("response", (res) => {
    const key = res.url() + res.request().method();
    const startTime = requestTimings.get(key);
    if (startTime && (res.url().includes("/api/") || res.url().includes("/listings") || res.url().includes("/stats"))) {
      apiCalls.push({
        url: res.url(),
        method: res.request().method(),
        status: res.status(),
        duration: Date.now() - startTime,
      });
    }
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  console.log("\n=== API CALLS ===");
  if (apiCalls.length === 0) {
    console.log("No API calls detected");
  } else {
    apiCalls.forEach((call, i) => {
      const urlShort = call.url.length > 100 ? call.url.substring(0, 100) + "..." : call.url;
      console.log(`${i + 1}. ${call.method} ${urlShort} -> ${call.status} (${call.duration}ms)`);
    });
  }

  // Check for failed API calls
  const failedCalls = apiCalls.filter((c) => c.status >= 400);
  console.log(`\nFailed API calls: ${failedCalls.length}`);
  failedCalls.forEach((c) => {
    console.log(`  FAILED: ${c.method} ${c.url} -> ${c.status}`);
  });
});
