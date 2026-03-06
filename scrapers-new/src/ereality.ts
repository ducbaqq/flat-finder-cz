import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import pLimit from "p-limit";
import proj4 from "proj4";
import { BaseScraper, type ScraperOptions } from "./base-scraper.js";
import type { ScraperResult, PropertyType, TransactionType, PageResult } from "./types.js";

const BASE_URL = "https://www.ereality.cz";

// Define S-JTSK (EPSG:5514) coordinate system
proj4.defs(
  "EPSG:5514",
  "+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs",
);

/**
 * Convert S-JTSK (Krovak, EPSG:5514) coordinates to WGS84 (lat/lng).
 * Input x, y are negative Krovak values (e.g. x=-854459, y=-992348).
 */
function jtskToWgs84(x: number, y: number): { lat: number; lng: number } {
  const [lng, lat] = proj4("EPSG:5514", "EPSG:4326", [x, y]);
  return { lat, lng };
}

/**
 * All category paths to scrape: [urlPath, propertyType, transactionType]
 */
const CATEGORIES: [string, PropertyType, TransactionType][] = [
  // Sale
  ["prodej/byty", "flat", "sale"],
  ["prodej/domy", "house", "sale"],
  ["prodej/pozemky", "land", "sale"],
  ["prodej/komercni-objekty", "commercial", "sale"],
  ["prodej/ostatni", "other", "sale"],
  // Rent
  ["pronajem/byty", "flat", "rent"],
  ["pronajem/domy", "house", "rent"],
  ["pronajem/pozemky", "land", "rent"],
  ["pronajem/komercni-objekty", "commercial", "rent"],
  ["pronajem/ostatni", "other", "rent"],
];

export class ERealityScraper extends BaseScraper {
  readonly name = "ereality";
  readonly sourceName = "ereality";
  protected readonly hasDetailPhase = true;

  constructor(opts: ScraperOptions = {}) {
    super(opts);
  }

  // ─── Phase 1: List Scan ───────────────────────────────────────────

  async *fetchPages(): AsyncGenerator<PageResult> {
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
    // Fetch the first full page to extract total count
    const firstPageUrl = `${BASE_URL}/${urlPath}`;
    let firstPageHtml: string;
    try {
      firstPageHtml = await this.http.getHtml(firstPageUrl);
    } catch (err) {
      this.log(`Error fetching first page of ${urlPath}: ${err}`);
      return;
    }

    const totalCount = this.extractTotalCount(firstPageHtml);
    const pgMax = this.extractPgMax(firstPageHtml);
    const totalPages = Math.min(pgMax + 1, this.maxPages); // +1 because pg_max is 0-indexed

    this.log(`Category ${urlPath}: ${totalCount} total listings, pg_max=${pgMax}, ${totalPages} pages`);

    // Parse tiles from first page
    const firstRoot = parseHtml(firstPageHtml);
    const firstTiles = firstRoot.querySelectorAll("li.ereality-property-tile");
    const firstListings = this.parseTiles(firstTiles, propertyType, transactionType);

    if (firstListings.length > 0) {
      yield { category: urlPath, page: 1, totalPages, listings: firstListings };
    }

    // Fetch subsequent pages via AJAX
    for (let page = 2; page <= totalPages; page++) {
      const ajaxUrl = `${BASE_URL}/ajaxlist/${urlPath}?pg=${page - 1}`;
      let html: string;
      try {
        html = await this.http.getHtml(ajaxUrl);
      } catch (err) {
        this.log(`Error fetching page ${page} of ${urlPath}: ${err}`);
        break;
      }

      if (!html || html.trim().length === 0) {
        this.log(`No more pages for ${urlPath} at page ${page}`);
        break;
      }

      const root = parseHtml(`<ul>${html}</ul>`);
      const tiles = root.querySelectorAll("li.ereality-property-tile");

      if (tiles.length === 0) {
        this.log(`No tiles found on page ${page} of ${urlPath}`);
        break;
      }

      const listings = this.parseTiles(tiles, propertyType, transactionType);
      if (listings.length > 0) {
        yield { category: urlPath, page, totalPages, listings };
      }
    }
  }

