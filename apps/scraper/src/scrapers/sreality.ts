import pLimit from "p-limit";
import type { ScraperResult, PropertyType, TransactionType } from "@flat-finder/types";
import { BaseScraper, type ScraperOptions, type PageResult } from "../base-scraper.js";

// ---------------------------------------------------------------------------
// Constants & lookup maps
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.sreality.cz/api/cs/v2";
const PER_PAGE_FULL = 200;
const PER_PAGE_WATCH = 20;

/**
 * (category_main_cb, category_type_cb) combinations to fetch.
 *   category_main_cb: 1=flat, 2=house, 3=land, 4=commercial, 5=other
 *   category_type_cb: 1=sale, 2=rent, 3=auction
 */
const CATEGORIES: [number, number][] = [
  [1, 1], [1, 2], [1, 3], // flat: sale, rent, auction
  [2, 1], [2, 2], [2, 3], // house: sale, rent, auction
  [3, 1],                  // land: sale only
  [4, 1], [4, 2],          // commercial: sale, rent
  [5, 1], [5, 2],          // other (garages etc.): sale, rent
];

const PROPERTY_TYPE_MAP: Record<number, PropertyType> = {
  1: "flat",
  2: "house",
  3: "land",
  4: "commercial",
  5: "other",
};

const TRANSACTION_TYPE_MAP: Record<number, TransactionType> = {
  1: "sale",
  2: "rent",
  3: "auction",
};

const GARAGE_SUB_CB = 52;

const TRANSACTION_CZ: Record<string, string> = {
  sale: "prodej",
  rent: "pronajem",
  auction: "drazby",
};

const PROPERTY_CZ: Record<string, string> = {
  flat: "byt",
  house: "dum",
  land: "pozemek",
  commercial: "komercni",
  other: "ostatni",
  garage: "garaz",
};

/**
 * category_sub_cb -> URL slug for the disposition/type path segment
 */
const SUB_SLUGS: Record<number, string> = {
  // Flats
  2: "1+kk", 3: "1+1", 4: "2+kk", 5: "2+1",
  6: "3+kk", 7: "3+1", 8: "4+kk", 9: "4+1",
  10: "5+kk", 11: "5+1", 12: "6-a-vice", 16: "atypicky", 47: "pokoj",
  // Houses
  33: "rodinny-dum", 35: "vila", 37: "chalupa", 39: "chata",
  43: "pamatka", 44: "na-klic", 46: "zemedelska-usedlost",
  // Land
  19: "bydleni", 20: "komercni", 21: "pole", 22: "louky",
  23: "lesy", 24: "rybniky", 25: "sady-vinice",
  // Commercial
  26: "kancelare", 27: "sklady", 28: "vyrobni", 29: "obchodni",
  30: "ubytovani", 31: "restaurace", 32: "zemedelske",
  36: "cinzovni-dum", 38: "virtualni-kancelar",
  // Other
  34: "ostatni", 48: "garazove-stani", 52: "garaz", 50: "vinny-sklep",
};

// ---------------------------------------------------------------------------
// Sreality scraper
// ---------------------------------------------------------------------------

export class SrealityScraper extends BaseScraper {
  readonly name = "sreality";
  readonly baseUrl = BASE_URL;

  private readonly batchMultiplier: number;
  private readonly detailBatchSize: number;
  private readonly perPage: number;

  constructor(
    opts: ScraperOptions & { batchMultiplier?: number; detailBatchSize?: number },
  ) {
    super(opts);
    this.batchMultiplier = opts.batchMultiplier ?? 2;
    this.detailBatchSize = opts.detailBatchSize ?? 20;
    this.perPage = opts.watchMode ? PER_PAGE_WATCH : PER_PAGE_FULL;
  }

  // ------------------------------------------------------------------
  // Public entry point
  // ------------------------------------------------------------------

