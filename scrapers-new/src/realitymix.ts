import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import pLimit from "p-limit";
import { BaseScraper, type ScraperOptions } from "./base-scraper.js";
import type { ScraperResult, PageResult, PropertyType, TransactionType } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://realitymix.cz";
const ITEMS_PER_PAGE = 20;

/**
 * [urlSlug, transactionType, propertyType]
 */
const CATEGORIES: [string, TransactionType, PropertyType][] = [
  ["byty/prodej", "sale", "flat"],
  ["byty/pronajem", "rent", "flat"],
  ["domy/prodej", "sale", "house"],
  ["domy/pronajem", "rent", "house"],
  ["pozemky/prodej", "sale", "land"],
  ["pozemky/pronajem", "rent", "land"],
  ["chaty/prodej", "sale", "cottage"],
  ["chaty/pronajem", "rent", "cottage"],
  ["komerce/prodej", "sale", "commercial"],
  ["komerce/pronajem", "rent", "commercial"],
  ["ostatni/prodej", "sale", "other"],
  ["ostatni/pronajem", "rent", "other"],
];

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export class RealitymixScraper extends BaseScraper {
  readonly name = "realitymix";
  readonly sourceName = "realitymix";
  protected readonly hasDetailPhase = true;

  constructor(opts: ScraperOptions = {}) {
    super(opts);
  }

  // ─── Phase 1: List scan ────────────────────────────────────────────

  async *fetchPages(): AsyncGenerator<PageResult> {
    for (const [slug, transactionType, propertyType] of CATEGORIES) {
      this.log(`Scraping category: ${slug}`);
      try {
        yield* this.fetchCategoryPages(slug, transactionType, propertyType);
      } catch (err) {
        this.log(`  ERROR scraping ${slug}: ${err}`);
      }
    }
  }

  private async *fetchCategoryPages(
    slug: string,
    transactionType: TransactionType,
    propertyType: PropertyType,
  ): AsyncGenerator<PageResult> {
    // Fetch page 1 to discover total pages
    const firstPageUrl = `${BASE_URL}/reality/${slug}?stranka=1`;
    const firstHtml = await this.http.getHtml(firstPageUrl);
    const firstDoc = parseHtml(firstHtml);

    const totalCount = this.extractTotalCount(firstHtml);
    const totalPages = totalCount > 0
      ? Math.ceil(totalCount / ITEMS_PER_PAGE)
      : 1;
    const pagesToScrape = Math.min(totalPages, this.maxPages);

    this.log(
      `  ${slug}: ${totalCount} total listings, ${totalPages} pages (scraping ${pagesToScrape})`,
    );

    // Parse page 1
    const page1Results = this.parseListingPage(
      firstDoc,
      transactionType,
      propertyType,
    );
    if (page1Results.length > 0) {
      yield { category: slug, page: 1, totalPages: pagesToScrape, listings: page1Results };
    } else {
      return;
    }

    // Fetch remaining pages
    for (let page = 2; page <= pagesToScrape; page++) {
      try {
        const url = `${BASE_URL}/reality/${slug}?stranka=${page}`;
        const html = await this.http.getHtml(url);
        const doc = parseHtml(html);
        const pageResults = this.parseListingPage(
          doc,
          transactionType,
          propertyType,
        );

        if (pageResults.length === 0) {
          this.log(`  ${slug}: page ${page} returned 0 results, stopping`);
          break;
        }

        yield { category: slug, page, totalPages: pagesToScrape, listings: pageResults };
      } catch (err) {
        this.log(`  ${slug}: error on page ${page}: ${err}`);
      }
    }
  }

  // ─── Phase 2: Detail enrichment ────────────────────────────────────

  async enrichListings(listings: ScraperResult[]): Promise<ScraperResult[]> {
    if (listings.length === 0) return listings;

    this.log(`Enriching ${listings.length} new listings...`);
    const limit = pLimit(3);

    const enriched = await Promise.all(
      listings.map((listing) =>
        limit(async () => {
          try {
            return await this.enrichOne(listing);
          } catch (err) {
            this.log(`Failed to enrich ${listing.external_id}: ${err}`);
            return listing;
          }
        }),
      ),
    );

    const withGps = enriched.filter((l) => l.latitude !== null).length;
    const withDesc = enriched.filter((l) => l.description !== null).length;
    const withGallery = enriched.filter((l) => {
      try {
        return JSON.parse(l.image_urls).length > 3;
      } catch {
        return false;
      }
    }).length;
    this.log(
      `Enrichment: ${withGps}/${enriched.length} GPS, ${withDesc}/${enriched.length} description, ${withGallery}/${enriched.length} gallery`,
    );

    return enriched;
  }

  private async enrichOne(listing: ScraperResult): Promise<ScraperResult> {
    if (!listing.source_url) return listing;

    const url = listing.source_url.startsWith("http")
      ? listing.source_url
      : `${BASE_URL}${listing.source_url}`;

    const html = await this.http.getHtml(url);
    const doc = parseHtml(html);

    this.enrichGps(listing, doc);
    this.enrichDescription(listing, doc);
    this.enrichPropertyParams(listing, doc);
    this.enrichEnergyRating(listing, doc);
    this.enrichImages(listing, doc);
    this.enrichSellerInfo(listing, doc);

    return listing;
  }

  private enrichGps(listing: ScraperResult, doc: HTMLElement): void {
    const mapEl = doc.querySelector("#map") ?? doc.querySelector("#print-map");
    if (!mapEl) return;

    const latStr = mapEl.getAttribute("data-gps-lat");
    const lonStr = mapEl.getAttribute("data-gps-lon");
    if (!latStr || !lonStr) return;

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    // Validate Czech bounding box
    if (lat >= 48 && lat <= 52 && lon >= 12 && lon <= 19) {
      listing.latitude = lat;
      listing.longitude = lon;
    }
  }

  private enrichDescription(listing: ScraperResult, doc: HTMLElement): void {
    const descEl = doc.querySelector("div.advert-description__text-inner-inner");
    if (!descEl) return;

    const text = descEl.text?.trim();
    if (text && text.length > 0) {
      listing.description = text;
    }
  }

  private enrichPropertyParams(listing: ScraperResult, doc: HTMLElement): void {
    const items = doc.querySelectorAll("li.detail-information__data-item");
    if (items.length === 0) return;

    const extra: Record<string, string> = {};

    for (const item of items) {
      const spans = item.querySelectorAll("span");
      if (spans.length < 2) continue;

      const label = spans[0].text?.trim().replace(/:$/, "") ?? "";
      const value = spans[1].text?.trim() ?? "";
      if (!label || !value) continue;

      const labelLower = label.toLowerCase();

      if (labelLower.includes("druh objektu") || labelLower.includes("stavba")) {
        listing.construction = normalizeConstruction(value);
      } else if (labelLower.includes("stav objektu") || labelLower.includes("stav")) {
        listing.condition = normalizeCondition(value);
      } else if (labelLower.includes("vlastnictv") || labelLower.includes("vlastnict")) {
        listing.ownership = normalizeOwnership(value);
      } else if (labelLower.includes("energetick")) {
        listing.energy_rating = normalizeEnergyRating(value);
      } else if (labelLower.includes("cislo podlazi") || labelLower.includes("číslo podlaží") || labelLower.includes("podlazi")) {
        const floorMatch = value.match(/(\d+)/);
        if (floorMatch && listing.floor === null) {
          listing.floor = parseInt(floorMatch[1], 10);
        }
      } else if (labelLower.includes("pocet podlazi") || labelLower.includes("počet podlaží")) {
        const floorsMatch = value.match(/(\d+)/);
        if (floorsMatch && listing.total_floors === null) {
          listing.total_floors = parseInt(floorsMatch[1], 10);
        }
      } else if (labelLower.includes("celková plocha") || labelLower.includes("celkova plocha") || labelLower.includes("užitná plocha")) {
        if (listing.size_m2 === null) {
          const sizeMatch = value.match(/([\d,.\s]+)\s*m/);
          if (sizeMatch) {
            const size = parseFloat(sizeMatch[1].replace(/\s/g, "").replace(",", "."));
            if (!isNaN(size) && size > 0) listing.size_m2 = size;
          }
        }
      } else if (labelLower.includes("dispozice")) {
        if (!listing.layout) {
          listing.layout = value.toLowerCase();
        }
      } else {
        extra[label] = value;
      }
    }

    if (Object.keys(extra).length > 0) {
      addToAdditionalParams(listing, extra);
    }
  }

  private enrichEnergyRating(listing: ScraperResult, doc: HTMLElement): void {
    if (listing.energy_rating) return;

    const badgeEl = doc.querySelector("div.energy-efficiency__type");
    if (!badgeEl) return;

    const text = badgeEl.text?.trim();
    if (text) {
      listing.energy_rating = normalizeEnergyRating(text);
    }
  }

  private enrichImages(listing: ScraperResult, doc: HTMLElement): void {
    const urls = new Set<string>();

    // Main image
    const mainImg = doc.querySelector("a.gallery__main-img-inner");
    const mainSrc = mainImg?.getAttribute("data-src") ?? mainImg?.getAttribute("href");
    if (mainSrc) urls.add(mainSrc);

    // Visible gallery items
    const visibleItems = doc.querySelectorAll("div.gallery__item--image a");
    for (const a of visibleItems) {
      const src = a.getAttribute("data-src") ?? a.getAttribute("href");
      if (src) urls.add(src);
    }

    // Hidden gallery items
    const hiddenItems = doc.querySelectorAll("div.gallery__hidden-items a.gallery__item");
    for (const a of hiddenItems) {
      const src = a.getAttribute("href") ?? a.getAttribute("data-src");
      if (src) urls.add(src);
    }

    if (urls.size > 0) {
      const imageArr = [...urls].filter((u) => u.startsWith("http") || u.startsWith("//"));
      const normalized = imageArr.map((u) => (u.startsWith("//") ? `https:${u}` : u));
      if (normalized.length > 0) {
        listing.image_urls = JSON.stringify(normalized);
        listing.thumbnail_url = listing.thumbnail_url ?? normalized[0];
      }
    }
  }

  private enrichSellerInfo(listing: ScraperResult, doc: HTMLElement): void {
    // Agent name
    const agentLink = doc.querySelector("a[href*='/profil-realitniho-maklere/']");
    if (agentLink) {
      const name = agentLink.text?.trim();
      if (name) listing.seller_name = name;
    }

    // Phone
    const phoneLink = doc.querySelector("a[href*='/trackredir/']");
    if (phoneLink) {
      const phone = phoneLink.text?.trim();
      if (phone) listing.seller_phone = phone;
    }

    // Email
    const emailLink = doc.querySelector("a[href^='mailto:']");
    if (emailLink) {
      const href = emailLink.getAttribute("href") ?? "";
      const email = href.replace("mailto:", "").trim();
      if (email) listing.seller_email = email;
    }

    // Company
    const companyEl = doc.querySelector("div.offer-detail-sidebar__company p.font-extrabold a");
    if (companyEl) {
      const company = companyEl.text?.trim();
      if (company) listing.seller_company = company;
    }
  }

  // ---------------------------------------------------------------------------
  // List-page parsing
  // ---------------------------------------------------------------------------

  private extractTotalCount(html: string): number {
    // Pattern: "Zobrazujeme výsledky 1-20 z celkem 7385 nalezených"
    const match = html.match(/z\s+celkem\s+([\d\s]+)\s+nalezen/);
    if (match) {
      return parseInt(match[1].replace(/\s/g, ""), 10) || 0;
    }
    return 0;
  }

  private parseListingPage(
    doc: HTMLElement,
    transactionType: TransactionType,
    propertyType: PropertyType,
  ): ScraperResult[] {
    const results: ScraperResult[] = [];
    const items = doc.querySelectorAll("li.advert-item");

    for (const item of items) {
      try {
        const listing = this.parseListingItem(
          item,
          transactionType,
          propertyType,
        );
        if (listing) {
          results.push(listing);
        }
      } catch (err) {
        // Skip individual listing errors
      }
    }

    return results;
  }

  private parseListingItem(
    item: HTMLElement,
    transactionType: TransactionType,
    propertyType: PropertyType,
  ): ScraperResult | null {
    const now = new Date().toISOString();

    // --- External ID ---
    const formDiv = item.querySelector("[data-id]");
    const rawId = formDiv?.getAttribute("data-id") ?? null;

    if (!rawId) {
      const detailLink = item.querySelector(
        "a[href*='/detail/']",
      );
      const href = detailLink?.getAttribute("href") ?? "";
      const idMatch = href.match(/-(\d+)\.html/);
      if (!idMatch) return null;
      return this.buildResult(
        idMatch[1],
        item,
        transactionType,
        propertyType,
        now,
      );
    }

    return this.buildResult(
      rawId,
      item,
      transactionType,
      propertyType,
      now,
    );
  }

  private buildResult(
    id: string,
    item: HTMLElement,
    transactionType: TransactionType,
    propertyType: PropertyType,
    now: string,
  ): ScraperResult {
    const externalId = `realitymix_${id}`;

    // --- Detail URL ---
    const detailLink = item.querySelector("a[href*='/detail/']");
    const sourceUrl = detailLink?.getAttribute("href") ?? null;

    // --- Title ---
    const titleEl = item.querySelector("h2 a span");
    const title = titleEl?.text?.trim() ?? null;

    // --- Address ---
    const addressEl = item.querySelector(
      "p.text-body-light, .advert-item__content-data p.text-sm",
    );
    let address = addressEl?.text?.trim() ?? null;
    if (address) {
      address = address.replace(/\s+/g, " ").trim();
    }

    // --- City & Region ---
    const city = this.extractCity(address, sourceUrl);
    const region = this.extractRegion(address);

    // --- Price ---
    const priceDiv = item.querySelector(
      ".text-xl.font-extrabold span, div.text-xl span",
    );
    let priceText = priceDiv?.text?.trim() ?? "";
    const { price, currency, priceNote } = this.parsePrice(priceText);

    // --- Size ---
    const sizeM2 = this.extractSize(title);

    // --- Layout ---
    const layout = this.extractLayout(title);

    // --- Floor ---
    const { floor, totalFloors } = this.extractFloor(item);

    // --- Images ---
    const imageUrls: string[] = [];
    const imgEls = item.querySelectorAll(
      ".swiper-slide img[src*='st.realitymix.cz'], .swiper-slide img[src*='st.rmix.cz']",
    );
    for (const img of imgEls) {
      const src = img.getAttribute("src");
      if (src) {
        imageUrls.push(src.startsWith("//") ? `https:${src}` : src);
      }
    }
    const thumbnailUrl = imageUrls.length > 0 ? imageUrls[0] : null;

    // --- Seller info ---
    const companyLogoEl = item.querySelector(
      ".advert-item__content-data-company-logo img",
    );
    const sellerCompany =
      companyLogoEl?.getAttribute("alt")?.trim() ?? null;

    const agentEl = item.querySelector(
      "img.advert-item__content-data-agent, .advert-item__content-data-agent img",
    );
    const sellerName =
      agentEl?.getAttribute("alt")?.trim() ??
      agentEl?.getAttribute("title")?.trim() ??
      null;

    // --- Phone ---
    const phoneEl = item.querySelector(
      "a[href^='/trackredir/']",
    );
    const sellerPhone = phoneEl?.text?.trim() ?? null;

    // --- Condition (novostavba only from list) ---
    const condition = this.extractCondition(item);

    // --- Construction (brick/panel from list icons) ---
    const construction = this.extractConstruction(item);

    // --- Additional params ---
    const formDiv = item.querySelector("[data-id]");
    const extraParams: Record<string, unknown> = {};
    const fkRk = formDiv?.getAttribute("data-fk_rk");
    if (fkRk) extraParams.fk_rk = fkRk;
    const galleryLen = formDiv?.getAttribute(
      "data-form-gallery-images-lenght",
    );
    if (galleryLen) extraParams.gallery_count = parseInt(galleryLen, 10);
    const formAddress = formDiv?.getAttribute("data-form-address");
    if (formAddress) extraParams.district = formAddress;

    const additionalParams =
      Object.keys(extraParams).length > 0
        ? JSON.stringify(extraParams)
        : null;

    // --- District from form data ---
    const district = formAddress ?? null;

    return {
      external_id: externalId,
      source: "realitymix",
      property_type: propertyType,
      transaction_type: transactionType,
      title,
      description: null,
      price,
      currency,
      price_note: priceNote,
      address,
      city,
      district,
      region,
      latitude: null,
      longitude: null,
      size_m2: sizeM2,
      layout,
      floor,
      total_floors: totalFloors,
      condition,
      construction,
      ownership: null,
      furnishing: null,
      energy_rating: null,
      amenities: null,
      image_urls: JSON.stringify(imageUrls),
      thumbnail_url: thumbnailUrl,
      source_url: sourceUrl,
      listed_at: null,
      scraped_at: now,
      is_active: true,
      deactivated_at: null,
      seller_name: sellerName,
      seller_phone: sellerPhone,
      seller_email: null,
      seller_company: sellerCompany,
      additional_params: additionalParams,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private parsePrice(text: string): {
    price: number | null;
    currency: string;
    priceNote: string | null;
  } {
    if (!text) return { price: null, currency: "CZK", priceNote: null };

    const cleaned = text.replace(/\s/g, " ").trim();

    const lowerText = cleaned.toLowerCase();
    if (
      lowerText.includes("info v rk") ||
      lowerText.includes("info v kancelá") ||
      lowerText.includes("cena v rk") ||
      lowerText.includes("na vyžádání") ||
      lowerText.includes("dohodou") ||
      lowerText.includes("nabídněte")
    ) {
      return { price: null, currency: "CZK", priceNote: cleaned };
    }

    let currency = "CZK";
    if (cleaned.includes("€") || cleaned.toLowerCase().includes("eur")) {
      currency = "EUR";
    }

    const priceMatch = cleaned.match(
      /([\d\s.]+(?:,\d+)?)\s*(?:Kč|CZK|€|EUR)?/i,
    );
    if (priceMatch) {
      const numStr = priceMatch[1]
        .replace(/\s/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const price = parseFloat(numStr);
      if (!isNaN(price) && price > 0) {
        let priceNote: string | null = null;
        if (cleaned.includes("za měsíc") || cleaned.includes("/ měsíc")) {
          priceNote = "za měsíc";
        } else if (
          cleaned.includes("za nemovitost") ||
          cleaned.includes("celkem")
        ) {
          priceNote = "za nemovitost";
        }
        return { price, currency, priceNote };
      }
    }

    return { price: null, currency: "CZK", priceNote: cleaned || null };
  }

  private extractSize(title: string | null): number | null {
    if (!title) return null;
    const match = title.match(/([\d,.\s]+)\s*m[²2]/i);
    if (match) {
      const numStr = match[1].replace(/\s/g, "").replace(",", ".");
      const size = parseFloat(numStr);
      if (!isNaN(size) && size > 0) return size;
    }
    return null;
  }

  private extractLayout(title: string | null): string | null {
    if (!title) return null;
    const match = title.match(
      /(\d\+(?:kk|1|2|3|4|5))|garsoni[eé]ra|atypick[ýy]/i,
    );
    if (match) {
      return match[0].toLowerCase();
    }
    return null;
  }

  private extractFloor(item: HTMLElement): {
    floor: number | null;
    totalFloors: number | null;
  } {
    const iconItems = item.querySelectorAll(
      ".icons-scroll-box li",
    );
    for (const li of iconItems) {
      const img = li.querySelector("img");
      const alt = img?.getAttribute("alt") ?? "";
      if (alt.toLowerCase().includes("podla")) {
        const span = li.querySelector("span");
        const floorText = span?.text?.trim() ?? "";
        const floorMatch = floorText.match(/(\d+)\s*\/\s*(\d+)/);
        if (floorMatch) {
          return {
            floor: parseInt(floorMatch[1], 10),
            totalFloors: parseInt(floorMatch[2], 10),
          };
        }
        const singleMatch = floorText.match(/(\d+)/);
        if (singleMatch) {
          return {
            floor: parseInt(singleMatch[1], 10),
            totalFloors: null,
          };
        }
      }
    }
    return { floor: null, totalFloors: null };
  }

  private extractCondition(item: HTMLElement): string | null {
    const iconItems = item.querySelectorAll(
      ".icons-scroll-box li",
    );
    for (const li of iconItems) {
      const img = li.querySelector("img");
      const alt = img?.getAttribute("alt") ?? "";
      if (alt.toLowerCase().includes("novostavba")) {
        return "new";
      }
    }
    return null;
  }

  private extractConstruction(item: HTMLElement): string | null {
    const iconItems = item.querySelectorAll(
      ".icons-scroll-box li",
    );
    for (const li of iconItems) {
      const img = li.querySelector("img");
      const alt = img?.getAttribute("alt") ?? "";
      const lower = alt.toLowerCase();
      if (lower.includes("cihl")) return "brick";
      if (lower.includes("panel")) return "panel";
    }
    return null;
  }

  private extractCity(
    address: string | null,
    sourceUrl: string | null,
  ): string | null {
    if (sourceUrl) {
      const urlMatch = sourceUrl.match(/\/detail\/([^/]+)\//);
      if (urlMatch) {
        const citySlug = urlMatch[1];
        const city = citySlug
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        return city;
      }
    }

    if (!address) return null;

    const parts = address.split(",").map((p) => p.trim());

    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1];
      if (lastPart.toLowerCase().startsWith("okr.")) {
        const cityPart =
          parts.length >= 3
            ? parts[parts.length - 2]
            : parts[0];
        return cityPart.replace(/\s+\d+\s*$/, "").trim() || cityPart;
      }
      return lastPart.replace(/\s+\d+\s*$/, "").trim() || lastPart;
    }
    if (parts.length === 1) {
      return parts[0].replace(/\s+\d+\s*$/, "").trim() || parts[0];
    }
    return null;
  }

  private extractRegion(address: string | null): string | null {
    if (!address) return null;
    const match = address.match(/okr\.\s*(.+?)$/);
    if (match) {
      return match[1].trim();
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeCondition(value: string): string {
  const v = value.toLowerCase().trim();
  if (v.includes("novostavba")) return "new";
  if (v.includes("velmi dobrý") || v.includes("velmi dobry")) return "very_good";
  if (v.includes("dobrý") || v.includes("dobry")) return "good";
  if (v.includes("před rekonstrukcí") || v.includes("pred rekonstrukci")) return "before_reconstruction";
  if (v.includes("po rekonstrukci")) return "after_reconstruction";
  if (v.includes("ve výstavbě") || v.includes("ve vystavbe") || v.includes("projekt")) return "under_construction";
  if (v.includes("špatný") || v.includes("spatny")) return "poor";
  if (v.includes("k demolici")) return "demolition";
  return value.trim();
}

function normalizeConstruction(value: string): string {
  const v = value.toLowerCase().trim();
  if (v.includes("cihla") || v.includes("cihlová") || v.includes("cihlova")) return "brick";
  if (v.includes("panel")) return "panel";
  if (v.includes("dřevo") || v.includes("drevo") || v.includes("dřevěná") || v.includes("drevena")) return "wood";
  if (v.includes("skelet")) return "skeleton";
  if (v.includes("montovaná") || v.includes("montovana")) return "prefab";
  if (v.includes("smíšená") || v.includes("smisena")) return "mixed";
  if (v.includes("kamen")) return "stone";
  return value.trim();
}

function normalizeOwnership(value: string): string {
  const v = value.toLowerCase().trim();
  if (v.includes("osobní") || v.includes("osobni")) return "personal";
  if (v.includes("družstevní") || v.includes("druzstevni")) return "cooperative";
  if (v.includes("státní") || v.includes("statni") || v.includes("obecní") || v.includes("obecni")) return "state";
  return value.trim();
}

function normalizeEnergyRating(value: string): string | null {
  const match = value.match(/[A-G]/i);
  return match ? match[0].toUpperCase() : null;
}

function addToAdditionalParams(listing: ScraperResult, extra: Record<string, string>): void {
  let existing: Record<string, unknown> = {};
  if (listing.additional_params) {
    try {
      existing = JSON.parse(listing.additional_params);
    } catch {
      // ignore parse errors
    }
  }
  Object.assign(existing, extra);
  listing.additional_params = JSON.stringify(existing);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const { parseMaxPages, getRps } = await import("./cli.js");
  const scraper = new RealitymixScraper({ name: "realitymix", rps: getRps("realitymix"), maxPages: parseMaxPages() });
  scraper.run().catch(console.error);
}
