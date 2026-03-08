import pLimit from "p-limit";
import type { ScraperResult, PropertyType, TransactionType } from "@flat-finder/types";
import { BaseScraper, type ScraperOptions, type PageResult } from "../base-scraper.js";
import { HttpError } from "../http-client.js";
import { normalizeAmenities } from "../amenity-normalizer.js";

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

  override get hasDetailPhase() { return true; }

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
        if (this.isCategorySkipped(slugLabel)) break;
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

        for (let j = 0; j < pageResults.length; j++) {
          if (this.isCategorySkipped(slugLabel)) break;
          const pgData = pageResults[j];
          if (pgData == null) continue;
          const parsed = this.processPageData(pgData);
          yield { category: slugLabel, page: batchPages[j], totalPages, listings: parsed };
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
  // Detail enrichment
  // ------------------------------------------------------------------

  override async enrichListings(
    listings: ScraperResult[],
    opts?: { concurrency?: number; batchSize?: number },
  ): Promise<void> {
    if (listings.length === 0) return;

    this.init();
    this.log(`Enriching ${listings.length} new listings...`);

    // Get fresh buildId for detail fetches
    if (!this.buildId) {
      this.buildId = await this.getBuildId();
    }
    if (!this.buildId) {
      this.log("Could not get buildId for detail enrichment -- skipping");
      return;
    }

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

    const withDesc = listings.filter((l) => l.description !== null).length;
    const withFloor = listings.filter((l) => l.floor !== null).length;
    const withAmenities = listings.filter((l) => l.amenities !== null).length;
    this.log(
      `Enrichment: ${withDesc}/${listings.length} description, ${withFloor}/${listings.length} floor, ${withAmenities}/${listings.length} amenities`,
    );
  }

  private async enrichOne(listing: ScraperResult): Promise<void> {
    if (!listing.source_url) return;

    // Extract slug from source_url: https://www.bezrealitky.cz/nemovitosti-byty-domy/12345
    // Detail endpoint: /_next/data/{buildId}/cs/detail/{slug}.json
    const urlPath = listing.source_url.replace(BASE_URL, "");
    // The slug is the last path segment
    const slug = urlPath.split("/").filter(Boolean).pop();
    if (!slug) return;

    if (!this.buildId) return;

    const detailUrl = `${BASE_URL}/_next/data/${this.buildId}/cs/detail/${slug}.json?id=${slug}`;

    let data: Record<string, unknown>;
    try {
      data = await this.http.get<Record<string, unknown>>(detailUrl, {
        Referer: listing.source_url,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        // buildId might be stale
        this.buildId = null;
      }
      return;
    }

    const pageProps = getPageProps(data);
    const apolloCache = getApolloCache(pageProps);
    if (!apolloCache) return;

    // Find the main Advert entry in the cache
    let advert: Record<string, unknown> | null = null;
    for (const [key, val] of Object.entries(apolloCache)) {
      if (key.startsWith("Advert:") && typeof val === "object" && val !== null) {
        advert = val as Record<string, unknown>;
        break;
      }
    }
    if (!advert) return;

    // Description
    if (!listing.description) {
      const desc = advert.description as string | undefined;
      if (desc) listing.description = desc;
    }

    // Floor info
    if (listing.floor === null) {
      const etage = advert.etage as number | undefined;
      if (etage != null) listing.floor = etage;
    }
    if (listing.total_floors === null) {
      const totalFloors = advert.totalFloors as number | undefined;
      if (totalFloors != null) listing.total_floors = totalFloors;
    }

    // Construction (buildingType: BRICK, PANEL, etc.)
    if (!listing.construction) {
      const bt = advert.buildingType as string | undefined;
      if (bt) listing.construction = normalizeBezrealitkyEnum(bt, CONSTRUCTION_NORMALIZE);
    }

    // Condition (buildingCondition)
    if (!listing.condition) {
      const bc = advert.buildingCondition as string | undefined;
      if (bc) listing.condition = normalizeBezrealitkyEnum(bc, CONDITION_NORMALIZE);
    }

    // Ownership
    if (!listing.ownership) {
      const own = advert.ownership as string | undefined;
      if (own) listing.ownership = normalizeBezrealitkyEnum(own, OWNERSHIP_NORMALIZE);
    }

    // Furnishing
    if (!listing.furnishing) {
      const furn = advert.furnished as string | undefined;
      if (furn) listing.furnishing = normalizeBezrealitkyEnum(furn, FURNISHING_NORMALIZE);
    }

    // Energy rating
    if (!listing.energy_rating) {
      const er = advert.energyEfficiencyRating as string | undefined;
      if (er) {
        const letter = er.charAt(0).toUpperCase();
        if (letter >= "A" && letter <= "G") listing.energy_rating = letter;
      }
    }

    // Amenities from boolean flags
    const amenityFlags: string[] = [];
    if (advert.balcony) amenityFlags.push("balcony");
    if (advert.terrace) amenityFlags.push("terrace");
    if (advert.loggia) amenityFlags.push("loggia");
    if (advert.cellar) amenityFlags.push("cellar");

    // Check for elevator/lift - may be in Apollo cache under different keys
    for (const k of Object.keys(advert)) {
      if (k === "elevator" || k === "lift") {
        if (advert[k]) amenityFlags.push("lift");
      }
    }

    if (advert.parking) amenityFlags.push("parking");
    if (advert.garage) amenityFlags.push("garage");

    // Check for barrierFree
    for (const k of Object.keys(advert)) {
      if (k.toLowerCase().includes("barrierfree") || k.toLowerCase().includes("barrier_free")) {
        if (advert[k]) amenityFlags.push("barrier_free");
      }
    }

    if (advert.garden) amenityFlags.push("garden");

    if (amenityFlags.length > 0) {
      // Merge with existing amenities from tags
      const existing = listing.amenities;
      const merged = normalizeAmenities(
        existing
          ? JSON.stringify([...JSON.parse(existing), ...amenityFlags])
          : JSON.stringify(amenityFlags),
      );
      listing.amenities = merged;
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
    let amenitiesRaw: string | null = null;
    if (Array.isArray(tagsRaw)) {
      amenitiesRaw = tagsRaw.filter(Boolean).map(String).join(",") || null;
    } else if (tagsRaw) {
      amenitiesRaw = String(tagsRaw);
    }
    const amenities = normalizeAmenities(amenitiesRaw);

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

// ---------------------------------------------------------------------------
// Bezrealitky enum normalization
// ---------------------------------------------------------------------------

const CONSTRUCTION_NORMALIZE: Record<string, string> = {
  BRICK: "brick", PANEL: "panel", WOOD: "wood", STONE: "stone",
  MIXED: "mixed", SKELETON: "skeleton", MONTOVANA: "prefab",
};

const CONDITION_NORMALIZE: Record<string, string> = {
  NEW: "new", VERY_GOOD: "very_good", GOOD: "good", BAD: "poor",
  UNDER_CONSTRUCTION: "under_construction", BEFORE_RECONSTRUCTION: "before_reconstruction",
  AFTER_RECONSTRUCTION: "after_reconstruction", DEMOLITION: "demolition", PROJECT: "project",
};

const OWNERSHIP_NORMALIZE: Record<string, string> = {
  PERSONAL: "personal", COOPERATIVE: "cooperative", STATE: "state",
};

const FURNISHING_NORMALIZE: Record<string, string> = {
  FURNISHED: "furnished", PARTIALLY: "partially", UNFURNISHED: "unfurnished",
};

function normalizeBezrealitkyEnum(val: string, map: Record<string, string>): string {
  return map[val] ?? val.toLowerCase();
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