  private extractTotalCount(html: string): number {
    // Look for "celkem 24255" or similar text
    const match = html.match(/celkem\s+([\d\s]+)/i);
    if (!match) return 0;
    return parseInt(match[1].replace(/\s/g, ""), 10) || 0;
  }

  private extractPgMax(html: string): number {
    // Extract pg_max JavaScript variable: var pg_max = 1102;
    const match = html.match(/pg_max\s*=\s*(\d+)/);
    if (match) return parseInt(match[1], 10);
    // Fallback: compute from total count (rough estimate, ~22 per page)
    const totalCount = this.extractTotalCount(html);
    return totalCount > 0 ? Math.ceil(totalCount / 22) : 0;
  }

  private parseTiles(
    tiles: HTMLElement[],
    propertyType: PropertyType,
    transactionType: TransactionType,
  ): ScraperResult[] {
    const listings: ScraperResult[] = [];
    for (const tile of tiles) {
      try {
        const listing = this.parseTile(tile, propertyType, transactionType);
        if (listing) listings.push(listing);
      } catch (err) {
        this.log(`Error parsing tile: ${err}`);
      }
    }
    return listings;
  }

  // ─── Phase 2: Detail Enrichment ───────────────────────────────────

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
      try { return JSON.parse(l.image_urls).length > 1; } catch { return false; }
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
    const root = parseHtml(html);

    // GPS from OpenStreetMap iframe
    const { latitude, longitude } = this.extractGps(html);
    if (latitude !== null && longitude !== null) {
      listing.latitude = latitude;
      listing.longitude = longitude;
    }

    // Full description
    const descEl = root.querySelector("p.ereality-property-description-text");
    if (descEl) {
      listing.description = descEl.text.trim() || listing.description;
    }

    // Full image gallery
    const images = this.extractImages(html);
    if (images.length > 0) {
      listing.image_urls = JSON.stringify(images);
      if (!listing.thumbnail_url) {
        listing.thumbnail_url = images[0];
      }
    }

    // Verify/update price from detail page
    const priceEl = root.querySelector("div.ereality-property-price");
    if (priceEl) {
      const { price, currency, priceNote } = this.parsePrice(priceEl.text.trim());
      if (price !== null) {
        listing.price = price;
        listing.currency = currency;
        if (priceNote) listing.price_note = priceNote;
      }
    }

    // Breadcrumb parsing for district/city refinement
    // e.g. "Praha > Praha 3 > Poděbrady > pronájem > byty > 3+kk"
    const breadcrumbLinks = root.querySelectorAll(
      "ul.ereality-breadcrumb li a, nav.breadcrumb a, .breadcrumb a",
    );
    if (breadcrumbLinks.length > 0) {
      const crumbs = breadcrumbLinks.map((a) => a.text.trim()).filter(Boolean);
      for (const crumb of crumbs) {
        // District pattern: contains a digit (Praha 3, Brno 2) or directional suffix
        if (/\d/.test(crumb) || /\b(sever|jih|západ|východ|střed)\b/i.test(crumb)) {
          if (!listing.district) listing.district = crumb;
        }
      }
      // First crumb is often the top-level city
      if (crumbs.length > 0 && !listing.city) {
        listing.city = crumbs[0];
      }
    }

    // Source attribution from redirect links
    // e.g. /presmeruj/idnes-reality/{hash} → "idnes reality"
    const redirectLinks = root.querySelectorAll("a[href*='/presmeruj/']");
    for (const link of redirectLinks) {
      const href = link.getAttribute("href") ?? "";
      const sourceMatch = href.match(/\/presmeruj\/([^/]+)\//);
      if (sourceMatch) {
        const originalSource = sourceMatch[1].replace(/-/g, " ");
        const existing = listing.additional_params
          ? JSON.parse(listing.additional_params)
          : {};
        existing.original_source = originalSource;
        listing.additional_params = JSON.stringify(existing);
        break;
      }
    }

    return listing;
  }

