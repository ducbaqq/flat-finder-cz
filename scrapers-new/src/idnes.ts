import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import pLimit from "p-limit";
import { BaseScraper, type ScraperOptions } from "./base-scraper.js";
import type { ScraperResult, PageResult, PropertyType, TransactionType } from "./types.js";

const BASE_URL = "https://reality.idnes.cz";
const ITEMS_PER_PAGE = 30;

interface Category {
  transactionSlug: string;
  transactionType: TransactionType;
  propertySlug: string;
  propertyType: PropertyType;
}

const CATEGORIES: Category[] = [
  // Sale
  { transactionSlug: "prodej", transactionType: "sale", propertySlug: "byty", propertyType: "flat" },
  { transactionSlug: "prodej", transactionType: "sale", propertySlug: "domy", propertyType: "house" },
  { transactionSlug: "prodej", transactionType: "sale", propertySlug: "pozemky", propertyType: "land" },
  { transactionSlug: "prodej", transactionType: "sale", propertySlug: "komercni-nemovitosti", propertyType: "commercial" },
  { transactionSlug: "prodej", transactionType: "sale", propertySlug: "male-objekty-garaze", propertyType: "garage" },
  // Rent
  { transactionSlug: "pronajem", transactionType: "rent", propertySlug: "byty", propertyType: "flat" },
  { transactionSlug: "pronajem", transactionType: "rent", propertySlug: "domy", propertyType: "house" },
  { transactionSlug: "pronajem", transactionType: "rent", propertySlug: "pozemky", propertyType: "land" },
  { transactionSlug: "pronajem", transactionType: "rent", propertySlug: "komercni-nemovitosti", propertyType: "commercial" },
  { transactionSlug: "pronajem", transactionType: "rent", propertySlug: "male-objekty-garaze", propertyType: "garage" },
];

interface AjaxResponse {
  state?: Record<string, unknown>;
  snippets?: Record<string, string>;
}

class IdnesScraper extends BaseScraper {
  readonly name = "idnes";
  readonly sourceName = "idnes";
  protected readonly hasDetailPhase = true;

  constructor(opts: ScraperOptions = {}) {
    super({ name: "idnes", ...opts });
  }

  // ─── Phase 1: List scan ────────────────────────────────────────────

  async *fetchPages(): AsyncGenerator<PageResult> {
    for (const category of CATEGORIES) {
      const categoryLabel = `${category.transactionSlug}/${category.propertySlug}`;
      this.log(`Scraping category: ${categoryLabel}`);

      try {
        yield* this.fetchCategoryPages(category);
      } catch (err) {
        this.log(`  ERROR scraping ${categoryLabel}: ${err}`);
      }
    }
  }

