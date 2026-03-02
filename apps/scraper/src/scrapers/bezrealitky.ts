import type { ScraperResult, PropertyType, TransactionType } from "@flat-finder/types";
import { BaseScraper, type ScraperOptions, type PageResult } from "../base-scraper.js";
import { HttpError } from "../http-client.js";

// ---------------------------------------------------------------------------
// Constants & lookup maps
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.bezrealitky.cz";
const ITEMS_PER_PAGE = 15;

/**
 * [offer_slug, estate_slug, transaction_type, property_type]
 */
const SLUGS: [string, string, TransactionType, PropertyType][] = [
  ["nabidka-pronajem", "byt",                "rent",  "flat"],
  ["nabidka-prodej",   "byt",                "sale",  "flat"],
  ["nabidka-pronajem", "dum",                "rent",  "house"],
  ["nabidka-prodej",   "dum",                "sale",  "house"],
  ["nabidka-prodej",   "pozemek",            "sale",  "land"],
  ["nabidka-prodej",   "garaz",              "sale",  "garage"],
  ["nabidka-prodej",   "komercni-prostory",  "sale",  "commercial"],
  ["nabidka-pronajem", "komercni-prostory",  "rent",  "commercial"],
];

const DISPOSITION_MAP: Record<string, string> = {
  DISP_1_KK:       "1+kk",
  DISP_1_1:        "1+1",
  DISP_2_KK:       "2+kk",
  DISP_2_1:        "2+1",
  DISP_3_KK:       "3+kk",
  DISP_3_1:        "3+1",
  DISP_4_KK:       "4+kk",
  DISP_4_1:        "4+1",
  DISP_5_KK:       "5+kk",
  DISP_5_1:        "5+1",
  DISP_6_KK:       "6+kk",
  DISP_6_1:        "6+1",
  DISP_GARSONIERA: "garsoniera",
  DISP_ATYPICKY:   "atypický",
  DISP_POKOJ:      "pokoj",
};

const ESTATE_TYPE_MAP: Record<string, PropertyType> = {
  BYT:              "flat",
  DUM:              "house",
  POZEMEK:          "land",
  GARAZ:            "garage",
  KOMERCNI_PROSTOR: "commercial",
  ATELIER:          "commercial",
  KANCELAR:         "commercial",
};

const OFFER_TYPE_MAP: Record<string, TransactionType> = {
  PRONAJEM: "rent",
  PRODEJ:   "sale",
  AUKCE:    "auction",
};

// ---------------------------------------------------------------------------
// Bezrealitky scraper
// ---------------------------------------------------------------------------

export class BezrealitkyScraper extends BaseScraper {
  readonly name = "bezrealitky";
  readonly baseUrl = BASE_URL;

  private buildId: string | null = null;
  private readonly batchMultiplier: number;

  constructor(
    opts: ScraperOptions & { batchMultiplier?: number },
  ) {
    super(opts);
    this.batchMultiplier = opts.batchMultiplier ?? 2;
  }

  // ------------------------------------------------------------------
  // Public entry point
  // ------------------------------------------------------------------

