import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import pLimit from "p-limit";
import { BaseScraper, type ScraperOptions } from "./base-scraper.js";
import type { ScraperResult, PageResult, PropertyType, TransactionType } from "./types.js";

// ---------------------------------------------------------------------------
// Category configuration
// ---------------------------------------------------------------------------

interface CategoryConfig {
  slug: string;
  propertyType: PropertyType;
}

const SALE_CATEGORIES: CategoryConfig[] = [
  { slug: "byt", propertyType: "flat" },
  { slug: "dum", propertyType: "house" },
  { slug: "projekty", propertyType: "flat" },
  { slug: "garaz", propertyType: "garage" },
  { slug: "restaurace", propertyType: "commercial" },
  { slug: "chata", propertyType: "cottage" },
  { slug: "kancelar", propertyType: "commercial" },
  { slug: "prostory", propertyType: "commercial" },
  { slug: "pozemek", propertyType: "land" },
  { slug: "sklad", propertyType: "commercial" },
  { slug: "zahrada", propertyType: "land" },
  { slug: "ostatni", propertyType: "other" },
];

const RENT_CATEGORIES: CategoryConfig[] = [
  { slug: "byt", propertyType: "flat" },
  { slug: "dum", propertyType: "house" },
  { slug: "projekty", propertyType: "flat" },
  { slug: "podnajem", propertyType: "flat" },
  { slug: "garaz", propertyType: "garage" },
  { slug: "restaurace", propertyType: "commercial" },
  { slug: "kancelar", propertyType: "commercial" },
  { slug: "prostory", propertyType: "commercial" },
  { slug: "pozemek", propertyType: "land" },
  { slug: "sklad", propertyType: "commercial" },
  { slug: "zahrada", propertyType: "land" },
  { slug: "ostatni", propertyType: "other" },
];