  private extractGps(html: string): { latitude: number | null; longitude: number | null } {
    // Method 1: OpenStreetMap iframe — marker=50.390200%2C12.768500
    const osmMatch = html.match(/marker=([\d.]+)%2C([\d.]+)/);
    if (osmMatch) {
      const lat = parseFloat(osmMatch[1]);
      const lng = parseFloat(osmMatch[2]);
      if (this.isValidCzechCoords(lat, lng)) {
        return { latitude: lat, longitude: lng };
      }
    }

    // Method 2: JTSK (Krovak) coordinates from cadastre link — x=-854459&y=-992348
    const jtskMatch = html.match(/[?&]x=(-?\d+)[^&]*&y=(-?\d+)/);
    if (jtskMatch) {
      const x = parseInt(jtskMatch[1], 10);
      const y = parseInt(jtskMatch[2], 10);
      if (x !== 0 && y !== 0) {
        const { lat, lng } = jtskToWgs84(x, y);
        if (this.isValidCzechCoords(lat, lng)) {
          return { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6 };
        }
      }
    }

    return { latitude: null, longitude: null };
  }

  private isValidCzechCoords(lat: number, lng: number): boolean {
    return !isNaN(lat) && !isNaN(lng) && lat >= 48 && lat <= 52 && lng >= 12 && lng <= 19;
  }