  private async *fetchCategoryPages(category: Category): AsyncGenerator<PageResult> {
    const categoryLabel = `${category.transactionSlug}/${category.propertySlug}`;

    // Fetch page 1 via AJAX to get total count
    const firstPageHtml = await this.fetchAjaxPage(category, 1);
    if (!firstPageHtml) return;

    const totalCount = this.extractTotalCount(firstPageHtml);
    const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
    const maxPage = Math.min(totalPages, this.maxPages);
    this.log(`  ${categoryLabel}: ${totalCount} listings, ${totalPages} pages (scraping ${maxPage})`);

    // Parse page 1
    const firstPageListings = this.parseListingsHtml(firstPageHtml, category);
    if (firstPageListings.length > 0) {
      yield { category: categoryLabel, page: 1, totalPages: maxPage, listings: firstPageListings };
    }

    // Fetch remaining pages
    for (let page = 2; page <= maxPage; page++) {
      this.log(`  Fetching page ${page}/${maxPage}`);

      const html = await this.fetchAjaxPage(category, page);
      if (!html) {
        this.log(`  Empty response on page ${page}, stopping.`);
        break;
      }

      const pageListings = this.parseListingsHtml(html, category);
      if (pageListings.length === 0) {
        this.log(`  No listings on page ${page}, stopping.`);
        break;
      }

      yield { category: categoryLabel, page, totalPages: maxPage, listings: pageListings };
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
        return JSON.parse(l.image_urls).length > 1;
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

    const html = await this.http.getHtml(listing.source_url);
    const doc = parseHtml(html);

    this.enrichGps(listing, doc, html);
    this.enrichMeta(listing, doc);
    this.enrichDescription(listing, doc);
    this.enrichPropertyParams(listing, doc);
    this.enrichImages(listing, doc);
    this.enrichSellerInfo(listing, doc);

    return listing;
  }

  private enrichGps(listing: ScraperResult, _doc: HTMLElement, html: string): void {
    // GPS is in <script type="application/json" data-maptiler-json>
    const scriptMatch = html.match(/<script[^>]+data-maptiler-json[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return;

    try {
      const mapData = JSON.parse(scriptMatch[1]);

      // Check GeoJSON features
      const features = mapData?.mtMapGeoJson?.features;
      if (Array.isArray(features) && features.length > 0) {
        const firstFeature = features[0];

        if (firstFeature?.geometry?.type === "Point") {
          // Exact address: coordinates are [lng, lat]
          const coords = firstFeature.geometry.coordinates;
          if (Array.isArray(coords) && coords.length >= 2) {
            const lng = coords[0];
            const lat = coords[1];
            if (isValidCzechCoords(lat, lng)) {
              listing.latitude = lat;
              listing.longitude = lng;
              return;
            }
          }
        }
      }

      // Fallback: use map center for area-only listings
      const center = mapData?.mtMapOptions?.center;
      if (Array.isArray(center) && center.length >= 2) {
        const lng = center[0];
        const lat = center[1];
        if (isValidCzechCoords(lat, lng)) {
          listing.latitude = lat;
          listing.longitude = lng;
          addToAdditionalParams(listing, { gps_approximate: "true" });
        }
      }
    } catch {
      // Invalid JSON, skip GPS
    }
  }

  private enrichMeta(listing: ScraperResult, doc: HTMLElement): void {
    const city = doc.querySelector('meta[name="cXenseParse:qiw-reaCity"]')?.getAttribute("content");
    if (city && !listing.city) listing.city = city;

    const district = doc.querySelector('meta[name="cXenseParse:qiw-reaDistrict"]')?.getAttribute("content");
    if (district && !listing.district) listing.district = district;

    const region = doc.querySelector('meta[name="cXenseParse:qiw-reaRegion"]')?.getAttribute("content");
    if (region && !listing.region) listing.region = region;
  }

  private enrichDescription(listing: ScraperResult, doc: HTMLElement): void {
    const descEl = doc.querySelector("div.b-desc");
    if (!descEl) return;

    // Get text content, converting <br> to newlines
    const innerHTML = descEl.innerHTML;
    const text = innerHTML
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();

    if (text && text.length > 0) {
      listing.description = text;
    }
  }

  private enrichPropertyParams(listing: ScraperResult, doc: HTMLElement): void {
    const dts = doc.querySelectorAll("div.b-definition-columns dt");
    const dds = doc.querySelectorAll("div.b-definition-columns dd");

    if (dts.length === 0 || dts.length !== dds.length) return;

    const extra: Record<string, string> = {};
    const amenities: string[] = [];

    for (let i = 0; i < dts.length; i++) {
      const label = dts[i].text?.trim() ?? "";
      const dd = dds[i];
      const value = dd.text?.trim() ?? "";

      if (!label) continue;

      // Skip advertisements
      if (label.includes("Spočítej")) continue;

      const labelLower = label.toLowerCase();

      if (labelLower.includes("konstrukce budovy")) {
        listing.construction = normalizeConstruction(value);
      } else if (labelLower.includes("stav budovy")) {
        listing.condition = normalizeCondition(value);
      } else if (labelLower.includes("stav bytu") && !listing.condition) {
        listing.condition = normalizeCondition(value);
      } else if (labelLower.includes("vlastnictví") || labelLower.includes("vlastnictvi")) {
        listing.ownership = normalizeOwnership(value);
      } else if (labelLower === "penb" || labelLower.includes("energetick")) {
        listing.energy_rating = normalizeEnergyRating(value);
      } else if (labelLower.includes("podlaží") || labelLower.includes("podlazi")) {
        if (labelLower.includes("počet") || labelLower.includes("pocet")) {
          const match = value.match(/(\d+)/);
          if (match) listing.total_floors = parseInt(match[1], 10);
        } else if (!listing.floor) {
          const match = value.match(/(\d+)/);
          if (match) listing.floor = parseInt(match[1], 10);
        }
      } else if (labelLower.includes("užitná plocha") || labelLower.includes("uzitna plocha")) {
        if (!listing.size_m2) {
          const match = value.match(/([\d\s,]+)\s*m/);
          if (match) {
            const size = parseFloat(match[1].replace(/\s/g, "").replace(",", "."));
            if (!isNaN(size) && size > 0) listing.size_m2 = size;
          }
        }
      } else if (labelLower.includes("vybavení") || labelLower.includes("vybaveni")) {
        listing.furnishing = normalizeFurnishing(value);
      } else if (isAmenityLabel(labelLower)) {
        // Check if the dd contains a checkmark icon (indicating presence)
        const hasCheck = dd.querySelector("span.icon-check, .icon-yes, .b-definition__value--check") !== null
          || value.toLowerCase().includes("ano")
          || dd.innerHTML.includes("icon-check");
        if (hasCheck || (value && !value.toLowerCase().includes("ne"))) {
          amenities.push(label);
        }
      } else if (labelLower.includes("plocha pozemku")) {
        extra.plot_area = value;
      } else if (labelLower.includes("poloha domu")) {
        extra.building_position = value;
      } else if (labelLower.includes("kolaudace")) {
        extra.approval_year = value;
      } else if (labelLower.includes("datum nastěhování") || labelLower.includes("datum nastehovani")) {
        extra.move_in_date = value;
      } else if (labelLower.includes("elektřina") || labelLower.includes("voda") || labelLower.includes("odpad")) {
        extra[label] = value;
      }
    }

    if (amenities.length > 0) {
      listing.amenities = JSON.stringify(amenities);
    }

    if (Object.keys(extra).length > 0) {
      addToAdditionalParams(listing, extra);
    }
  }

  private enrichImages(listing: ScraperResult, doc: HTMLElement): void {
    const urls = new Set<string>();

    const galleryLinks = doc.querySelectorAll('a.carousel__item[data-fancybox="images"]');
    for (const a of galleryLinks) {
      const href = a.getAttribute("href");
      if (href && href.startsWith("http")) {
        urls.add(href);
      }
    }

    if (urls.size > 0) {
      const imageArr = [...urls];
      listing.image_urls = JSON.stringify(imageArr);
      listing.thumbnail_url = listing.thumbnail_url ?? imageArr[0];
    }
  }

  private enrichSellerInfo(listing: ScraperResult, doc: HTMLElement): void {
    // Agent name
    const nameEl = doc.querySelector("h2.b-author__title a");
    if (nameEl) {
      const name = nameEl.text?.trim();
      if (name) listing.seller_name = name;
    }

    // Phone
    const phoneEl = doc.querySelector('.b-author__info a[href^="tel:"]');
    if (phoneEl) {
      const href = phoneEl.getAttribute("href") ?? "";
      const phone = href.replace("tel:", "").trim();
      if (phone) listing.seller_phone = phone;
    }

    // Email — href is HTML-entity-encoded, getAttribute decodes it
    // Also strip ?subject=... query params from mailto: links
    const emailEl = doc.querySelector('.b-author__info a[href^="mailto:"]');
    if (!emailEl) {
      const allLinks = doc.querySelectorAll(".b-author a");
      for (const a of allLinks) {
        const href = a.getAttribute("href") ?? "";
        if (href.includes("mailto:")) {
          const email = extractEmail(href);
          if (email) {
            listing.seller_email = email;
            break;
          }
        }
      }
    } else {
      const href = emailEl.getAttribute("href") ?? "";
      const email = extractEmail(href);
      if (email) listing.seller_email = email;
    }

    // Company — look for a second .b-author block
    const authorBlocks = doc.querySelectorAll(".b-author");
    if (authorBlocks.length >= 2) {
      const companyLink = authorBlocks[1].querySelector("a");
      if (companyLink) {
        const company = companyLink.text?.trim();
        if (company && company !== listing.seller_name) {
          listing.seller_company = listing.seller_company ?? company;
        }
      }
    }
  }

  // ─── AJAX helpers ──────────────────────────────────────────────────

  private async fetchAjaxPage(category: Category, page: number): Promise<string | null> {
    const url = `${BASE_URL}/s/${category.transactionSlug}/${category.propertySlug}/?page=${page}`;

    try {
      const data = await this.http.get<AjaxResponse>(url, {
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE_URL}/s/${category.transactionSlug}/${category.propertySlug}/`,
      });

      return data?.snippets?.["snippet-s-result-articles"] ?? null;
    } catch (err) {
      this.log(`  Failed to fetch AJAX page ${page}: ${err}`);
      return null;
    }
  }

  private extractTotalCount(html: string): number {
    const match = html.match(/([\d\s]+)\s*inzerát/);
    if (!match) return 0;
    const numStr = match[1].replace(/\s/g, "");
    const count = parseInt(numStr, 10);
    return isNaN(count) ? 0 : count;
  }

  // ─── List-page parsing ─────────────────────────────────────────────

  private parseListingsHtml(html: string, category: Category): ScraperResult[] {
    const doc = parseHtml(html);
    const items = doc.querySelectorAll(".c-products__item");
    const results: ScraperResult[] = [];

    for (const item of items) {
      try {
        const listing = this.parseListingCard(item, category);
        if (listing) results.push(listing);
      } catch {
        // Skip individual listing parse errors
      }
    }

    return results;
  }

  private parseListingCard(item: HTMLElement, category: Category): ScraperResult | null {
    const link = item.querySelector(".c-products__link");
    if (!link) return null;

    const href = link.getAttribute("href");
    if (!href) return null;

    const idMatch = href.match(/\/([a-f0-9]{24})\/?$/);
    if (!idMatch) return null;

    const externalId = `idnes_${idMatch[1]}`;
    const sourceUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;

    const titleEl = item.querySelector(".c-products__title");
    const rawTitle = titleEl?.text?.trim().replace(/\s+/g, " ") || null;

    const infoEl = item.querySelector(".c-products__info");
    const rawAddress = infoEl?.text?.trim().replace(/\s+/g, " ") || null;

    const priceEl = item.querySelector(".c-products__price strong");
    const rawPrice = priceEl?.text?.trim() || null;
    const { price, currency, priceNote } = this.parsePrice(rawPrice);

    const imgEl = item.querySelector(".c-products__img img");
    const thumbnailUrl = imgEl?.getAttribute("data-src") || imgEl?.getAttribute("src") || null;

    const sellerCompany = link.getAttribute("data-brand") || null;

    const { layout, sizeM2 } = this.parseTitleDetails(rawTitle);
    const city = this.parseCity(rawAddress);

    const now = new Date().toISOString();

    return {
      external_id: externalId,
      source: "idnes",
      property_type: category.propertyType,
      transaction_type: category.transactionType,
      title: rawTitle,
      description: null,
      price,
      currency,
      price_note: priceNote,
      address: rawAddress,
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
      image_urls: thumbnailUrl ? JSON.stringify([thumbnailUrl]) : "[]",
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
      additional_params: null,
    };
  }

  private parsePrice(raw: string | null): { price: number | null; currency: string; priceNote: string | null } {
    if (!raw) return { price: null, currency: "CZK", priceNote: null };

    let cleaned = raw
      .replace(/&nbsp;/g, " ")
      .replace(/\u200d/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (/info\s*o\s*cen/i.test(cleaned) || /cena\s*na\s*vyžádání/i.test(cleaned) || /na\s*dotaz/i.test(cleaned)) {
      return { price: null, currency: "CZK", priceNote: cleaned };
    }

    const isEur = /€|EUR/i.test(cleaned);
    const currency = isEur ? "EUR" : "CZK";

    const numStr = cleaned.replace(/[^\d,\.]/g, "").replace(",", ".");
    const price = numStr ? parseFloat(numStr) : null;

    return {
      price: price && price > 0 ? price : null,
      currency,
      priceNote: price ? null : cleaned,
    };
  }

  private parseTitleDetails(title: string | null): { layout: string | null; sizeM2: number | null } {
    if (!title) return { layout: null, sizeM2: null };

    const layoutMatch = title.match(/(\d\+(?:kk|1|\d))/i);
    const layout = layoutMatch ? layoutMatch[1] : null;

    const sizeMatch = title.match(/(\d[\d\s]*)\s*m[²2]/i);
    let sizeM2: number | null = null;
    if (sizeMatch) {
      const numStr = sizeMatch[1].replace(/\s/g, "");
      sizeM2 = parseFloat(numStr);
      if (isNaN(sizeM2)) sizeM2 = null;
    }

    return { layout, sizeM2 };
  }

  private parseCity(address: string | null): string | null {
    if (!address) return null;

    const parts = address.split(",").map((p) => p.trim());
    const lastPart = parts[parts.length - 1];
    if (!lastPart) return null;

    const cityMatch = lastPart.match(/^([^-–]+)/);
    const city = cityMatch ? cityMatch[1].trim() : lastPart.trim();

    return city || null;
  }
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function isValidCzechCoords(lat: number, lng: number): boolean {
  return lat >= 48 && lat <= 52 && lng >= 12 && lng <= 19;
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

function normalizeEnergyRating(value: string): string | null {
  const match = value.match(/[A-G]/i);
  return match ? match[0].toUpperCase() : null;
}

function normalizeFurnishing(value: string): string {
  const v = value.toLowerCase().trim();
  if (v.includes("nezařízený") || v.includes("nezarizeny")) return "unfurnished";
  if (v.includes("částečně") || v.includes("castecne")) return "partially";
  if (v.includes("zařízený") || v.includes("zarizeny")) return "furnished";
  return value.trim();
}

function isAmenityLabel(label: string): boolean {
  const amenityKeywords = ["lodžie", "lodzie", "sklep", "terasa", "balkón", "balkon", "garáž", "garaz", "výtah", "vytah", "parkování", "parkovani"];
  return amenityKeywords.some((kw) => label.includes(kw));
}

function extractEmail(href: string): string | null {
  const raw = href.replace("mailto:", "").split("?")[0].trim();
  return raw.includes("@") ? raw : null;
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
  const scraper = new IdnesScraper({ name: "idnes", rps: getRps("idnes"), maxPages: parseMaxPages() });
  scraper.run().catch(console.error);
}

export { IdnesScraper };