const BASE_URL = "https://reality.bazos.cz";
const ITEMS_PER_PAGE = 20;

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export class BazosScraper extends BaseScraper {
  readonly name = "bazos";
  readonly sourceName = "bazos";
  protected readonly hasDetailPhase = true;

  constructor(opts: ScraperOptions = {}) {
    super({ ...opts, name: "bazos" });
  }

  // ─── Phase 1: List scan ────────────────────────────────────────────

  async *fetchPages(): AsyncGenerator<PageResult> {
    const categories: [string, CategoryConfig, TransactionType][] = [
      ...SALE_CATEGORIES.map(
        (c) => ["prodam", c, "sale" as TransactionType] as [string, CategoryConfig, TransactionType],
      ),
      ...RENT_CATEGORIES.map(
        (c) => ["pronajmu", c, "rent" as TransactionType] as [string, CategoryConfig, TransactionType],
      ),
    ];

    for (const [txnSlug, cat, transactionType] of categories) {
      try {
        yield* this.fetchCategoryPages(txnSlug, cat, transactionType);
      } catch (err) {
        this.log(`Error scraping ${txnSlug}/${cat.slug}: ${err}`);
      }
    }
  }

  private async *fetchCategoryPages(
    txnSlug: string,
    cat: CategoryConfig,
    transactionType: TransactionType,
  ): AsyncGenerator<PageResult> {
    const catName = `${txnSlug}/${cat.slug}`;
    const basePath = `/${txnSlug}/${cat.slug}/`;

    // Fetch first page to get total count
    const firstUrl = `${BASE_URL}${basePath}`;
    let html: string;
    try {
      html = await this.http.getHtml(firstUrl);
    } catch (err) {
      this.log(`Failed to fetch first page of ${catName}: ${err}`);
      return;
    }

    const doc = parseHtml(html);
    const totalCount = this.parseTotalCount(doc);
    const totalPages = Math.min(
      totalCount > 0 ? Math.ceil(totalCount / ITEMS_PER_PAGE) : 1,
      this.maxPages,
    );

    this.log(`${catName}: ${totalCount} listings, ${totalPages} pages`);

    // Parse first page
    const listings = this.parseListings(doc, cat.propertyType, transactionType);
    if (listings.length > 0) {
      yield { category: catName, page: 1, totalPages, listings };
    } else {
      return;
    }

    // Subsequent pages
    for (let page = 2; page <= totalPages; page++) {
      const offset = (page - 1) * ITEMS_PER_PAGE;
      const pageUrl = `${BASE_URL}${basePath}${offset}/`;

      try {
        html = await this.http.getHtml(pageUrl);
      } catch (err) {
        this.log(`Failed to fetch ${catName} page ${page}: ${err}`);
        break;
      }

      const pageDoc = parseHtml(html);
      const pageListings = this.parseListings(pageDoc, cat.propertyType, transactionType);

      if (pageListings.length === 0) {
        this.log(`${catName} page ${page}: no listings, stopping`);
        break;
      }

      yield { category: catName, page, totalPages, listings: pageListings };
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
    const withImages = enriched.filter((l) => {
      try {
        return JSON.parse(l.image_urls).length > 1;
      } catch {
        return false;
      }
    }).length;
    this.log(
      `Enrichment: ${withGps}/${enriched.length} GPS, ${withImages}/${enriched.length} gallery`,
    );

    return enriched;
  }

  private async enrichOne(listing: ScraperResult): Promise<ScraperResult> {
    if (!listing.source_url) return listing;

    const html = await this.http.getHtml(listing.source_url);
    const doc = parseHtml(html);

    // GPS from Google Maps link: maps/place/{lat},{lng}/
    const mapsMatch = html.match(/maps\/place\/([\d.]+),([\d.]+)\//);
    if (mapsMatch) {
      const lat = parseFloat(mapsMatch[1]);
      const lng = parseFloat(mapsMatch[2]);
      if (lat >= 48 && lat <= 52 && lng >= 12 && lng <= 19) {
        listing.latitude = lat;
        listing.longitude = lng;
      }
    }

    // All images from Flickity carousel
    const imageEls = doc.querySelectorAll("img.carousel-cell-image");
    if (imageEls.length > 0) {
      const images: string[] = [];
      for (const img of imageEls) {
        const src =
          img.getAttribute("data-flickity-lazyload") ?? img.getAttribute("src");
        if (src) images.push(src);
      }
      if (images.length > 0) {
        listing.image_urls = JSON.stringify(images);
        listing.thumbnail_url = listing.thumbnail_url ?? images[0];
      }
    }

    // Full description from div.popis
    const popisDiv = doc.querySelector("div.popis");
    if (popisDiv) {
      const fullDesc = popisDiv.textContent.trim();
      if (fullDesc && fullDesc.length > (listing.description?.length ?? 0)) {
        listing.description = fullDesc;
      }
    }

    // Seller name from table: <td>Jméno:</td><td>...<b>Name</b>...</td>
    const tds = doc.querySelectorAll("td");
    for (let i = 0; i < tds.length; i++) {
      if (tds[i].textContent.includes("Jméno:") && i + 1 < tds.length) {
        const nameB = tds[i + 1].querySelector("b");
        if (nameB) {
          listing.seller_name = nameB.textContent.trim() || null;
        }
        break;
      }
    }

    return listing;
  }

  // ─── Parsing helpers ───────────────────────────────────────────────

  private parseTotalCount(doc: HTMLElement): number {
    const nadpis = doc.querySelector("div.inzeratynadpis");
    if (!nadpis) return 0;

    const text = nadpis.textContent;
    const match = text.match(/z\s+([\d\s]+)/);
    if (!match) return 0;

    return parseInt(match[1].replace(/\s/g, ""), 10) || 0;
  }

  private parseListings(
    doc: HTMLElement,
    propertyType: PropertyType,
    transactionType: TransactionType,
  ): ScraperResult[] {
    const results: ScraperResult[] = [];
    const now = new Date().toISOString();
    const listingDivs = doc.querySelectorAll("div.inzeraty.inzeratyflex");

    for (const div of listingDivs) {
      try {
        const listing = this.parseListing(div, propertyType, transactionType, now);
        if (listing) results.push(listing);
      } catch (err) {
        this.log(`Failed to parse a listing: ${err}`);
      }
    }

    return results;
  }

  private parseListing(
    div: HTMLElement,
    propertyType: PropertyType,
    transactionType: TransactionType,
    now: string,
  ): ScraperResult | null {
    const titleLink = div.querySelector("h2.nadpis a") ?? div.querySelector("h2 a");
    if (!titleLink) return null;

    const href = titleLink.getAttribute("href") ?? "";
    const title = titleLink.textContent.trim();

    const idMatch = href.match(/\/inzerat\/(\d+)\//);
    if (!idMatch) return null;
    const externalId = `bazos_${idMatch[1]}`;
    const sourceUrl = `${BASE_URL}${href}`;

    // Thumbnail
    const img = div.querySelector("img.obrazek");
    const thumbnailUrl = img?.getAttribute("src") ?? null;

    let imageUrls: string[] = [];
    if (thumbnailUrl) {
      const fullImg = thumbnailUrl.replace("/img/1t/", "/img/1/");
      imageUrls = [fullImg];
    }

    // Price
    const priceDiv = div.querySelector("div.inzeratycena");
    const priceText = priceDiv?.textContent?.trim() ?? "";
    const { price, priceNote } = this.parsePrice(priceText);

    // Location
    const lokDiv = div.querySelector("div.inzeratylok");
    const { city, postalCode } = this.parseLocation(lokDiv);

    // Description snippet (enrichment replaces with full text)
    const popisDiv = div.querySelector("div.popis") ?? div.querySelector(".popis");
    const description = popisDiv?.textContent?.trim() ?? null;

    // Date
    const dateSpan = div.querySelector("span.velikost10");
    const listedAt = this.parseDate(dateSpan?.textContent ?? "");

    // Size and layout from title/description
    const sizeM2 = this.extractSize(title, description);
    const layout = this.extractLayout(title, description);

    return {
      external_id: externalId,
      source: "bazos",
      property_type: propertyType,
      transaction_type: transactionType,
      title: title || null,
      description,
      price,
      currency: "CZK",
      price_note: priceNote,
      address: postalCode ? [city, postalCode].filter(Boolean).join(", ") : city,
      city,
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
      thumbnail_url: thumbnailUrl,
      source_url: sourceUrl,
      listed_at: listedAt,
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

  private parsePrice(text: string): { price: number | null; priceNote: string | null } {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return { price: null, priceNote: null };

    const lowerCleaned = cleaned.toLowerCase();
    if (
      lowerCleaned.includes("dohodou") ||
      lowerCleaned.includes("v textu") ||
      lowerCleaned.includes("nabídněte") ||
      lowerCleaned.includes("info v tel") ||
      lowerCleaned === "0 kč" ||
      lowerCleaned === "1 kč"
    ) {
      return { price: null, priceNote: cleaned };
    }

    const numStr = cleaned.replace(/[^\d]/g, "");
    const price = numStr ? parseInt(numStr, 10) : null;
    if (price !== null && price > 0) {
      return { price, priceNote: null };
    }
    return { price: null, priceNote: cleaned || null };
  }

  private parseLocation(
    lokDiv: HTMLElement | null,
  ): { city: string | null; postalCode: string | null } {
    if (!lokDiv) return { city: null, postalCode: null };

    const html = lokDiv.innerHTML;
    const parts = html.split("<br");
    const city = parts[0]?.replace(/<[^>]*>/g, "").trim() || null;

    let postalCode: string | null = null;
    if (parts[1]) {
      const pscText = parts[1].replace(/<[^>]*>/g, "").replace(/^[^>]*>/, "").trim();
      const pscMatch = pscText.match(/\d{3}\s*\d{2}/);
      postalCode = pscMatch ? pscMatch[0].trim() : null;
    }

    return { city, postalCode };
  }

  private parseDate(text: string): string | null {
    const match = text.match(/\[(\d{1,2})\.(\d{1,2})\.\s*(\d{4})\]/);
    if (!match) return null;
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  private extractSize(title: string, description: string | null): number | null {
    const combined = `${title} ${description ?? ""}`;
    const match = combined.match(/(\d+[.,]?\d*)\s*m[²2]/i);
    if (match) {
      const num = parseFloat(match[1].replace(",", "."));
      if (num > 0 && num < 100000) return num;
    }
    return null;
  }

  private extractLayout(title: string, description: string | null): string | null {
    const combined = `${title} ${description ?? ""}`;
    const match = combined.match(/\b(\d\+(?:kk|KK|\d))\b/i);
    return match ? match[1].toLowerCase() : null;
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const { parseMaxPages, getRps } = await import("./cli.js");
  const scraper = new BazosScraper({ name: "bazos", rps: getRps("bazos"), maxPages: parseMaxPages() });
  scraper.run().catch(console.error);
}