  async *fetchPages(): AsyncGenerator<PageResult> {
    this.init();
    const batchSize = this.batchMultiplier * this.concurrency;

    // Get fresh buildId
    this.buildId = await this.getBuildId();
    if (!this.buildId) {
      this.log("Could not get Bezrealitky buildId -- skipping");
      return;
    }
    this.log(`buildId: ${this.buildId}`);

    for (const [offerSlug, estateSlug, transactionType, propertyType] of SLUGS) {
      const slugLabel = `${offerSlug}/${estateSlug}`;
      this.log(`Fetching: ${slugLabel}`);

      // Refresh buildId if invalidated
      if (!this.buildId) {
        this.buildId = await this.getBuildId();
        if (!this.buildId) {
          this.log(`Could not refresh buildId for ${slugLabel}`);
          continue;
        }
      }

      // Fetch page 1 to discover total_pages
      const firstData = await this.fetchNextData(this.buildId, offerSlug, estateSlug, 1);
      if (firstData == null) {
        if (!this.buildId) {
          this.buildId = await this.getBuildId();
        }
        continue;
      }

      const pageProps = getPageProps(firstData);
      const totalCount = this.getTotalCount(pageProps);
      let totalPages = 1;
      if (totalCount > 0) {
        totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
        this.log(`  ${slugLabel}: ${totalCount} listings, ${totalPages} pages`);
      }

      // Yield page 1 immediately
      const page1Results = this.processPageData(firstData);
      yield { category: slugLabel, page: 1, totalPages, listings: page1Results };

      if (totalPages <= 1) continue;

      // Batch-concurrent fetching of remaining pages
      const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

      for (let bStart = 0; bStart < remaining.length; bStart += batchSize) {
        const batchPages = remaining.slice(bStart, bStart + batchSize);

        // Ensure buildId is still valid before each batch
        if (!this.buildId) {
          this.buildId = await this.getBuildId();
          if (!this.buildId) {
            this.log(`Could not refresh buildId during ${slugLabel}`);
            break;
          }
        }

        this.log(
          `  ${slugLabel}: Fetching pages ${batchPages[0]}-${batchPages[batchPages.length - 1]} concurrently`,
        );

        const currentBuildId = this.buildId;
        const pagePromises = batchPages.map((p) =>
          this.limiter(() =>
            this.fetchNextData(currentBuildId, offerSlug, estateSlug, p).catch((err) => {
              this.log(`Error fetching ${slugLabel} page ${p}: ${err}`);
              return null;
            }),
          ),
        );

        const pageResults = await Promise.all(pagePromises);

        for (const pgData of pageResults) {
          if (pgData == null) continue;
          const parsed = this.processPageData(pgData);
          yield { category: slugLabel, page: batchPages[0], totalPages, listings: parsed };
        }

        // Check if buildId was invalidated during this batch
        if (!this.buildId) {
          this.log(`buildId invalidated during ${slugLabel} -- breaking to next category`);
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Build ID
  // ------------------------------------------------------------------

  private async getBuildId(): Promise<string | null> {
    try {
      const url = `${BASE_URL}/vypis/nabidka-pronajem/byt`;
      const raw: string = await this.http.get(url);
      const rawStr = typeof raw === "string" ? raw : String(raw);

      const m = rawStr.match(
        /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/s,
      );
      if (m) {
        const nextData = JSON.parse(m[1]);
        return nextData.buildId ?? null;
      }
    } catch (err) {
      this.log(`Failed to extract buildId: ${err}`);
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Page fetching
  // ------------------------------------------------------------------

  private async fetchNextData(
    buildId: string,
    offerSlug: string,
    estateSlug: string,
    page: number,
  ): Promise<Record<string, unknown> | null> {
    const url =
      `${BASE_URL}/_next/data/${buildId}/cs/vypis/` +
      `${offerSlug}/${estateSlug}.json` +
      `?slugs=${offerSlug}&slugs=${estateSlug}&page=${page}`;

    try {
      return await this.http.get<Record<string, unknown>>(url, {
        Referer: `${BASE_URL}/vypis/${offerSlug}/${estateSlug}`,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        this.log(`404 on buildId=${buildId} -- will refresh`);
        this.buildId = null;
      } else {
        this.log(`Error fetching ${offerSlug}/${estateSlug} page ${page}: ${err}`);
      }
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Parsing
  // ------------------------------------------------------------------

  private processPageData(data: Record<string, unknown>): ScraperResult[] {
    const pageProps = getPageProps(data);
    const apolloCache = getApolloCache(pageProps);
    if (!apolloCache) return [];

    return this.parseApolloCache(apolloCache);
  }

  private parseApolloCache(apolloCache: Record<string, unknown>): ScraperResult[] {
    const results: ScraperResult[] = [];
    for (const [key, val] of Object.entries(apolloCache)) {
      if (!key.startsWith("Advert:")) continue;
      if (typeof val !== "object" || val === null) continue;
      try {
        const listing = this.parseAdvert(
          key,
          val as Record<string, unknown>,
          apolloCache,
        );
        results.push(listing);
      } catch (err) {
        this.log(`Error parsing advert ${key}: ${err}`);
      }
    }
    return results;
  }

  private parseAdvert(
    cacheKey: string,
    advert: Record<string, unknown>,
    cache: Record<string, unknown>,
  ): ScraperResult {
    const advertId =
      (advert.id as string | number | undefined) ??
      cacheKey.replace("Advert:", "");
    const externalId = `bezrealitky_${advertId}`;

    // Types
    const estateTypeRaw = (advert.estateType as string) ?? "BYT";
    const offerTypeRaw = (advert.offerType as string) ?? "PRONAJEM";
    const propertyType = ESTATE_TYPE_MAP[estateTypeRaw] ?? "other";
    const transactionType = OFFER_TYPE_MAP[offerTypeRaw] ?? "sale";

    // Layout / disposition
    const dispositionRaw = (advert.disposition as string) ?? "";
    const layout = DISPOSITION_MAP[dispositionRaw] ?? null;

    // Size
    const surface = advert.surface as number | null | undefined;
    let sizeM2 = surface != null ? Number(surface) : null;
    if (!sizeM2) {
      const surfaceLand = advert.surfaceLand as number | null | undefined;
      sizeM2 = surfaceLand != null ? Number(surfaceLand) : null;
    }

    // Price
    let price: number | null = advert.price as number | null ?? null;
    if (price != null) {
      try {
        price = Number(price);
        if (isNaN(price)) price = null;
      } catch {
        price = null;
      }
    }
    const charges = (advert.charges as number) || 0;
    const currency = (advert.currency as string) || "CZK";

    // Price note
    const priceNote = charges ? `+ ${charges} Kč poplatky` : null;

    // GPS
    let gpsRaw = advert.gps as Record<string, unknown> | null;
    if (gpsRaw && typeof gpsRaw === "object" && "__ref" in gpsRaw) {
      gpsRaw = resolveRef(gpsRaw, cache);
    }
    const lat = gpsRaw && typeof gpsRaw === "object" ? (gpsRaw.lat as number | null ?? null) : null;
    const lng = gpsRaw && typeof gpsRaw === "object" ? (gpsRaw.lng as number | null ?? null) : null;

    // Address -- key may have locale suffix like address({"locale":"CS"})
    let addressRaw = "";
    for (const k of Object.keys(advert)) {
      if (k.startsWith("address") && !k.startsWith("addressFormatted")) {
        const val = advert[k];
        if (val && typeof val === "string") {
          addressRaw = val;
          break;
        }
      }
    }
    const city = extractCityFromAddress(addressRaw);

    // Images
    const imageUrls: string[] = [];
    let thumbnailUrl: string | null = null;

    const mainImgRef = advert.mainImage as Record<string, unknown> | null;
    if (mainImgRef && typeof mainImgRef === "object" && "__ref" in mainImgRef) {
      const mainImg = resolveRef(mainImgRef, cache);
      if (mainImg) {
        thumbnailUrl = extractImageUrl(mainImg, "RECORD_THUMB");
      }
    }

    // publicImages key may contain GraphQL params like ({"limit":3})
    let pubImages: unknown = null;
    for (const k of Object.keys(advert)) {
      if (k.startsWith("publicImages")) {
        pubImages = advert[k];
        break;
      }
    }
    if (!pubImages) {
      pubImages = advert.images;
    }
    if (Array.isArray(pubImages)) {
      for (const imgRef of pubImages) {
        const img = resolveRef(imgRef as Record<string, unknown>, cache);
        if (img && typeof img === "object") {
          const fullUrl = extractImageUrl(img, "RECORD_MAIN");
          if (fullUrl) imageUrls.push(fullUrl);
        }
      }
    }

    if (!thumbnailUrl && imageUrls.length > 0) {
      thumbnailUrl = imageUrls[0];
    }

    // URI / source_url -- key may have locale suffix
    let uri = "";
    for (const k of Object.keys(advert)) {
      if (k.startsWith("uri")) {
        const val = advert[k];
        if (val && typeof val === "string") {
          uri = val;
          break;
        }
      }
    }
    let sourceUrl: string;
    if (uri && !uri.startsWith("http")) {
      if (!uri.startsWith("/")) uri = "/" + uri;
      sourceUrl = `${BASE_URL}${uri}`;
    } else if (uri) {
      sourceUrl = uri;
    } else {
      sourceUrl = `${BASE_URL}/nemovitosti-byty-domy/${advertId}`;
    }

    // Title
    let title = (advert.seoName as string) || (advert.name as string) || "";
    if (!title) {
      for (const k of Object.keys(advert)) {
        if (k.startsWith("imageAltText")) {
          title = (advert[k] as string) || "";
          break;
        }
      }
    }
    if (!title && layout && sizeM2) {
      const transCz: Record<string, string> = {
        rent: "Pronájem",
        sale: "Prodej",
        auction: "Aukce",
      };
      const typeCz: Record<string, string> = {
        flat: "bytu",
        house: "domu",
        land: "pozemku",
        garage: "garáže",
        commercial: "prostoru",
      };
      title =
        `${transCz[transactionType] ?? "Nabídka"} ${typeCz[propertyType] ?? ""} ${layout} ${Math.floor(sizeM2)} m²`.trim();
    }

    // Tags as amenities
    let tagsRaw: unknown = null;
    for (const k of Object.keys(advert)) {
      if (k.startsWith("tags")) {
        tagsRaw = advert[k];
        break;
      }
    }
    if (tagsRaw == null) tagsRaw = [];
    let amenities: string | null = null;
    if (Array.isArray(tagsRaw)) {
      amenities = tagsRaw.filter(Boolean).map(String).join(",") || null;
    } else if (tagsRaw) {
      amenities = String(tagsRaw);
    }

    // Additional params
    const extraParams: Record<string, unknown> = {};
    if (charges) extraParams.charges = charges;
    if (surface) extraParams.surface = surface;
    const surfaceLand = advert.surfaceLand;
    if (surfaceLand) extraParams.surfaceLand = surfaceLand;
    if (dispositionRaw) extraParams.disposition_raw = dispositionRaw;
    for (const extraKey of [
      "balcony", "cellar", "garage", "loggia", "terrace",
      "parking", "elevator", "garden",
    ]) {
      const val = advert[extraKey];
      if (val != null) extraParams[extraKey] = val;
    }
    const additionalParams =
      Object.keys(extraParams).length > 0 ? JSON.stringify(extraParams) : null;

    const now = new Date().toISOString();

    return {
      external_id: externalId,
      source: "bezrealitky",
      property_type: propertyType,
      transaction_type: transactionType,
      title: title || null,
      description: (advert.description as string) ?? null,
      price,
      currency: currency || "CZK",
      price_note: priceNote,
      address: addressRaw || null,
      city,
      district: null,
      region: null,
      latitude: lat,
      longitude: lng,
      size_m2: sizeM2,
      layout,
      floor: (advert.floor as number) ?? null,
      total_floors: (advert.totalFloors as number) ?? null,
      condition: (advert.buildingCondition as string) ?? null,
      construction: (advert.buildingType as string) ?? null,
      ownership: (advert.ownership as string) ?? null,
      furnishing: (advert.furnished as string) ?? null,
      energy_rating: (advert.energyEfficiencyRating as string) ?? null,
      amenities,
      image_urls: JSON.stringify(imageUrls),
      thumbnail_url: thumbnailUrl,
      source_url: sourceUrl,
      listed_at:
        (advert.createdAt as string) ??
        (advert.firstPublishedAt as string) ??
        now,
      scraped_at: now,
      is_active: true,
      deactivated_at: null,
      seller_name: null,
      seller_phone: null,
      seller_email: null,
      seller_company: null,
      additional_params: additionalParams,
    };
  }

  private getTotalCount(pageProps: Record<string, unknown>): number {
    const apollo =
      (pageProps.apolloCache as Record<string, unknown>) ??
      (pageProps.apolloState as Record<string, unknown>) ??
      {};
    for (const [key, val] of Object.entries(apollo)) {
      if (key === "ROOT_QUERY" && typeof val === "object" && val !== null) {
        for (const [qkey, qval] of Object.entries(val as Record<string, unknown>)) {
          if (
            qkey.includes("listAdverts") &&
            typeof qval === "object" &&
            qval !== null
          ) {
            return (qval as Record<string, unknown>).totalCount as number ?? 0;
          }
        }
      }
    }
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function getPageProps(data: Record<string, unknown>): Record<string, unknown> {
  const pp = data.pageProps as Record<string, unknown> | undefined;
  if (pp) return pp;
  const props = data.props as Record<string, unknown> | undefined;
  if (props) return (props.pageProps as Record<string, unknown>) ?? {};
  return {};
}

function getApolloCache(
  pageProps: Record<string, unknown>,
): Record<string, unknown> | null {
  const cache =
    (pageProps.apolloCache as Record<string, unknown>) ??
    (pageProps.apolloState as Record<string, unknown>) ??
    null;
  return cache;
}

function resolveRef(
  refObj: Record<string, unknown> | string,
  cache: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof refObj === "object" && refObj !== null && "__ref" in refObj) {
    const ref = refObj.__ref as string;
    return (cache[ref] as Record<string, unknown>) ?? {};
  }
  return typeof refObj === "object" && refObj !== null
    ? refObj
    : {};
}

function extractImageUrl(
  imgObj: Record<string, unknown>,
  prefer: string,
): string | null {
  if (!imgObj) return null;

  // Try preferred filter first
  for (const key of Object.keys(imgObj)) {
    if (key.startsWith("url") && key.includes(prefer)) {
      const url = imgObj[key];
      if (url && typeof url === "string") {
        return normalizeUrl(url);
      }
    }
  }

  // Fall back to any url key
  for (const key of Object.keys(imgObj)) {
    if (key.startsWith("url") && typeof imgObj[key] === "string" && imgObj[key]) {
      return normalizeUrl(imgObj[key] as string);
    }
  }

  // Direct url field
  const url = imgObj.url;
  if (url && typeof url === "string") {
    return normalizeUrl(url);
  }

  return null;
}

function normalizeUrl(url: string): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return "https://api.bezrealitky.cz" + url;
  return url;
}

function extractCityFromAddress(address: string): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim());

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].trim();
    if (part) {
      // Remove district number (Praha 2 -> Praha)
      const city = part.replace(/\s+\d+\s*$/, "").trim();
      return city || part;
    }
  }
  return null;
}