  async *fetchPages(): AsyncGenerator<PageResult> {
    this.init();
    const batchSize = this.batchMultiplier * this.concurrency;

    for (const [catMain, catType] of CATEGORIES) {
      const catName = `${TRANSACTION_TYPE_MAP[catType] ?? "unknown"}/${PROPERTY_TYPE_MAP[catMain] ?? "unknown"}`;
      this.log(`Fetching: ${catName}`);

      // Fetch page 1 to discover total_pages
      let firstPage: SrealityListResponse;
      try {
        firstPage = await this.fetchPage(catMain, catType, 1);
      } catch (err) {
        this.log(`Error fetching page 1 of ${catName}: ${err}`);
        continue;
      }

      if (!firstPage || typeof firstPage !== "object") {
        this.log(`Unexpected response type for ${catName} page 1`);
        continue;
      }

      const resultSize = firstPage.result_size ?? 0;
      const totalPages = Math.max(1, Math.ceil(resultSize / this.perPage));
      this.log(`  ${catName}: ${resultSize} listings, ${totalPages} pages`);

      // Yield page 1 immediately
      const page1Results = this.parsePageEstates(firstPage);
      yield { category: catName, page: 1, totalPages, listings: page1Results };

      if (totalPages <= 1) continue;

      // Batch-concurrent fetching of remaining pages
      const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

      for (let bStart = 0; bStart < remaining.length; bStart += batchSize) {
        if (this.isCategorySkipped(catName)) break;
        const batchPages = remaining.slice(bStart, bStart + batchSize);
        this.log(
          `  ${catName}: Fetching pages ${batchPages[0]}-${batchPages[batchPages.length - 1]} concurrently`,
        );

        const pagePromises = batchPages.map((p) =>
          this.limiter(() => this.fetchPage(catMain, catType, p).catch((err) => {
            this.log(`Error fetching page ${p} of ${catName}: ${err}`);
            return null;
          })),
        );

        const pageResults = await Promise.all(pagePromises);

        for (let j = 0; j < pageResults.length; j++) {
          if (this.isCategorySkipped(catName)) break;
          const pgData = pageResults[j];
          if (!pgData || typeof pgData !== "object") continue;
          const parsed = this.parsePageEstates(pgData);
          yield { category: catName, page: batchPages[j], totalPages, listings: parsed };
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Enrichment (public)
  // ------------------------------------------------------------------

  override get hasDetailPhase(): boolean {
    return true;
  }

  override async enrichListings(
    listings: ScraperResult[],
    opts?: { concurrency?: number; batchSize?: number },
  ): Promise<void> {
    this.init();
    const batchSize = opts?.batchSize ?? this.detailBatchSize;
    const limit = opts?.concurrency ? pLimit(opts.concurrency) : this.limiter;

    for (let i = 0; i < listings.length; i += batchSize) {
      const batch = listings.slice(i, i + batchSize);
      const detailPromises = batch.map((listing) => {
        const hashId = listing.external_id.replace("sreality_", "");
        return limit(async () => {
          const detail = await this.fetchDetail(Number(hashId));
          return { listing, detail };
        });
      });

      const results = await Promise.all(detailPromises);
      for (const { listing, detail } of results) {
        if (detail) {
          this.enrichFromDetail(listing, detail);
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Page fetching
  // ------------------------------------------------------------------

  private async fetchPage(
    catMain: number,
    catType: number,
    page: number,
  ): Promise<SrealityListResponse> {
    const url =
      `${BASE_URL}/estates` +
      `?category_main_cb=${catMain}` +
      `&category_type_cb=${catType}` +
      `&per_page=${this.perPage}` +
      `&page=${page}`;

    return this.http.get<SrealityListResponse>(url, {
      Referer: "https://www.sreality.cz/",
      "X-Requested-With": "XMLHttpRequest",
    });
  }

  // ------------------------------------------------------------------
  // Detail fetching
  // ------------------------------------------------------------------

  private async fetchDetail(hashId: number): Promise<SrealityDetailResponse | null> {
    const url = `${BASE_URL}/estates/${hashId}`;
    try {
      return await this.http.get<SrealityDetailResponse>(url, {
        Referer: `https://www.sreality.cz/detail/prodej/byt/${hashId}`,
      });
    } catch (err) {
      this.log(`Detail fetch failed for hash_id=${hashId}: ${err}`);
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Parsing
  // ------------------------------------------------------------------

  private parsePageEstates(data: SrealityListResponse): ScraperResult[] {
    const estates = data?._embedded?.estates ?? [];
    const results: ScraperResult[] = [];

    for (const estate of estates) {
      const hashId = estate.hash_id;
      if (!hashId) continue;
      try {
        results.push(this.parseBasicListing(estate));
      } catch (err) {
        this.log(`Parse error for hash_id=${hashId}: ${err}`);
      }
    }

    return results;
  }

  private parseBasicListing(estate: SrealityEstate): ScraperResult {
    const hashId = estate.hash_id;
    const seo = estate.seo ?? {};
    let catMain = seo.category_main_cb ?? 0;
    let catSub = seo.category_sub_cb ?? 0;
    let catType = seo.category_type_cb ?? 0;

    if (catMain === 0) catMain = estate.category_main_cb ?? 0;
    if (catType === 0) catType = estate.category_type_cb ?? 0;

    const propertyType = mapPropertyType(catMain, catSub);
    const transactionType = TRANSACTION_TYPE_MAP[catType] ?? "sale";

    const name = estate.name ?? "";
    const layout = extractLayoutFromName(name);

    // Price
    let price: number | null = null;
    const priceCzk = estate.price_czk;
    if (priceCzk) {
      price = priceCzk.value_raw ?? null;
    }
    if (price == null) {
      price = estate.price ?? null;
    }

    // GPS
    const gps = estate.gps ?? {};
    const lat = gps.lat ?? null;
    const lng = gps.lon ?? null;

    // Address / locality
    const locality = estate.locality ?? "";

    // Images
    const links = estate._links ?? {};
    const imagesRaw: Array<{ href?: string }> = links.images ?? [];
    const imageUrls: string[] = [];
    for (const img of imagesRaw) {
      let href = img.href ?? "";
      if (href && !href.startsWith("http")) {
        href = "https://cdn.sreality.cz" + href;
      }
      if (href) imageUrls.push(href);
    }
    const thumbnailUrl = imageUrls[0] ?? null;

    // Source URL
    const transCz = TRANSACTION_CZ[transactionType] ?? transactionType;
    const propCz = PROPERTY_CZ[propertyType] ?? propertyType;
    const subSlug = SUB_SLUGS[catSub] ?? "x";
    const sourceUrl = `https://www.sreality.cz/detail/${transCz}/${propCz}/${subSlug}/x/${hashId}`;

    const now = new Date().toISOString();
    const { city, district } = extractCityAndDistrict(locality);

    return {
      external_id: `sreality_${hashId}`,
      source: "sreality",
      property_type: propertyType,
      transaction_type: transactionType,
      title: name || null,
      description: null,
      price: price != null ? Number(price) : null,
      currency: "CZK",
      price_note: null,
      address: locality || null,
      city,
      district,
      region: null,
      latitude: lat,
      longitude: lng,
      size_m2: extractSizeFromName(name),
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

  private enrichFromDetail(listing: ScraperResult, detail: SrealityDetailResponse): void {
    // Description
    const textObj = detail.text;
    if (textObj && typeof textObj === "object") {
      listing.description = (textObj as { value?: string }).value ?? listing.description;
    }

    // GPS (more precise from detail)
    const mapData = detail.map;
    if (mapData) {
      listing.latitude = mapData.lat ?? listing.latitude;
      listing.longitude = mapData.lon ?? listing.longitude;
    }

    // Title (more precise)
    const nameData = detail.name;
    if (nameData && typeof nameData === "object" && (nameData as { value?: string }).value) {
      listing.title = (nameData as { value: string }).value;
    }

    // Address
    const locality = detail.locality;
    if (locality && typeof locality === "object" && (locality as { value?: string }).value) {
      const locValue = (locality as { value: string }).value;
      listing.address = locValue;
      const parsed = extractCityAndDistrict(locValue);
      listing.city = parsed.city;
      if (parsed.district) listing.district = parsed.district;
    }

    // Images
    const embedded = detail._embedded ?? {};
    const imagesRaw: Array<{ href?: string }> = embedded.images ?? [];
    const imageUrls: string[] = [];
    for (const img of imagesRaw) {
      let href = img.href ?? "";
      if (href && !href.startsWith("http")) {
        href = "https://cdn.sreality.cz" + href;
      }
      if (href) imageUrls.push(href);
    }
    if (imageUrls.length > 0) {
      listing.image_urls = JSON.stringify(imageUrls);
      listing.thumbnail_url = imageUrls[0];
    }

    // Seller info
    const seller = embedded.seller;
    if (seller) {
      listing.seller_name = seller.user_name ?? null;

      // Phone
      const phones = seller.phones;
      if (Array.isArray(phones) && phones.length > 0) {
        const firstPhone = phones[0];
        if (typeof firstPhone === "object" && firstPhone !== null) {
          listing.seller_phone = firstPhone.number ?? firstPhone.code ?? null;
        } else if (typeof firstPhone === "string") {
          listing.seller_phone = firstPhone;
        }
      }

      listing.seller_email = seller.email ?? null;

      // Company
      let company = seller.company_name;
      if (!company) {
        const premise = seller._embedded?.premise;
        if (premise) {
          company = premise.name;
        }
      }
      listing.seller_company = company ?? null;
    }

    // Items array -- property details
    const extraParams: Record<string, string> = {};
    const items: Array<{ name?: string; value?: unknown }> = detail.items ?? [];

    for (const item of items) {
      const itemName = (item.name ?? "").trim();
      let itemValue: unknown = item.value;

      if (itemValue == null) continue;

      // Handle nested value objects
      if (typeof itemValue === "object" && !Array.isArray(itemValue) && itemValue !== null) {
        itemValue = (itemValue as Record<string, unknown>).value ?? itemValue;
      }
      if (Array.isArray(itemValue) && itemValue.length > 0) {
        itemValue = itemValue[0];
        if (typeof itemValue === "object" && itemValue !== null) {
          itemValue = (itemValue as Record<string, unknown>).value ?? "";
        }
      }

      const valStr = itemValue != null ? String(itemValue).trim() : "";

      if (itemName === "Celková cena" || itemName === "Cena") {
        // Already have price from list
      } else if (itemName === "Stavba") {
        listing.construction = valStr;
      } else if (itemName === "Stav objektu") {
        listing.condition = valStr;
      } else if (itemName === "Vlastnictví") {
        listing.ownership = valStr;
      } else if (itemName === "Podlaží" || itemName === "Podlaží z celku") {
        // e.g. "3. z 8" or "3"
        const m = valStr.match(/^(\d+)/);
        if (m) listing.floor = parseInt(m[1], 10);
        const m2 = valStr.match(/z\s+(\d+)/);
        if (m2) listing.total_floors = parseInt(m2[1], 10);
      } else if (itemName === "Užitná plocha" || itemName === "Plocha") {
        const m = valStr.match(/(\d+(?:\.\d+)?)/);
        if (m) listing.size_m2 = parseFloat(m[1]);
      } else if (itemName === "Energetická náročnost budovy") {
        // SCR-03: Extract just the letter grade from full Czech sentences
        // e.g. "Třída G - Mimořádně nehospodárná..." -> "G"
        const letterMatch = valStr.match(/T[řr][íi]da\s+([A-Ga-g])/i);
        listing.energy_rating = letterMatch ? letterMatch[1].toUpperCase() : (valStr.match(/^([A-Ga-g])$/)?.[1]?.toUpperCase() ?? valStr);
      } else if (itemName === "Vybavení") {
        listing.furnishing = valStr;
      } else if (itemName === "Dispozice") {
        listing.layout = extractLayoutFromName(valStr) ?? valStr;
      } else if (itemName && valStr) {
        extraParams[itemName] = valStr;
      }
    }

    if (Object.keys(extraParams).length > 0) {
      listing.additional_params = JSON.stringify(extraParams);
    }

    // listed_at — use scraped_at if not set
    if (!listing.listed_at) {
      listing.listed_at = listing.scraped_at;
    }
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function mapPropertyType(catMain: number, catSub: number): PropertyType {
  if (catMain === 5) {
    return catSub === GARAGE_SUB_CB ? "garage" : "other";
  }
  return PROPERTY_TYPE_MAP[catMain] ?? "other";
}

function extractLayoutFromName(name: string): string | null {
  if (!name) return null;
  const m = name.match(/(\d+\+(?:kk|\d))/i);
  if (m) return m[1].toLowerCase();
  if (/atypick/i.test(name)) return "atypický";
  return null;
}

function extractCityAndDistrict(locality: string): { city: string | null; district: string | null } {
  if (!locality) return { city: null, district: null };
  const parts = locality.split(",").map((p) => p.trim());

  let district: string | null = null;
  let cityPart: string;

  const lastPart = parts[parts.length - 1];
  if (/^okres\s+/i.test(lastPart)) {
    // Last segment is "okres XYZ" — that's the district
    district = lastPart.replace(/^okres\s+/i, "").trim() || null;
    // City is the segment before it, or the first segment
    cityPart = parts.length > 1 ? parts[parts.length - 2].trim() : "";
  } else {
    cityPart = parts.length > 1 ? lastPart : parts[0].trim();
  }

  // Remove district/neighbourhood suffixes like " - Vinohrady"
  cityPart = cityPart.replace(/\s*-\s*\S.*$/, "").trim();
  // Remove trailing district number: "Praha 2" -> "Praha"
  cityPart = cityPart.replace(/\s+\d+$/, "").trim();

  return { city: cityPart || null, district };
}

function extractSizeFromName(name: string): number | null {
  if (!name) return null;
  const m = name.match(/(\d+)\s*m[²2]/i);
  if (m) return parseFloat(m[1]);
  return null;
}

// ---------------------------------------------------------------------------
// Type definitions for Sreality API responses
// ---------------------------------------------------------------------------

interface SrealityListResponse {
  result_size?: number;
  _embedded?: {
    estates?: SrealityEstate[];
  };
}

interface SrealityEstate {
  hash_id: number;
  name?: string;
  price?: number;
  price_czk?: { value_raw?: number };
  locality?: string;
  gps?: { lat?: number; lon?: number };
  seo?: {
    category_main_cb?: number;
    category_sub_cb?: number;
    category_type_cb?: number;
  };
  category_main_cb?: number;
  category_type_cb?: number;
  _links?: {
    images?: Array<{ href?: string }>;
  };
}

interface SrealityDetailResponse {
  text?: unknown;
  map?: { lat?: number; lon?: number };
  name?: unknown;
  locality?: unknown;
  _embedded?: {
    images?: Array<{ href?: string }>;
    seller?: {
      user_name?: string;
      phones?: Array<{ number?: string; code?: string } | string>;
      email?: string;
      company_name?: string;
      _embedded?: { premise?: { name?: string } };
    };
  };
  items?: Array<{ name?: string; value?: unknown }>;
}
