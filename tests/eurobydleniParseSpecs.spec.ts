import { test, expect } from "@playwright/test";
import { EurobydleniScraper } from "../apps/scraper/src/scrapers/eurobydleni.js";
import type { ScraperResult } from "@flat-finder/types";

// Real box-params snippet captured from
// https://www.eurobydleni.cz/.../detail/10112310/ on 2026-04-21.
// All 15 dl/dt/dd pairs observed in production, verbatim.
const REAL_BOX_PARAMS = `
<div class="box-params">
  <dl><dt>Evidenční číslo:</dt><dd>00350</dd></dl>
  <dl><dt>Typ:</dt><dd>Byty, 1+kk pronájem</dd></dl>
  <dl><dt>Adresa:</dt><dd>Bučkova, Slatina, Brno, Brno-město</dd></dl>
  <dl><dt>Cena:</dt><dd>14 500Kč/měs</dd></dl>
  <dl><dt>Poznámka k ceně:</dt><dd>+ energie, provize</dd></dl>
  <dl><dt>Vlastnictví:</dt><dd>Osobní</dd></dl>
  <dl><dt>Stav:</dt><dd>Novostavba</dd></dl>
  <dl><dt>Umístění:</dt><dd>Klidná část obce</dd></dl>
  <dl><dt>Typ budovy:</dt><dd>Řadový</dd></dl>
  <dl><dt>Konstrukce:</dt><dd>Cihlová</dd></dl>
  <dl><dt>Plocha užitná:</dt><dd>28 m<sup>2</sup></dd></dl>
  <dl><dt>Plocha sklepa:</dt><dd>2 m<sup>2</sup></dd></dl>
  <dl><dt>Plocha terasy:</dt><dd>17 m<sup>2</sup></dd></dl>
  <dl><dt>Patro, podlaží:</dt><dd>1. podlaží</dd></dl>
  <dl><dt>Typ objektu:</dt><dd>přízemní</dd></dl>
</div>
`;

function emptyListing(): ScraperResult {
  return {
    external_id: "eurobydleni_test",
    source: "eurobydleni",
    property_type: "flat",
    transaction_type: "rent",
    title: null,
    description: null,
    price: null,
    currency: "CZK",
    price_note: null,
    address: null,
    city: null,
    district: null,
    region: null,
    latitude: null,
    longitude: null,
    size_m2: null,
    layout: null,
    floor: null,
    total_floors: null,
    condition: null,
    construction: null,
    ownership: null,
    furnishing: null,
    energy_rating: null,
    amenities: null,
    image_urls: "[]",
    thumbnail_url: null,
    source_url: null,
    listed_at: null,
    scraped_at: new Date().toISOString(),
    is_active: true,
    deactivated_at: null,
    seller_name: null,
    seller_phone: null,
    seller_email: null,
    seller_company: null,
    additional_params: null,
  } as unknown as ScraperResult;
}

test.describe("EurobydleniScraper parsePropertyBlock — real box-params", () => {
  const scraper = new EurobydleniScraper({
    rps: 1,
    concurrency: 1,
    maxRetries: 0,
    retryBaseMs: 0,
    timeoutMs: 1_000,
  });

  test("extracts size_m2 from 'Plocha užitná' — not from sklepa/terasy", () => {
    const l = emptyListing();
    // Exposes the private method via cast for test purposes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scraper as any).parsePropertyBlock(l, REAL_BOX_PARAMS);

    expect(l.size_m2).toBe(28);
    expect(l.floor).toBe(1);
    expect(l.ownership).toBe("Osobní");
    expect(l.construction).toBe("Cihlová");
    expect(l.condition).toBe("Novostavba");
  });

  test("ignores Plocha sklepa / terasy — they must not overwrite size_m2", () => {
    const l = emptyListing();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scraper as any).parsePropertyBlock(l, REAL_BOX_PARAMS);
    // If the parser wrongly used the last "Plocha *" match, size_m2 would
    // become 17 (terrace) or 2 (cellar). Must remain 28.
    expect(l.size_m2).toBe(28);
    expect(l.size_m2).not.toBe(2);
    expect(l.size_m2).not.toBe(17);
  });

  test("doesn't touch size_m2 when block only has sklepa/terasy (defensive)", () => {
    const l = emptyListing();
    const html = `
      <div class="box-params">
        <dl><dt>Plocha sklepa:</dt><dd>2 m<sup>2</sup></dd></dl>
        <dl><dt>Plocha terasy:</dt><dd>17 m<sup>2</sup></dd></dl>
      </div>
    `;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scraper as any).parsePropertyBlock(l, html);
    expect(l.size_m2).toBeNull();
  });

  test("energy rating: 'C - Úsporná' → 'C'", () => {
    const l = emptyListing();
    const html = `
      <div class="box-params">
        <dl><dt>Třída en. náročnosti:</dt><dd>C - Úsporná</dd></dl>
      </div>
    `;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scraper as any).parsePropertyBlock(l, html);
    expect(l.energy_rating).toBe("C");
  });

  test("furnishing mapping: Ano → furnished, Částečně → partially, Ne → unfurnished", () => {
    const mk = (value: string) =>
      `<div class="box-params"><dl><dt>Vybavení:</dt><dd>${value}</dd></dl></div>`;

    const a = emptyListing();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scraper as any).parsePropertyBlock(a, mk("Ano"));
    expect(a.furnishing).toBe("furnished");

    const b = emptyListing();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scraper as any).parsePropertyBlock(b, mk("Částečně"));
    expect(b.furnishing).toBe("partially");

    const c = emptyListing();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scraper as any).parsePropertyBlock(c, mk("Ne"));
    expect(c.furnishing).toBe("unfurnished");
  });
});
