import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import pLimit from "p-limit";
import type { ScraperResult, PropertyType, TransactionType } from "@flat-finder/types";
import { BaseScraper, streamInterleave, type ScraperOptions, type PageResult } from "../base-scraper.js";
import { normalizeAmenities } from "../amenity-normalizer.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Categories to scrape: [urlPath, propertyType, transactionType]
 */
const CATEGORIES: [string, PropertyType, TransactionType][] = [
  // Sale
  ["/prodej/byty/", "flat", "sale"],
  ["/prodej/rodinne-domy/", "house", "sale"],
  ["/prodej/pozemky/", "land", "sale"],
  ["/prodej/komercni-prostory/", "commercial", "sale"],
  ["/prodej/chaty-chalupy/", "cottage", "sale"],
  ["/prodej/ostatni/", "other", "sale"],
  // Rent
  ["/pronajem/byty/", "flat", "rent"],
  ["/pronajem/rodinne-domy/", "house", "rent"],
  ["/pronajem/pozemky/", "land", "rent"],
  ["/pronajem/komercni-prostory/", "commercial", "rent"],
  ["/pronajem/chaty-chalupy/", "cottage", "rent"],
  ["/pronajem/ostatni/", "other", "rent"],
  // Auction
  ["/drazby/byty/", "flat", "auction"],
  ["/drazby/rodinne-domy/", "house", "auction"],
  ["/drazby/pozemky/", "land", "auction"],
  ["/drazby/komercni-prostory/", "commercial", "auction"],
  ["/drazby/ostatni/", "other", "auction"],
];

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

interface JsonLdOffer {
  "@type"?: string;
  additionalType?: string;
  name?: string;
  description?: string;
  image?: string;
  price?: number;
  priceCurrency?: string;
  areaServed?: {
    "@type"?: string;
    address?: {
      "@type"?: string;
      streetAddress?: string | null;
      addressLocality?: string | null;
    };
  };
}

interface DetailJsonLd {
  "@type"?: string;
  name?: string;
  description?: string;
  image?: string;
  offeredBy?: {
    "@type"?: string;
    name?: string | null;
    telephone?: string | null;
    email?: string | null;
    address?: {
      streetAddress?: string | null;
    };
  };
  areaServed?: {
    address?: {
      addressLocality?: string | null;
    };
  };
}

