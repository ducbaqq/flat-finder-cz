import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import pLimit from "p-limit";
import type { ScraperResult, PropertyType, TransactionType } from "@flat-finder/types";
import { BaseScraper, type ScraperOptions, type PageResult } from "../base-scraper.js";
import { normalizeAmenities } from "../amenity-normalizer.js";

/**
 * Category definitions: [urlPath, propertyType, transactionType]
 */
/**
 * Pull a square-meter value out of a eurobydleni title string.
 *
 * Eurobydleni titles embed the size in many wordings and frequently drop
 * the "²" exponent. Observed patterns:
 *   "Prodej bytu 2+1, 51 m, Aš, Moravská"                    (bare "51 m")
 *   "Byt 4+1 na prodej Znojmo o výměře 156 m2"
 *   "... s rozlohou 113 m2 ..."
 *   "... o velikosti 109 m2 ..."
 *   "... a plochou 79 m²"
 *
 * Strategy: scan for "<digits> m[²2]?" matches, prefer the one adjacent to
 * an area-keyword (plocha / výměra / rozloha / velikost) when present, else
 * fall back to the first match whose number is in a plausible apartment
 * range (10–1000). Bounds filter out street numbers like "bytu 151".
 */
export function extractSizeFromEurobydleniTitle(title: string): number | null {
  const t = title.toLowerCase();
  const pattern = /(\d{2,4})\s*m(?:[²2])?(?=\b|[\s,.])/gi;
  const matches: Array<{ value: number; idx: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(t)) !== null) {
    const v = parseInt(m[1], 10);
    if (v >= 10 && v <= 2000) matches.push({ value: v, idx: m.index });
  }
  if (matches.length === 0) return null;

  const keywords = ["plocha", "ploch", "výměr", "vymer", "rozloh", "velikost"];
  for (const { value, idx } of matches) {
    // Look back up to 40 chars for an area keyword.
    const window = t.slice(Math.max(0, idx - 40), idx);
    if (keywords.some((k) => window.includes(k))) return value;
  }
  // Fallback: first plausible match.
  return matches[0].value;
}

const CATEGORIES: [string, PropertyType, TransactionType][] = [
  // Sale
  ["byty/prodej", "flat", "sale"],
  ["domy/prodej", "house", "sale"],
  ["pozemky/prodej", "land", "sale"],
  ["komercni-nemovitosti/prodej", "commercial", "sale"],
  ["rekreacni-objekty/prodej", "cottage", "sale"],
  ["ostatni/prodej", "other", "sale"],
  // Rent
  ["byty/pronajem", "flat", "rent"],
  ["domy/pronajem", "house", "rent"],
  ["pozemky/pronajem", "land", "rent"],
  ["komercni-nemovitosti/pronajem", "commercial", "rent"],
  ["rekreacni-objekty/pronajem", "cottage", "rent"],
  ["ostatni/pronajem", "other", "rent"],
];

interface PropertyApiResponse {
  setUrl: string;
  closeUrl: string;
  propertyBlock: string;
  location: { lat: number; lng: number };
  metatags: Record<string, string>;
  gpfCalculator: { cena_nemovitosti: number };
  pageTitle: string;
}

export class EurobydleniScraper extends BaseScraper {
  readonly name = "eurobydleni";
  readonly baseUrl = "https://www.eurobydleni.cz";

  override get hasDetailPhase() { return true; }

  constructor(opts: ScraperOptions) {
    super(opts);
  }

  // ─── Phase 1: List Scan ───────────────────────────────────────────

  async *fetchPages(): AsyncGenerator<PageResult> {
    this.init();
    for (const [urlPath, propertyType, transactionType] of CATEGORIES) {
      try {
        yield* this.fetchCategoryPages(urlPath, propertyType, transactionType);
      } catch (err) {
        this.log(`Error scraping category ${urlPath}: ${err}`);
      }
    }
  }

