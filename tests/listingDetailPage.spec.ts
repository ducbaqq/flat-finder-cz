/**
 * SEO detail-page smoke test. Verifies the canonical /listing/[id] route
 * serves:
 *   - h1 title (visible or sr-only)
 *   - meta description
 *   - canonical <link>
 *   - OG + Twitter meta tags
 *   - JSON-LD RealEstateListing script
 *   - "Zpět na výsledky" back link to /search
 *
 * Picks a real listing id from /api/listings?per_page=1 so the test is
 * robust against schema/data churn — no hard-coded id. The scraper is
 * always populating data on the droplet so we assume at least one
 * active listing exists.
 */
import { test, expect } from "@playwright/test";

test.describe("SEO detail page — /listing/[id]", () => {
  let listingId: number | null = null;

  test.beforeAll(async ({ request }) => {
    const res = await request.get("/api/listings?per_page=1");
    if (!res.ok()) {
      throw new Error(
        `GET /api/listings failed (${res.status()}). Is the API + web dev server running?`,
      );
    }
    const body = (await res.json()) as { listings: Array<{ id: number }> };
    if (!body.listings || body.listings.length === 0) {
      throw new Error(
        "No listings returned from /api/listings — cannot smoke-test SEO page",
      );
    }
    listingId = body.listings[0].id;
  });

  test("serves complete SEO metadata and visible content", async ({ page }) => {
    if (!listingId) test.skip();
    await page.goto(`/listing/${listingId}`, { waitUntil: "domcontentloaded" });

    // Article + back-link render
    await expect(page.locator("[data-testid='listing-detail-article']")).toBeVisible();
    await expect(page.locator("[data-testid='listing-detail-back']")).toBeVisible();

    // h1 exists (we render it sr-only at page level, plus the visible h1
    // inside ListingDetailContent). Pick any h1 on the page.
    const h1Count = await page.locator("h1").count();
    expect(h1Count).toBeGreaterThanOrEqual(1);

    // Title contains the Bytomat suffix via template
    const title = await page.title();
    expect(title.length).toBeGreaterThan(5);
    expect(title).toContain("Bytomat");

    // Canonical link points at the public site URL + our id
    const canonical = page.locator("link[rel='canonical']");
    await expect(canonical).toHaveCount(1);
    const canonicalHref = await canonical.getAttribute("href");
    expect(canonicalHref).toMatch(
      new RegExp(`/listing/${listingId}$`),
    );

    // Meta description is present and non-empty
    const metaDesc = await page
      .locator("meta[name='description']")
      .getAttribute("content");
    expect(metaDesc).toBeTruthy();
    expect((metaDesc ?? "").length).toBeGreaterThan(10);

    // Open Graph tags
    const ogTitle = await page
      .locator("meta[property='og:title']")
      .getAttribute("content");
    expect(ogTitle).toBeTruthy();
    const ogType = await page
      .locator("meta[property='og:type']")
      .getAttribute("content");
    expect(ogType).toBe("website");
    const ogLocale = await page
      .locator("meta[property='og:locale']")
      .getAttribute("content");
    expect(ogLocale).toBe("cs_CZ");

    // Twitter card
    const twitterCard = await page
      .locator("meta[name='twitter:card']")
      .getAttribute("content");
    expect(twitterCard).toBe("summary_large_image");

    // JSON-LD structured data
    const jsonLd = page.locator("[data-testid='listing-jsonld']");
    await expect(jsonLd).toHaveCount(1);
    const jsonLdText = await jsonLd.textContent();
    expect(jsonLdText).toBeTruthy();
    const parsed = JSON.parse(jsonLdText ?? "{}");
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@type"]).toBe("RealEstateListing");
    expect(parsed.url).toMatch(
      new RegExp(`/listing/${listingId}$`),
    );
    expect(parsed.mainEntity).toBeTruthy();
    expect(parsed.offers).toBeTruthy();
  });

  test("back link points at /search", async ({ page }) => {
    if (!listingId) test.skip();
    await page.goto(`/listing/${listingId}`, { waitUntil: "domcontentloaded" });
    // Can't actually follow the click in this test harness because the
    // site-wide password gate middleware kicks /search → /login for
    // unauthenticated sessions. Asserting the href is enough to prove
    // the back-link's target is correctly wired.
    const href = await page
      .locator("[data-testid='listing-detail-back']")
      .getAttribute("href");
    expect(href).toBe("/search");
  });

  test("unknown id 404s", async ({ page }) => {
    const res = await page.goto("/listing/999999999", {
      waitUntil: "domcontentloaded",
    });
    // Next's notFound() returns 404 status and renders the not-found page
    expect(res?.status()).toBe(404);
  });
});