interface PropertyParams {
  condition: string | null;
  construction: string | null;
  ownership: string | null;
  energy_rating: string | null;
  floor: number | null;
  total_floors: number | null;
  furnishing: string | null;
  size_m2: number | null;
  amenities: string[];
  listed_at: string | null;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function extractLayout(text: string): string | null {
  if (!text) return null;
  const m = text.match(/(\d+\+(?:kk|\d))/i);
  if (m) return m[1].toLowerCase();
  if (/atypick/i.test(text)) return "atypicky";
  if (/garsoni/i.test(text)) return "1+kk";
  return null;
}

function extractSize(text: string): number | null {
  if (!text) return null;
  const m = text.match(/([\d\s\u00a0]+)\s*m[²2]/i);
  if (m) {
    const numStr = m[1].replace(/[\s\u00a0]/g, "");
    const val = parseFloat(numStr);
    if (!isNaN(val) && val > 0) return val;
  }
  return null;
}

function extractCityFromTitle(title: string): string | null {
  if (!title) return null;
  const m = title.match(/m[²2]\s+(.+)$/i);
  if (m) {
    let city = m[1].trim();
    city = city.split(",")[0].trim();
    const parts = city.split(/\s+/);
    if (parts[0] === "Praha" || parts[0] === "Brno") {
      return parts[0];
    }
    return city || null;
  }
  return null;
}

function extractPrice(text: string): number | null {
  if (!text) return null;
  if (/cena\s+na\s+dotaz/i.test(text)) return null;

  const m = text.match(/([\d\s\u00a0]+)\s*Kč/);
  if (m) {
    const numStr = m[1].replace(/[\s\u00a0]/g, "");
    const val = parseInt(numStr, 10);
    if (!isNaN(val) && val > 0) return val;
  }
  return null;
}

function refinePropertyType(
  href: string,
  defaultType: PropertyType,
): PropertyType {
  if (href.includes("/garaze/") || href.includes("/garazov")) return "garage";
  if (href.includes("/chalupy/") || href.includes("/chaty/")) return "cottage";
  if (href.includes("/rodinne-domy/")) return "house";
  if (href.includes("/byty/") || href.includes("/pokoje/")) return "flat";
  if (
    href.includes("/pozemky/") ||
    href.includes("/stavebni-parcely/") ||
    href.includes("/zahrady/")
  )
    return "land";
  if (
    href.includes("/komercni-prostory/") ||
    href.includes("/kancelare/") ||
    href.includes("/sklady/")
  )
    return "commercial";
  return defaultType;
}

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

function parseCzechDate(text: string): string | null {
  // "12.3.2024" or "12. 3. 2024"
  const m = text.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  const year = m[3];
  return `${year}-${month}-${day}`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&yacute;/gi, "ý")
    .replace(/&scaron;/gi, "š")
    .replace(/&ccaron;/gi, "č")
    .replace(/&rcaron;/gi, "ř")
    .replace(/&zcaron;/gi, "ž")
    .replace(/&ncaron;/gi, "ň")
    .replace(/&tcaron;/gi, "ť")
    .replace(/&dcaron;/gi, "ď")
    .replace(/&ecaron;/gi, "ě")
    .replace(/&uuml;/gi, "ü")
    .replace(/&uuring;/gi, "ů")
    .replace(/&sup2;/gi, "²")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

function normalizeFurnishing(value: string): string {
  const v = value.toLowerCase().trim();
  if (v.includes("nezařízený") || v.includes("nezarizeny")) return "unfurnished";
  if (v.includes("částečně") || v.includes("castecne")) return "partially";
  if (v.includes("zařízený") || v.includes("zarizeny")) return "furnished";
  return value.trim();
}

function isAmenityLabel(label: string): boolean {
  const amenityKeywords = [
    "balkón", "balkon", "terasa", "sklep", "výtah", "vytah",
    "garáž", "garaz", "parkování", "parkovani", "lodžie", "lodzie",
    "bazén", "bazen", "zahrada", "klimatizace",
  ];
  return amenityKeywords.some((kw) => label.includes(kw));
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export interface CeskeRealityScraperOptions extends ScraperOptions {
  categoryParallelism?: number;
  skipEnrichmentHours?: number;
}

export class CeskeRealityScraper extends BaseScraper {
  readonly name = "ceskereality";
  readonly baseUrl = "https://www.ceskereality.cz";
  private readonly categoryParallelism: number;
  readonly skipEnrichmentHours: number;

  override get hasDetailPhase() { return true; }

  constructor(opts: CeskeRealityScraperOptions) {
    super(opts);
    this.categoryParallelism = opts.categoryParallelism ?? 2;
    this.skipEnrichmentHours = opts.skipEnrichmentHours ?? 24;
  }

  // ─── Phase 1: List Scan ───────────────────────────────────────────

  async *fetchPages(): AsyncGenerator<PageResult> {
    this.init();

    if (this.categoryParallelism <= 1) {
      for (const [urlPath, propertyType, transactionType] of CATEGORIES) {
        const catName = `${transactionType}/${propertyType}`;
        try {
          yield* this.fetchCategoryPages(urlPath, propertyType, transactionType, catName);
        } catch (err) {
          this.log(`Error scraping ${catName}: ${err}`);
        }
      }
      return;
    }

    const self = this;
    yield* streamInterleave(
      [...CATEGORIES],
      this.categoryParallelism,
      async function* ([urlPath, propertyType, transactionType]) {
        const catName = `${transactionType}/${propertyType}`;
        try {
          yield* self.fetchCategoryPages(urlPath, propertyType, transactionType, catName);
        } catch (err) {
          self.log(`Error scraping ${catName}: ${err}`);
        }
      },
    );
  }

  private async *fetchCategoryPages(
    urlPath: string,
    propertyType: PropertyType,
    transactionType: TransactionType,
    catName: string,
  ): AsyncGenerator<PageResult> {
    // Fetch first page to determine total pages
    const firstPageUrl = `${this.baseUrl}${urlPath}`;
    let html: string;
    try {
      html = await this.http.getHtml(firstPageUrl);
    } catch (err) {
      this.log(`Error fetching first page of ${catName}: ${err}`);
      return;
    }

    const doc = parseHtml(html);
    const totalPages = this.extractTotalPages(doc);

    this.log(`Category ${catName}: ${totalPages} pages`);

    // Parse first page
    const listings = this.parseListingPage(doc, html, propertyType, transactionType);
    if (listings.length > 0) {
      yield { category: catName, page: 1, totalPages, listings };
    } else {
      return;
    }

    if (totalPages <= 1) return;

    // Batch-concurrent fetching of subsequent pages
    const batchSize = this.concurrency * 2;
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

    for (let bStart = 0; bStart < remaining.length; bStart += batchSize) {
      if (this.isCategorySkipped(catName)) return;
      const batchPages = remaining.slice(bStart, bStart + batchSize);

      const pagePromises = batchPages.map((page) =>
        this.limiter(async () => {
          const pageUrl = `${this.baseUrl}${urlPath}?strana=${page}`;
          try {
            return { page, html: await this.http.getHtml(pageUrl) };
          } catch (err) {
            this.log(`Page ${page} fetch error for ${catName}: ${err}`);
            return { page, html: null };
          }
        }),
      );

      const pageResults = await Promise.all(pagePromises);

      for (const { page, html: pageHtml } of pageResults) {
        if (this.isCategorySkipped(catName)) return;
        if (!pageHtml) continue;

        const pageDoc = parseHtml(pageHtml);
        const pageListings = this.parseListingPage(pageDoc, pageHtml, propertyType, transactionType);

        if (pageListings.length === 0) continue;

        yield { category: catName, page, totalPages, listings: pageListings };
      }
    }
  }

  // ─── Phase 2: Detail Enrichment ───────────────────────────────────

  override async enrichListings(
    listings: ScraperResult[],
    opts?: { concurrency?: number; batchSize?: number },
  ): Promise<void> {
    if (listings.length === 0) return;

    this.init();
    this.log(`Enriching ${listings.length} new listings...`);
    const limit = opts?.concurrency ? pLimit(opts.concurrency) : this.limiter;

    await Promise.all(
      listings.map((listing) =>
        limit(async () => {
          try {
            await this.enrichOne(listing);
          } catch (err) {
            this.log(`Failed to enrich ${listing.external_id}: ${err}`);
          }
        }),
      ),
    );

    const withGps = listings.filter((l) => l.latitude !== null).length;
    const withDesc = listings.filter((l) => l.description !== null).length;
    const withGallery = listings.filter((l) => {
      try { return JSON.parse(l.image_urls).length > 1; } catch { return false; }
    }).length;
    this.log(
      `Enrichment: ${withGps}/${listings.length} GPS, ${withDesc}/${listings.length} description, ${withGallery}/${listings.length} gallery`,
    );
  }

  private async enrichOne(listing: ScraperResult): Promise<void> {
    if (!listing.source_url) return;

    const html = await this.http.getHtml(listing.source_url);
    const root = parseHtml(html);

    // GPS coordinates from driving calculator input
    const coordInput = root.querySelector("#driving_calculator_from");
    if (coordInput) {
      const lat = parseFloat(coordInput.getAttribute("data-coord-lat") ?? "");
      const lng = parseFloat(coordInput.getAttribute("data-coord-lng") ?? "");
      if (!isNaN(lat) && !isNaN(lng) && lat >= 48 && lat <= 52 && lng >= 12 && lng <= 19) {
        listing.latitude = lat;
        listing.longitude = lng;
      }

      // Address from the input value
      const address = coordInput.getAttribute("value")?.trim();
      if (address) {
        listing.address = address;
      }
    }

    // Full image gallery from gallery links
    const galleryLinks = root.querySelectorAll("a.gallery-item");
    if (galleryLinks.length > 0) {
      const images: string[] = [];
      for (const link of galleryLinks) {
        const href = link.getAttribute("href");
        if (href && href.includes("ceskereality.cz")) {
          images.push(href);
        }
      }
      if (images.length > 0) {
        listing.image_urls = JSON.stringify(images);
        listing.thumbnail_url = listing.thumbnail_url ?? images[0];
      }
    }

    // Extract JSON-LD from detail page for description, seller info, city
    const detailJsonLd = this.extractDetailJsonLd(html);
    if (detailJsonLd) {
      if (detailJsonLd.description) {
        listing.description = truncate(decodeHtmlEntities(detailJsonLd.description), 2000);
      }
      if (detailJsonLd.offeredBy) {
        listing.seller_name = detailJsonLd.offeredBy.name ?? listing.seller_name;
        listing.seller_phone = detailJsonLd.offeredBy.telephone ?? listing.seller_phone;
        if (detailJsonLd.offeredBy.email) {
          listing.seller_email = detailJsonLd.offeredBy.email;
        }
        if (detailJsonLd.offeredBy.address?.streetAddress) {
          listing.seller_company = detailJsonLd.offeredBy.address.streetAddress;
        }
      }
      if (detailJsonLd.areaServed?.address?.addressLocality) {
        listing.city = detailJsonLd.areaServed.address.addressLocality;
      }
    }

    // Fallback seller_email from mailto links
    if (!listing.seller_email) {
      const mailtoLink = root.querySelector("a[href^='mailto:']");
      if (mailtoLink) {
        const href = mailtoLink.getAttribute("href") ?? "";
        const raw = href.replace("mailto:", "").split("?")[0].trim();
        if (raw.includes("@")) listing.seller_email = raw;
      }
    }

    // Extract property parameters from i-info elements
    const params = this.extractPropertyParams(root);
    if (params.condition) listing.condition = params.condition;
    if (params.construction) listing.construction = params.construction;
    if (params.ownership) listing.ownership = params.ownership;
    if (params.energy_rating) listing.energy_rating = params.energy_rating;
    if (params.floor !== null) listing.floor = params.floor;
    if (params.total_floors !== null) listing.total_floors = params.total_floors;
    if (params.furnishing) listing.furnishing = params.furnishing;
    if (params.size_m2 !== null && !listing.size_m2) listing.size_m2 = params.size_m2;
    if (params.amenities.length > 0) listing.amenities = normalizeAmenities(JSON.stringify(params.amenities));
    if (params.listed_at) listing.listed_at = params.listed_at;
  }

  // ------------------------------------------------------------------
  // Detail JSON-LD extraction
  // ------------------------------------------------------------------

  private extractDetailJsonLd(html: string): DetailJsonLd | null {
    const jsonLdPattern =
      /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;

    while ((match = jsonLdPattern.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        // Look for offer types with offeredBy
        if (
          data["@type"] === "OfferForPurchase" ||
          data["@type"] === "OfferForLease" ||
          data["@type"] === "Offer"
        ) {
          return data as DetailJsonLd;
        }
        // Also check for RealEstateListing with a single offer
        if (data["@type"] === "RealEstateListing" && data.offers) {
          const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
          if (offer) return offer as DetailJsonLd;
        }
      } catch {
        // JSON parse error, skip
      }
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Property parameters extraction from detail page
  // ------------------------------------------------------------------

  private extractPropertyParams(root: HTMLElement): PropertyParams {
    const params: PropertyParams = {
      condition: null,
      construction: null,
      ownership: null,
      energy_rating: null,
      floor: null,
      total_floors: null,
      furnishing: null,
      size_m2: null,
      amenities: [],
      listed_at: null,
    };

    // Look for i-info sections with title/value pattern
    const infoItems = root.querySelectorAll(".i-info");
    for (const item of infoItems) {
      const titleEl = item.querySelector(".i-info__title");
      const valueEl = item.querySelector(".i-info__value");
      if (!titleEl || !valueEl) continue;

      const title = titleEl.text.trim().toLowerCase();
      const value = valueEl.text.trim();
      if (!value) continue;

      if (title.includes("stav nemovitosti") || title === "stav") {
        params.condition = normalizeCondition(value);
      } else if (title.includes("konstrukce")) {
        params.construction = normalizeConstruction(value);
      } else if (title.includes("vlastnictví") || title.includes("vlastnicvi")) {
        params.ownership = normalizeOwnership(value);
      } else if (title.includes("energetická") || title.includes("energeticka")) {
        params.energy_rating = value.trim().toUpperCase().charAt(0) || null;
      } else if (title.includes("počet podlaží") || title.includes("pocet podlazi") || title.includes("celkov")) {
        const match = value.match(/(\d+)/);
        if (match) params.total_floors = parseInt(match[1], 10);
      } else if (title.includes("podlaží") || title.includes("patro")) {
        const floorMatch = value.match(/(\d+)/);
        if (floorMatch) params.floor = parseInt(floorMatch[1], 10);
      } else if (title.includes("vybavení") || title.includes("vybaveni")) {
        params.furnishing = normalizeFurnishing(value);
      } else if (title.includes("plocha") || title.includes("užitná") || title.includes("uzitna")) {
        const match = value.match(/([\d\s,]+)\s*m/);
        if (match) {
          const size = parseFloat(match[1].replace(/\s/g, "").replace(",", "."));
          if (!isNaN(size) && size > 0) params.size_m2 = size;
        }
      } else if (title.includes("datum vložení") || title.includes("datum vlozeni")) {
        params.listed_at = parseCzechDate(value);
      } else if (isAmenityLabel(title)) {
        const lower = value.toLowerCase();
        if (!lower.includes("ne") || lower.includes("ano")) {
          params.amenities.push(titleEl.text.trim());
        }
      }
    }

    return params;
  }

  // ------------------------------------------------------------------
  // Total pages from pagination
  // ------------------------------------------------------------------

  private extractTotalPages(doc: HTMLElement): number {
    // Find all pagination links with strana=N and get the max
    const links = doc.querySelectorAll("a[href]");
    let maxPage = 1;

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const m = href.match(/strana=(\d+)/);
      if (m) {
        const p = parseInt(m[1], 10);
        if (p > maxPage) maxPage = p;
      }
    }

    return maxPage;
  }

  // ------------------------------------------------------------------
  // Page parsing - uses article.i-estate elements
  // ------------------------------------------------------------------

  private parseListingPage(
    doc: HTMLElement,
    rawHtml: string,
    propertyType: PropertyType,
    transactionType: TransactionType,
  ): ScraperResult[] {
    const results: ScraperResult[] = [];
    const now = new Date().toISOString();

    // Parse JSON-LD for supplementary data
    const jsonLdOffers = this.extractJsonLdListings(rawHtml);
    const jsonLdByName = new Map<string, JsonLdOffer>();
    for (const offer of jsonLdOffers) {
      if (offer.name) {
        jsonLdByName.set(offer.name, offer);
      }
    }

    const articles = doc.querySelectorAll("article.i-estate");

    for (const article of articles) {
      try {
        const listing = this.parseArticle(
          article,
          propertyType,
          transactionType,
          jsonLdByName,
          now,
        );
        if (listing) {
          results.push(listing);
        }
      } catch (err) {
        this.log(`Parse error for article: ${err}`);
      }
    }

    return results;
  }

  // ------------------------------------------------------------------
  // Parse a single article.i-estate element
  // ------------------------------------------------------------------

  private parseArticle(
    article: HTMLElement,
    defaultPropertyType: PropertyType,
    transactionType: TransactionType,
    jsonLdByName: Map<string, JsonLdOffer>,
    now: string,
  ): ScraperResult | null {
    const titleLink =
      article.querySelector("h2 a") ??
      article.querySelector(".i-estate__header-title a");
    if (!titleLink) return null;

    const href = titleLink.getAttribute("href") || "";
    const title = titleLink.text?.trim() || "";
    if (!href || !title) return null;

    const idMatch = href.match(/-(\d+)\.html$/);
    if (!idMatch) return null;
    const listingId = idMatch[1];

    const sourceUrl = `${this.baseUrl}${href}`;

    // Price
    const priceEl = article.querySelector(".i-estate__footer-price-value");
    const priceText = priceEl?.text?.trim() || "";
    const price = extractPrice(priceText);
    const priceNote = /cena\s+na\s+dotaz/i.test(priceText)
      ? "Cena na dotaz"
      : null;

    // Description snippet
    const descEl = article.querySelector(".i-estate__description-text");
    let description = descEl?.text?.trim() || null;

    // Thumbnail
    const thumbnail = this.extractThumbnail(article);

    // Layout, size, city from title
    const layout = extractLayout(title);
    const sizeM2 = extractSize(title);
    const city = extractCityFromTitle(title);

    const refinedType = refinePropertyType(href, defaultPropertyType);

    // JSON-LD supplementary data
    const jsonLd = this.findJsonLdMatch(title, jsonLdByName);
    const jsonLdCity = jsonLd?.areaServed?.address?.addressLocality ?? null;

    if (!description && jsonLd?.description) {
      description = decodeHtmlEntities(jsonLd.description);
    }

    const imageUrls: string[] = [];
    if (thumbnail) {
      imageUrls.push(thumbnail);
    } else if (jsonLd?.image) {
      imageUrls.push(jsonLd.image);
    }

    return {
      external_id: `ceskereality_${listingId}`,
      source: "ceskereality",
      property_type: refinedType,
      transaction_type: transactionType,
      title,
      description: description ? truncate(description, 2000) : null,
      price,
      currency: "CZK",
      price_note: price === null ? priceNote ?? "Cena na dotaz" : null,
      address: null,
      city: jsonLdCity ?? city,
      district: null,
      region: null,
      latitude: null,
      longitude: null,
      size_m2: sizeM2,
      layout,
      floor: null,
      total_floors: null,
      condition: null,
      construction: null,
      ownership: null,
      furnishing: null,
      energy_rating: null,
      amenities: null,
      image_urls: JSON.stringify(imageUrls),
      thumbnail_url: imageUrls[0] ?? null,
      source_url: sourceUrl,
      listed_at: null,
      scraped_at: now,
      is_active: true,
      deactivated_at: null,
      seller_name: null,
      seller_phone: null,
      seller_email: null,
      seller_company: null,
      additional_params: null,
    };
  }

  // ------------------------------------------------------------------
  // Thumbnail extraction from article
  // ------------------------------------------------------------------

  private extractThumbnail(article: HTMLElement): string | null {
    const aside = article.querySelector(".i-estate__image");
    if (!aside) return null;

    const sources = aside.querySelectorAll("source");
    for (const source of sources) {
      const type = source.getAttribute("type") || "";
      const srcset = source.getAttribute("srcset") || "";
      if (type === "image/jpeg" && srcset.includes("ceskereality.cz")) {
        const firstUrl = srcset.split(",")[0].trim().split(/\s/)[0];
        if (firstUrl) return firstUrl;
      }
    }

    for (const source of sources) {
      const srcset = source.getAttribute("srcset") || "";
      if (srcset.includes("ceskereality.cz")) {
        const firstUrl = srcset.split(",")[0].trim().split(/\s/)[0];
        if (firstUrl) return firstUrl;
      }
    }

    const imgs = aside.querySelectorAll("img");
    for (const img of imgs) {
      const src = img.getAttribute("src") || "";
      if (src.includes("ceskereality.cz") && !src.includes("32x32")) {
        return src;
      }
    }

    return null;
  }

  // ------------------------------------------------------------------
  // JSON-LD matching (list page)
  // ------------------------------------------------------------------

  private findJsonLdMatch(
    title: string,
    jsonLdByName: Map<string, JsonLdOffer>,
  ): JsonLdOffer | undefined {
    if (jsonLdByName.has(title)) {
      return jsonLdByName.get(title);
    }

    for (const [name, offer] of jsonLdByName) {
      if (title.startsWith(name) || name.startsWith(title)) {
        return offer;
      }
    }

    return undefined;
  }

  // ------------------------------------------------------------------
  // JSON-LD extraction from list page HTML
  // ------------------------------------------------------------------

  private extractJsonLdListings(html: string): JsonLdOffer[] {
    const offers: JsonLdOffer[] = [];

    const jsonLdPattern =
      /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;

    while ((match = jsonLdPattern.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1]);

        if (
          data["@type"] === "RealEstateListing" &&
          Array.isArray(data.offers)
        ) {
          for (const offer of data.offers) {
            offers.push(offer as JsonLdOffer);
          }
        }

        if (
          data["@type"] === "OfferForPurchase" ||
          data["@type"] === "OfferForLease"
        ) {
          offers.push(data as JsonLdOffer);
        }
      } catch {
        // JSON parse error, skip
      }
    }

    return offers;
  }
}