  private async *fetchCategoryPages(
    urlPath: string,
    propertyType: PropertyType,
    transactionType: TransactionType,
  ): AsyncGenerator<PageResult> {
    // Fetch first page to extract total page count
    const firstUrl = `${this.baseUrl}/${urlPath}/`;
    let firstHtml: string;
    try {
      firstHtml = await this.http.getHtml(firstUrl);
    } catch (err) {
      this.log(`Error fetching first page of ${urlPath}: ${err}`);
      return;
    }

    const totalPages = this.extractTotalPages(firstHtml);
    this.log(`Category ${urlPath}: ${totalPages} total pages`);

    // Parse first page
    const firstDoc = parseHtml(firstHtml);
    const firstListings = this.parseListPage(firstDoc, propertyType, transactionType);

    if (firstListings.length === 0) {
      this.log(`No listings on first page for ${urlPath}, skipping category`);
      return;
    }

    yield { category: urlPath, page: 1, totalPages, listings: firstListings };

    if (totalPages <= 1) return;

    // Batch-concurrent fetching of subsequent pages
    const batchSize = this.concurrency * 2;
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

    for (let bStart = 0; bStart < remaining.length; bStart += batchSize) {
      if (this.isCategorySkipped(urlPath)) return;
      const batchPages = remaining.slice(bStart, bStart + batchSize);

      const pagePromises = batchPages.map((page) =>
        this.limiter(async () => {
          const url = `${this.baseUrl}/${urlPath}/page-${page}/`;
          try {
            return { page, html: await this.http.getHtml(url) };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("404") || msg.includes("410")) {
              this.log(`No more pages for ${urlPath} (got ${msg})`);
            } else {
              this.log(`Error fetching ${url}: ${msg}`);
            }
            return { page, html: null };
          }
        }),
      );

      const pageResults = await Promise.all(pagePromises);

      for (const { page, html } of pageResults) {
        if (this.isCategorySkipped(urlPath)) return;
        if (!html) continue;

        const doc = parseHtml(html);
        const listings = this.parseListPage(doc, propertyType, transactionType);

        if (listings.length === 0) continue;

        yield { category: urlPath, page, totalPages, listings };
      }
    }
  }

  private extractTotalPages(html: string): number {
    // Look for "Stránka X z Y" pattern in pagination
    const match = html.match(/Str[aá]nka\s+\d+\s+z\s+(\d+)/i);
    if (match) return parseInt(match[1], 10);

    // Fallback: look for the highest page-N link
    let maxPage = 0;
    let m: RegExpExecArray | null;
    const pageRe = /\/page-(\d+)\//g;
    while ((m = pageRe.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > maxPage) maxPage = n;
    }
    if (maxPage > 0) return maxPage;

    return 1;
  }

  private parseListPage(
    doc: HTMLElement,
    propertyType: PropertyType,
    transactionType: TransactionType,
  ): ScraperResult[] {
    const listingEls = doc.querySelectorAll("li.list-items__item");
    const results: ScraperResult[] = [];

    for (const el of listingEls) {
      try {
        const listing = this.parseListingElement(el, propertyType, transactionType);
        if (listing) results.push(listing);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`Error parsing listing: ${msg}`);
      }
    }

    return results;
  }

  private parseListingElement(
    el: HTMLElement,
    propertyType: PropertyType,
    transactionType: TransactionType,
  ): ScraperResult | null {
    // Extract numeric ID from itemid or detail link
    let numericId: string | null = null;

    const itemId = el.getAttribute("itemid") || "";
    const idMatch = itemId.match(/\/detail\/(\d+)\//);
    if (idMatch) {
      numericId = idMatch[1];
    } else {
      const detailLink = el.querySelector("a.js-simulate-link-target");
      const href = detailLink?.getAttribute("href") || "";
      const linkMatch = href.match(/\/detail\/(\d+)\//);
      if (linkMatch) numericId = linkMatch[1];
    }

    if (!numericId) return null;

    const externalId = `eurobydleni_${numericId}`;

    // Title
    const titleEl = el.querySelector("h2.list-items__item__title a");
    const title = titleEl?.text?.trim() || null;

    // Detail URL
    const detailHref = titleEl?.getAttribute("href") || itemId;
    const sourceUrl = detailHref ? `${this.baseUrl}${detailHref}` : null;

    // Price from schema.org meta. eurobydleni encodes "Info v RK" (price
    // on request) as the sentinel 999999999 — treat that as null + note,
    // not as a 999M CZK listing.
    const priceMeta = el.querySelector('meta[itemprop="price"]');
    const priceStr = priceMeta?.getAttribute("content") || null;
    const priceRaw = priceStr ? parseFloat(priceStr) : null;
    const isPriceOnRequest = priceRaw === 999_999_999;
    const price = isPriceOnRequest || priceRaw == null || isNaN(priceRaw)
      ? null
      : priceRaw;
    const priceNote = isPriceOnRequest ? "Info v RK" : null;

    // Currency
    const currencyMeta = el.querySelector('meta[itemprop="priceCurrency"]');
    const currency = currencyMeta?.getAttribute("content") || "CZK";

    // Description from meta
    const descMeta = el.querySelector('meta[itemprop="description"]');
    const description = descMeta?.getAttribute("content") || null;

    // Geo coordinates
    const latMeta = el.querySelector('meta[itemprop="latitude"]');
    const lngMeta = el.querySelector('meta[itemprop="longitude"]');
    const latitude = latMeta ? parseFloat(latMeta.getAttribute("content") || "") : null;
    const longitude = lngMeta ? parseFloat(lngMeta.getAttribute("content") || "") : null;

    // Address from schema.org
    const streetMeta = el.querySelector('meta[itemprop="streetAddress"]');
    const localityMeta = el.querySelector('meta[itemprop="addressLocality"]');
    const regionMeta = el.querySelector('meta[itemprop="addressRegion"]');
    const postalCodeMeta = el.querySelector('meta[itemprop="postalCode"]');

    const streetAddress = streetMeta?.getAttribute("content") || null;
    const locality = localityMeta?.getAttribute("content") || null;
    const region = regionMeta?.getAttribute("content") || null;
    const postalCode = postalCodeMeta?.getAttribute("content") || null;

    // Build address string
    const addressParts: string[] = [];
    if (streetAddress) addressParts.push(streetAddress);
    if (locality) addressParts.push(locality);
    if (postalCode) addressParts.push(postalCode);
    const address = addressParts.length > 0 ? addressParts.join(", ") : null;

    // City / District from locality (e.g. "Praha 5, Hlubočepy")
    const city = locality ? locality.split(",")[0].trim() : null;
    const localityParts = locality?.split(",").map((s) => s.trim()) || [];
    const district = localityParts.length > 1 ? localityParts[1] : null;

    // Images — only accept absolute http(s) URLs. Eurobydleni's list-tile
    // <img src> is sometimes a relative placeholder path like
    // "/mlift/images/missing.png"; keeping those poisons the thumbnail with
    // a URL that 404s against our app host. `enrichOne` unconditionally
    // replaces this with the first detail-page image anyway.
    const imageEls = el.querySelectorAll("figure.list-items__item__image img");
    const imageUrls: string[] = [];
    for (const img of imageEls) {
      let src = img.getAttribute("src") || "";
      if (src.startsWith("//")) src = `https:${src}`;
      if (src && /^https?:\/\//i.test(src)) imageUrls.push(src);
    }
    const thumbnailUrl = imageUrls.length > 0 ? imageUrls[0] : null;

    // Footer items (layout, ownership, construction, size, floor, condition)
    const footerItems = el.querySelectorAll(".list-items__content__footer--link");
    let layout: string | null = null;
    let ownership: string | null = null;
    let construction: string | null = null;
    let sizeM2: number | null = null;
    let floor: number | null = null;
    let condition: string | null = null;
    const amenitiesList: string[] = [];

    for (const item of footerItems) {
      const text = item.text.trim();
      if (!text) continue;

      if (/^\d\+\d$|^\d\+kk$/i.test(text) || /^garson/i.test(text) || /^atyp/i.test(text)) {
        layout = text;
        continue;
      }

      // Eurobydleni sometimes drops the "²" ("51 m"). Allow optional 2/²
      // but require a word boundary so we don't match street numbers.
      const sizeMatch = text.match(/([\d.,]+)\s*m(?:[²2])?(?=\b|[\s,.])/i);
      if (sizeMatch) {
        sizeM2 = parseFloat(sizeMatch[1].replace(",", "."));
        continue;
      }

      const floorMatch = text.match(/^(\d+)\.\s*podlaží$/i);
      if (floorMatch) {
        floor = parseInt(floorMatch[1], 10);
        continue;
      }

      if (text.startsWith("konstrukce:")) {
        construction = text.replace("konstrukce:", "").trim();
        continue;
      }

      if (text.startsWith("stav:")) {
        condition = text.replace("stav:", "").trim();
        continue;
      }

      if (/^(Osobní|Družstevní|Státní)$/i.test(text)) {
        ownership = text;
        continue;
      }

      if (text.startsWith("lokalita:")) continue;

      amenitiesList.push(text);
    }

    const now = new Date().toISOString();

    return {
      external_id: externalId,
      source: "eurobydleni",
      property_type: propertyType,
      transaction_type: transactionType,
      title,
      description,
      price,
      currency,
      price_note: priceNote,
      address,
      city,
      district,
      region: region !== "Česká republika" ? region : null,
      latitude: latitude && !isNaN(latitude) ? latitude : null,
      longitude: longitude && !isNaN(longitude) ? longitude : null,
      size_m2: sizeM2,
      layout,
      floor,
      total_floors: null,
      condition,
      construction,
      ownership,
      furnishing: null,
      energy_rating: null,
      amenities: normalizeAmenities(amenitiesList.length > 0 ? JSON.stringify(amenitiesList) : null),
      image_urls: JSON.stringify(imageUrls),
      thumbnail_url: thumbnailUrl,
      source_url: sourceUrl,
      listed_at: null,
      scraped_at: now,
      is_active: true,
      deactivated_at: null,
      seller_name: null,
      seller_phone: null,
      seller_email: null,
      seller_company: null,
      additional_params: JSON.stringify({
        ...(postalCode ? { postal_code: postalCode } : {}),
        numeric_id: numericId,
      }),
    };
  }

  // ─── Phase 2: Detail Enrichment via property.php API ──────────────

  override async enrichListings(
    listings: ScraperResult[],
    opts?: { concurrency?: number; batchSize?: number },
  ): Promise<void> {
    this.init();
    this.log(`Enriching ${listings.length} new listings via property.php API...`);
    const limit = opts?.concurrency ? pLimit(opts.concurrency) : this.limiter;
    await Promise.all(
      listings.map((listing) => limit(() => this.enrichOne(listing))),
    );

    const withGps = listings.filter((l) => l.latitude !== null).length;
    this.log(`Enrichment complete: ${withGps}/${listings.length} with GPS`);
  }

  private async enrichOne(listing: ScraperResult): Promise<void> {
    const params = listing.additional_params ? JSON.parse(listing.additional_params) : {};
    const numericId = params.numeric_id;
    if (!numericId) return;

    let data: PropertyApiResponse;
    try {
      data = await this.http.get<PropertyApiResponse>(
        `${this.baseUrl}/mlift/api/property.php?propertyId=${numericId}`,
      );
    } catch (err) {
      this.log(`API enrichment failed for ${listing.external_id}: ${err}`);
      return;
    }

    // GPS from API location
    if (data.location?.lat && data.location?.lng) {
      const { lat, lng } = data.location;
      if (lat >= 48 && lat <= 52 && lng >= 12 && lng <= 19) {
        listing.latitude = lat;
        listing.longitude = lng;
      }
    }

    // Canonical title and URL
    if (data.pageTitle) listing.title = data.pageTitle;
    if (data.setUrl) listing.source_url = `${this.baseUrl}${data.setUrl}`;

    // Thumbnail from metatags. Eurobydleni's og:image is often
    // protocol-relative ("//www.eurobydleni.cz/..."), which renders fine
    // under https but `LIKE 'http%'` checks reject it. Normalize.
    if (data.metatags?.["og:image"]) {
      let og = data.metatags["og:image"];
      if (og.startsWith("//")) og = `https:${og}`;
      listing.thumbnail_url = og;
    }

    // Parse the propertyBlock HTML for rich data
    if (data.propertyBlock) {
      this.parsePropertyBlock(listing, data.propertyBlock);
    }

    // Title is the only reliable place size_m2 appears for most eurobydleni
    // listings — box-params doesn't expose it, and the site frequently drops
    // the "²" exponent ("51 m, Aš, Moravská"). List-page extraction catches
    // some but misses ~95% (2026-04-20 audit). Run as a post-fallback after
    // parsePropertyBlock so we don't override a more reliable structured
    // value if one exists.
    if (listing.size_m2 == null && listing.title) {
      const sizeFromTitle = extractSizeFromEurobydleniTitle(listing.title);
      if (sizeFromTitle != null) listing.size_m2 = sizeFromTitle;
    }
  }

  private parsePropertyBlock(listing: ScraperResult, html: string): void {
    const root = parseHtml(html);

    // Full description. Lives inside `<div class="box-desc box-desc-a-grey">
    // <p temprop="description">...`. Note the site's typo: `temprop` instead
    // of `itemprop`. Be defensive in case they ever fix it.
    const descEl =
      root.querySelector('.box-desc [temprop="description"]') ??
      root.querySelector('.box-desc [itemprop="description"]') ??
      root.querySelector(".box-desc p");
    if (descEl) {
      const text = descEl.text.trim();
      if (text) listing.description = text;
    }

    // Full image gallery
    const imageEls = root.querySelectorAll("img.property-detail__gallery__image, .property-detail__gallery img");
    const images: string[] = [];
    for (const img of imageEls) {
      let src = img.getAttribute("src") || img.getAttribute("data-src") || "";
      if (src.startsWith("//")) src = `https:${src}`;
      if (src && !images.includes(src)) images.push(src);
    }
    // Also try extracting from gallery link hrefs (full-size images)
    const galleryLinks = root.querySelectorAll("a.property-detail__gallery__link, .property-detail__gallery a");
    for (const link of galleryLinks) {
      let href = link.getAttribute("href") || "";
      if (href.startsWith("//")) href = `https:${href}`;
      if (href && /\.(jpg|jpeg|png|webp)/i.test(href) && !images.includes(href)) {
        images.push(href);
      }
    }
    if (images.length > 0) {
      listing.image_urls = JSON.stringify(images);
      // Unconditionally prefer the enriched detail-page gallery over the
      // list-tile thumbnail — same reasoning as ereality: list tiles can
      // carry placeholders or foreign-host URLs that rot quickly.
      listing.thumbnail_url = images[0];
    }

    // Property specs are in .box-params as individual <dl><dt>label:</dt>
    // <dd>value</dd></dl> pairs (one dl per attribute). Previous implementation
    // queried a .property-detail__params class that doesn't exist on eurobydleni
    // pages — that silently returned zero matches and left size/floor/energy/
    // furnishing/ownership/condition unpopulated.
    //
    // Observed labels (2026-04-21):
    //   Evidenční číslo, Typ, Adresa, Cena, Poznámka k ceně, Vlastnictví,
    //   Stav, Umístění, Typ budovy, Konstrukce, Plocha užitná, Plocha sklepa,
    //   Plocha terasy, Patro/podlaží, Typ objektu, Energetická náročnost,
    //   Vybavení, Podlaží v budově, …
    const paramPairs = root.querySelectorAll(".box-params dl");
    for (const pair of paramPairs) {
      const dt = pair.querySelector("dt");
      const dd = pair.querySelector("dd");
      if (!dt || !dd) continue;
      const label = dt.text.trim().toLowerCase().replace(/:$/, "").trim();
      const rawValue = dd.text.trim();
      const value = rawValue.toLowerCase();
      if (!label || !rawValue) continue;

      // Size: only "Plocha užitná" is the apartment's usable area.
      // "Plocha sklepa" (cellar) and "Plocha terasy" (terrace) are
      // auxiliary and must NOT populate size_m2.
      if (label.startsWith("plocha užitná") || label.startsWith("plocha uzitna")) {
        const m = rawValue.match(/(\d+[.,]?\d*)\s*m/i);
        if (m) {
          const parsed = parseFloat(m[1].replace(",", "."));
          if (parsed >= 5 && parsed <= 5000) listing.size_m2 = parsed;
        }
        continue;
      }

      // Floor (e.g. "1. podlaží"). "Patro, podlaží" is the label.
      if (label.startsWith("patro") || label === "podlaží") {
        const m = rawValue.match(/(\d+)/);
        if (m) listing.floor = parseInt(m[1], 10);
        continue;
      }

      // Total floors in building.
      if (
        label.startsWith("podlaží v budově") ||
        label.startsWith("počet podlaží") ||
        label.startsWith("celkem podlaží")
      ) {
        const m = rawValue.match(/(\d+)/);
        if (m) listing.total_floors = parseInt(m[1], 10);
        continue;
      }

      // Energy class: dd contains "C - Úsporná", "A - Velmi úsporná", …
      if (label.startsWith("třída en") || label.includes("energetick")) {
        const m = rawValue.match(/^([A-G])\b/i);
        if (m) listing.energy_rating = m[1].toUpperCase();
        continue;
      }

      // Ownership ("Osobní", "Družstevní", …).
      if (label.startsWith("vlastnictví") || label.startsWith("vlastnict")) {
        listing.ownership = rawValue;
        continue;
      }

      // Construction material ("Cihlová", "Panelová", …).
      if (label.startsWith("konstrukce")) {
        listing.construction = rawValue;
        continue;
      }

      // Condition ("Novostavba", "Po rekonstrukci", …).
      if (label === "stav" || label.startsWith("stav objektu") || label.startsWith("stav nemovitosti")) {
        listing.condition = rawValue;
        continue;
      }

      // Furnishing ("Ano" / "Částečně" / "Ne").
      if (label.startsWith("vybaven")) {
        if (value === "ano" || value.startsWith("plně")) listing.furnishing = "furnished";
        else if (value.startsWith("částečně") || value.startsWith("castecne")) listing.furnishing = "partially";
        else if (value === "ne" || value === "nezařízeno") listing.furnishing = "unfurnished";
        continue;
      }
    }

    // Amenities
    const amenityEls = root.querySelectorAll(
      ".property-detail__amenities li, .property-detail__features li, .property-detail__equipment li",
    );
    if (amenityEls.length > 0) {
      const amenities = amenityEls.map((el) => el.text.trim()).filter(Boolean);
      if (amenities.length > 0) listing.amenities = normalizeAmenities(JSON.stringify(amenities));
    }

    // Seller/contact info
    const contactBlock = root.querySelector(".property-detail__contact, .property-detail__seller");
    if (contactBlock) {
      const nameEl = contactBlock.querySelector(".property-detail__contact__name, h3, strong");
      if (nameEl) listing.seller_name = nameEl.text.trim() || null;

      const phoneEl = contactBlock.querySelector('a[href^="tel:"]');
      if (phoneEl) listing.seller_phone = phoneEl.text.trim() || null;

      const emailEl = contactBlock.querySelector('a[href^="mailto:"]');
      if (emailEl) listing.seller_email = emailEl.text.trim() || null;

      const companyEl = contactBlock.querySelector(".property-detail__contact__company, .company-name");
      if (companyEl) listing.seller_company = companyEl.text.trim() || null;
    }
  }
}