  private extractImages(html: string): string[] {
    // Extract image URLs from the detail page - look for reality image hosts
    const imagePattern = /https?:\/\/sta-reality\d*\.1gr\.cz[^"'\s)]+\.(?:jpg|jpeg|png|webp)/gi;
    const matches = html.match(imagePattern) ?? [];
    // Deduplicate
    return [...new Set(matches)];
  }

  // ─── Tile Parsing (shared) ────────────────────────────────────────

  private parseTile(
    tile: HTMLElement,
    propertyType: PropertyType,
    transactionType: TransactionType,
  ): ScraperResult | null {
    const linkEl = tile.querySelector("a.ereality-property-image");
    if (!linkEl) return null;

    const href = linkEl.getAttribute("href") ?? "";

    // Extract the ID from the onclick handler: kliknuto('ID', 1)
    const onclickAttr = linkEl.getAttribute("onclick") ?? "";
    const idMatch = onclickAttr.match(/kliknuto\('([a-f0-9]+)'/);
    const externalId = idMatch ? idMatch[1] : this.extractIdFromHref(href);
    if (!externalId) return null;

    // Build source URL
    let sourceUrl: string;
    if (href.startsWith("/detail/") || href.startsWith("/presmeruj/")) {
      sourceUrl = `${BASE_URL}${href}`;
    } else {
      sourceUrl = href;
    }

    // Title
    const headingEl = tile.querySelector("strong.ereality-property-heading");
    const title = headingEl?.text?.trim() ?? null;

    // Locality (city, district)
    const localityEl = tile.querySelector("p.ereality-property-locality");
    const localityText = localityEl?.text?.trim() ?? "";
    const { city, district } = this.parseLocality(localityText);

    // Description snippet
    const descEl = tile.querySelector("p.ereality-property-text");
    const description = descEl?.text?.trim() ?? null;

    // Agency / source
    const agencyEl = tile.querySelector("p.ereality-property-agency");
    const agencyText = agencyEl?.text?.trim() ?? "";
    const sellerCompany = agencyText.replace(/^zdroj:\s*/i, "").trim() || null;

    // Price
    const priceEl = tile.querySelector("div.ereality-property-price");
    const priceText = priceEl?.text?.trim() ?? "";
    const { price, currency, priceNote } = this.parsePrice(priceText);

    // Image
    const imgEl = tile.querySelector("img.ereality-property-photo");
    const thumbnailUrl = imgEl?.getAttribute("src") ?? null;
    const imageUrls = thumbnailUrl ? JSON.stringify([thumbnailUrl]) : "[]";

    // Try to extract size and layout from title
    const sizeM2 = this.extractSize(title ?? "");
    const layout = this.extractLayout(title ?? "");

    // View count
    const viewSpan = tile.querySelector("span[data-content]");
    const viewContent = viewSpan?.getAttribute("data-content") ?? "";
    const viewMatch = viewContent.match(/(\d+)\s+shlédn/);
    const viewCount = viewMatch ? parseInt(viewMatch[1], 10) : null;

    const now = new Date().toISOString();

    return {
      external_id: `ereality_${externalId}`,
      source: "ereality",
      property_type: propertyType,
      transaction_type: transactionType,
      title,
      description,
      price,
      currency,
      price_note: priceNote,
      address: localityText || null,
      city,
      district,
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
      image_urls: imageUrls,
      thumbnail_url: thumbnailUrl,
      source_url: sourceUrl,
      listed_at: null,
      scraped_at: now,
      is_active: true,
      deactivated_at: null,
      seller_name: null,
      seller_phone: null,
      seller_email: null,
      seller_company: sellerCompany,
      additional_params: viewCount ? JSON.stringify({ view_count: viewCount }) : null,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private extractIdFromHref(href: string): string | null {
    const match = href.match(/\/([a-f0-9]{16})$/);
    return match ? match[1] : null;
  }

  private parseLocality(text: string): { city: string | null; district: string | null } {
    if (!text) return { city: null, district: null };

    const parts = text.split(",").map((p) => p.trim());

    let city: string | null = null;
    let district: string | null = null;

    if (parts.length >= 2) {
      city = parts[0].replace(/\s*\(.*?\)\s*/, " ").trim() || null;
      const districtPart = parts[1].trim();
      district = districtPart.replace(/^okres\s+/i, "").trim() || null;
    } else if (parts.length === 1) {
      city = parts[0].trim() || null;
    }

    return { city, district };
  }

  private parsePrice(text: string): {
    price: number | null;
    currency: string;
    priceNote: string | null;
  } {
    if (!text || text.toLowerCase().includes("neuvedena")) {
      return { price: null, currency: "CZK", priceNote: "neuvedena" };
    }

    let currency = "CZK";
    if (text.includes("€") || text.toLowerCase().includes("eur")) {
      currency = "EUR";
    }

    const cleanedText = text.replace(/[^\d]/g, "");
    const price = cleanedText ? parseInt(cleanedText, 10) : null;

    let priceNote: string | null = null;
    if (text.includes("/měsíc")) {
      priceNote = "za měsíc";
    } else if (text.toLowerCase().includes("info v rk") || text.toLowerCase().includes("info v kanceláři")) {
      priceNote = text.trim();
      return { price: null, currency, priceNote };
    }

    return { price: price && price > 0 ? price : null, currency, priceNote };
  }

  private extractSize(title: string): number | null {
    const match = title.match(/(\d+)\s*m[²2]/i);
    return match ? parseInt(match[1], 10) : null;
  }

  private extractLayout(title: string): string | null {
    const match = title.match(/(\d\+(?:kk|1|\d))/i);
    if (match) return match[1];

    if (title.toLowerCase().includes("atypick")) return "atypicky";
    if (title.toLowerCase().includes("garsoniér") || title.toLowerCase().includes("garsonka")) return "1+kk";

    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { parseMaxPages } = await import("./cli.js");
  const scraper = new ERealityScraper({ name: "ereality", rps: 3, maxPages: parseMaxPages() });
  scraper.run().catch(console.error);
}
