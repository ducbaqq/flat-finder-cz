/**
 * Unit tests for Phase 2 — image refresh sweep.
 *
 * We only exercise the pure DB-row-to-ScraperResult shim here; importing
 * runImageRefreshSweep directly would pull in @flat-finder/db through
 * refresh.ts, and Playwright's ESM loader can't resolve that package's
 * restricted exports field at test time (tsc builds, the production
 * scraper runs fine — this is a test-loader limitation, not a code bug).
 *
 * The engine itself is validated against production in dry-run mode via
 * a follow-up ops step; see the Session Log in the Obsidian note for the
 * dry-run procedure.
 */

import { test, expect } from "@playwright/test";
import type { ListingRow } from "../packages/db/src/schema/listings.js";
import { rowToScraperResult } from "../apps/scraper/src/row-to-scraper-result.js";

function makeRow(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 1,
    external_id: "test_1",
    source: "idnes",
    property_type: "flat",
    transaction_type: "sale",
    title: "Test",
    description: "desc",
    price: 1_000_000,
    currency: "CZK",
    price_note: null,
    address: "Test 1",
    city: "Praha",
    district: null,
    region: null,
    latitude: 50.0,
    longitude: 14.0,
    size_m2: 50,
    layout: "2+kk",
    floor: 3,
    total_floors: 8,
    condition: null,
    construction: null,
    ownership: null,
    furnishing: null,
    energy_rating: null,
    amenities: null,
    image_urls: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
    thumbnail_url: "https://cdn.example/thumb.jpg",
    source_url: "https://idnes.cz/detail/1",
    listed_at: null,
    scraped_at: "2026-04-20T00:00:00.000Z",
    enriched_at: "2026-04-20T00:00:00.000Z",
    last_checked_at: null,
    last_image_checked_at: null,
    is_active: true,
    deactivated_at: null,
    deactivation_reason: null,
    seller_name: null,
    seller_phone: null,
    seller_email: null,
    seller_company: null,
    additional_params: null,
    cluster_id: null,
    is_canonical: true,
    match_hash: null,
    created_at: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

test.describe("rowToScraperResult", () => {
  test("image_urls: array → JSON string", () => {
    const stub = rowToScraperResult(
      makeRow({ image_urls: ["https://a", "https://b"] }),
    );
    expect(typeof stub.image_urls).toBe("string");
    expect(JSON.parse(stub.image_urls)).toEqual(["https://a", "https://b"]);
  });

  test("image_urls: null → '[]'", () => {
    const stub = rowToScraperResult(makeRow({ image_urls: null }));
    expect(stub.image_urls).toBe("[]");
  });

  test("additional_params: object → JSON string", () => {
    const stub = rowToScraperResult(
      makeRow({ additional_params: { gps_approximate: "true" } }),
    );
    expect(typeof stub.additional_params).toBe("string");
    expect(JSON.parse(stub.additional_params as string)).toEqual({
      gps_approximate: "true",
    });
  });

  test("additional_params: null stays null", () => {
    const stub = rowToScraperResult(makeRow({ additional_params: null }));
    expect(stub.additional_params).toBeNull();
  });

  test("currency defaults to CZK when null", () => {
    const stub = rowToScraperResult(makeRow({ currency: null }));
    expect(stub.currency).toBe("CZK");
  });

  test("scraped_at is refreshed to now, enriched_at is preserved", () => {
    const row = makeRow({
      scraped_at: "2020-01-01T00:00:00.000Z",
      enriched_at: "2020-01-02T00:00:00.000Z",
    });
    const before = Date.now();
    const stub = rowToScraperResult(row);
    const after = Date.now();

    const stubScrapedMs = new Date(stub.scraped_at).getTime();
    expect(stubScrapedMs).toBeGreaterThanOrEqual(before);
    expect(stubScrapedMs).toBeLessThanOrEqual(after);

    // enriched_at must survive untouched — stampEnrichedAt runs AFTER
    // enrichment only on rows that actually picked up new fields, so
    // the shim must never pre-seed it with "now".
    expect(stub.enriched_at).toBe("2020-01-02T00:00:00.000Z");
  });

  test("external_id is preserved (upsert target)", () => {
    const stub = rowToScraperResult(makeRow({ external_id: "idnes_abc123" }));
    expect(stub.external_id).toBe("idnes_abc123");
  });

  test("is_active defaults to true when null", () => {
    const stub = rowToScraperResult(makeRow({ is_active: null }));
    expect(stub.is_active).toBe(true);
  });
});
