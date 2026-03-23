import type { ScraperResult, PropertyType, TransactionType } from "@flat-finder/types";
import { BaseScraper, type ScraperOptions, type PageResult } from "../base-scraper.js";
import { normalizeAmenities } from "../amenity-normalizer.js";

// ---------------------------------------------------------------------------
// Constants & lookup maps
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.bezrealitky.cz";
const GRAPHQL_URL = "https://api.bezrealitky.cz/graphql/";
const ITEMS_PER_PAGE = 100; // API max per request

/**
 * [offerType, estateType, transactionType, propertyType]
 */
const CATEGORIES: [string, string, TransactionType, PropertyType][] = [
  ["PRONAJEM", "BYT",              "rent",  "flat"],
  ["PRODEJ",   "BYT",              "sale",  "flat"],
  ["PRONAJEM", "DUM",              "rent",  "house"],
  ["PRODEJ",   "DUM",              "sale",  "house"],
  ["PRODEJ",   "POZEMEK",          "sale",  "land"],
  ["PRODEJ",   "GARAZ",            "sale",  "garage"],
  ["PRODEJ",   "KOMERCNI_PROSTOR", "sale",  "commercial"],
  ["PRONAJEM", "KOMERCNI_PROSTOR", "rent",  "commercial"],
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
// GraphQL query — fetches ALL fields in a single request (no detail phase)
// ---------------------------------------------------------------------------

const LIST_ADVERTS_QUERY = `
query ListAdverts(
  $offerType: [OfferType],
  $estateType: [EstateType],
  $order: ResultOrder,
  $limit: Int,
  $offset: Int,
  $currency: Currency
) {
  listAdverts(
    offerType: $offerType,
    estateType: $estateType,
    order: $order,
    limit: $limit,
    offset: $offset,
    currency: $currency
  ) {
    totalCount
    list {
      id
      uri
      offerType
      estateType
      disposition
      surface
      surfaceLand
      price
      charges
      currency
      gps { lat lng }
      address(locale: CS)
      mainImage { url(filter: RECORD_THUMB) }
      publicImages(limit: 20) { url(filter: RECORD_MAIN) }
      tags(locale: CS)
      descriptionByLocale(locale: CS)
      condition
      construction
      ownership
      equipped
      penb
      etage
      totalFloors
      balcony
      terrace
      loggia
      cellar
      lift
      parking
      garage
      barrierFree
      frontGarden
    }
  }
}`;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface GqlImage {
  url: string | null;
}

interface GqlAdvert {
  id: string;
  uri: string;
  offerType: string;
  estateType: string;
  disposition: string | null;
  surface: number | null;
  surfaceLand: number | null;
  price: number | null;
  charges: number | null;
  currency: string | null;
  gps: { lat: number; lng: number } | null;
  address: string | null;
  mainImage: GqlImage | null;
  publicImages: GqlImage[] | null;
  tags: string[] | null;
  descriptionByLocale: string | null;
  condition: string | null;
  construction: string | null;
  ownership: string | null;
  equipped: string | null;
  penb: string | null;
  etage: number | null;
  totalFloors: number | null;
  balcony: boolean | number | null;
  terrace: boolean | number | null;
  loggia: boolean | number | null;
  cellar: boolean | number | null;
  lift: boolean | null;
  parking: boolean | null;
  garage: boolean | null;
  barrierFree: boolean | null;
  frontGarden: number | null;
}

interface GqlListResponse {
  data?: {
    listAdverts?: {
      totalCount: number;
      list: GqlAdvert[];
    };
  };
  errors?: Array<{ message: string }>;
}

// ---------------------------------------------------------------------------
// Bezrealitky scraper — uses direct GraphQL API
// ---------------------------------------------------------------------------

export class BezrealitkyScraper extends BaseScraper {
  readonly name = "bezrealitky";
  readonly baseUrl = BASE_URL;

  // No detail phase needed — GraphQL returns all fields
  override get hasDetailPhase() { return false; }

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

    for (const [offerType, estateType, transactionType, propertyType] of CATEGORIES) {
      const catLabel = `${transactionType}/${propertyType}`;
      this.log(`Fetching: ${catLabel}`);

      // Fetch page 1 to discover totalCount
      let firstPage: GqlListResponse;
      try {
        firstPage = await this.fetchGraphQL(offerType, estateType, 0);
      } catch (err) {
        this.log(`Error fetching ${catLabel} page 1: ${err}`);
        continue;
      }

      const listData = firstPage.data?.listAdverts;
      if (!listData || listData.list.length === 0) {
        if (firstPage.errors) {
          this.log(`GraphQL errors for ${catLabel}: ${firstPage.errors.map(e => e.message).join(", ")}`);
        }
        continue;
      }

      const totalCount = listData.totalCount;
      const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE));
      this.log(`  ${catLabel}: ${totalCount} listings, ${totalPages} pages`);

      // Parse and yield page 1
      const page1Results = listData.list.map(a => this.parseAdvert(a));
      yield { category: catLabel, page: 1, totalPages, listings: page1Results };

      if (totalPages <= 1) continue;

      // Batch-concurrent fetching of remaining pages
      const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 1);

      for (let bStart = 0; bStart < remaining.length; bStart += batchSize) {
        if (this.isCategorySkipped(catLabel)) break;
        const batchOffsets = remaining.slice(bStart, bStart + batchSize);

        this.log(
          `  ${catLabel}: Fetching pages ${batchOffsets[0] + 1}-${batchOffsets[batchOffsets.length - 1] + 1} concurrently`,
        );

        const pagePromises = batchOffsets.map((pageIdx) =>
          this.limiter(() =>
            this.fetchGraphQL(offerType, estateType, pageIdx * ITEMS_PER_PAGE).catch((err) => {
              this.log(`Error fetching ${catLabel} offset ${pageIdx * ITEMS_PER_PAGE}: ${err}`);
              return null;
            }),
          ),
        );

        const pageResults = await Promise.all(pagePromises);

        for (let j = 0; j < pageResults.length; j++) {
          if (this.isCategorySkipped(catLabel)) break;
          const pgData = pageResults[j];
          if (!pgData?.data?.listAdverts?.list?.length) continue;
          const parsed = pgData.data.listAdverts.list.map(a => this.parseAdvert(a));
          yield { category: catLabel, page: batchOffsets[j] + 1, totalPages, listings: parsed };
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // GraphQL fetching
  // ------------------------------------------------------------------

  private async fetchGraphQL(
    offerType: string,
    estateType: string,
    offset: number,
  ): Promise<GqlListResponse> {
    return this.http.post<GqlListResponse>(GRAPHQL_URL, {
      query: LIST_ADVERTS_QUERY,
      variables: {
        offerType: [offerType],
        estateType: [estateType],
        order: "TIMEORDER_DESC",
        limit: ITEMS_PER_PAGE,
        offset,
        currency: "CZK",
      },
    }, {
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
    });
  }

  // ------------------------------------------------------------------
  // Parsing — direct from GraphQL response (no Apollo cache indirection)
  // ------------------------------------------------------------------

  private parseAdvert(advert: GqlAdvert): ScraperResult {
    const externalId = `bezrealitky_${advert.id}`;

    // Types
    const propertyType = ESTATE_TYPE_MAP[advert.estateType] ?? "other";
    const transactionType = OFFER_TYPE_MAP[advert.offerType] ?? "sale";

    // Layout
    const layout = advert.disposition ? (DISPOSITION_MAP[advert.disposition] ?? null) : null;

    // Size
    let sizeM2 = advert.surface != null ? Number(advert.surface) : null;
    if (!sizeM2 && advert.surfaceLand != null) {
      sizeM2 = Number(advert.surfaceLand);
    }

    // Price
    let price: number | null = advert.price != null ? Number(advert.price) : null;
    if (price != null && isNaN(price)) price = null;
    const charges = advert.charges || 0;
    const currency = advert.currency || "CZK";
    const priceNote = charges ? `+ ${charges} Kč poplatky` : null;

    // GPS
    const lat = advert.gps?.lat ?? null;
    const lng = advert.gps?.lng ?? null;

    // Address & city
    const addressRaw = advert.address ?? "";
    const city = extractCityFromAddress(addressRaw);

    // Images
    const imageUrls: string[] = [];
    if (advert.publicImages) {
      for (const img of advert.publicImages) {
        if (img.url) imageUrls.push(img.url);
      }
    }
    const thumbnailUrl = advert.mainImage?.url ?? imageUrls[0] ?? null;

    // Source URL
    let uri = advert.uri ?? "";
    let sourceUrl: string;
    if (uri && !uri.startsWith("http")) {
      if (!uri.startsWith("/")) uri = `/nemovitosti-byty-domy/${uri}`;
      sourceUrl = `${BASE_URL}${uri}`;
    } else if (uri) {
      sourceUrl = uri;
    } else {
      sourceUrl = `${BASE_URL}/nemovitosti-byty-domy/${advert.id}`;
    }

    // Title
    let title = "";
    if (layout && sizeM2) {
      const transCz: Record<string, string> = { rent: "Pronájem", sale: "Prodej", auction: "Aukce" };
      const typeCz: Record<string, string> = { flat: "bytu", house: "domu", land: "pozemku", garage: "garáže", commercial: "prostoru" };
      title = `${transCz[transactionType] ?? "Nabídka"} ${typeCz[propertyType] ?? ""} ${layout} ${Math.floor(sizeM2)} m²`.trim();
    }

    // Description
    const description = advert.descriptionByLocale ?? null;

    // Tags as amenities
    const tags = advert.tags ?? [];
    const amenitiesRaw = tags.length > 0 ? tags.filter(Boolean).join(",") : null;

    // Amenity boolean flags
    const amenityFlags: string[] = [];
    if (advert.balcony) amenityFlags.push("balcony");
    if (advert.terrace) amenityFlags.push("terrace");
    if (advert.loggia) amenityFlags.push("loggia");
    if (advert.cellar) amenityFlags.push("cellar");
    if (advert.lift) amenityFlags.push("lift");
    if (advert.parking) amenityFlags.push("parking");
    if (advert.garage) amenityFlags.push("garage");
    if (advert.barrierFree) amenityFlags.push("barrier_free");
    if (advert.frontGarden) amenityFlags.push("garden");

    const allAmenities = amenitiesRaw
      ? amenityFlags.length > 0
        ? `${amenitiesRaw},${amenityFlags.join(",")}`
        : amenitiesRaw
      : amenityFlags.length > 0
        ? amenityFlags.join(",")
        : null;
    const amenities = normalizeAmenities(allAmenities);

    // Condition, construction, etc. — normalize enums
    const condition = advert.condition ? normEnum(advert.condition, CONDITION_NORMALIZE) : null;
    const construction = advert.construction ? normEnum(advert.construction, CONSTRUCTION_NORMALIZE) : null;
    const ownership = advert.ownership ? normEnum(advert.ownership, OWNERSHIP_NORMALIZE) : null;
    const furnishing = advert.equipped ? normEnum(advert.equipped, FURNISHING_NORMALIZE) : null;

    // Energy rating
    let energyRating: string | null = null;
    if (advert.penb) {
      const letter = advert.penb.charAt(0).toUpperCase();
      energyRating = (letter >= "A" && letter <= "G") ? letter : advert.penb;
    }

    // Additional params
    const extraParams: Record<string, unknown> = {};
    if (charges) extraParams.charges = charges;
    if (advert.surface) extraParams.surface = advert.surface;
    if (advert.surfaceLand) extraParams.surfaceLand = advert.surfaceLand;
    if (advert.disposition) extraParams.disposition_raw = advert.disposition;
    for (const [key, val] of Object.entries({
      balcony: advert.balcony, cellar: advert.cellar, garage: advert.garage,
      loggia: advert.loggia, terrace: advert.terrace, parking: advert.parking,
    })) {
      if (val != null) extraParams[key] = val;
    }
    const additionalParams = Object.keys(extraParams).length > 0 ? JSON.stringify(extraParams) : null;

    const now = new Date().toISOString();

    return {
      external_id: externalId,
      source: "bezrealitky",
      property_type: propertyType,
      transaction_type: transactionType,
      title: title || null,
      description,
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
      floor: advert.etage ?? null,
      total_floors: advert.totalFloors ?? null,
      condition,
      construction,
      ownership,
      furnishing,
      energy_rating: energyRating,
      amenities,
      image_urls: JSON.stringify(imageUrls),
      thumbnail_url: thumbnailUrl,
      source_url: sourceUrl,
      listed_at: now,
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
}

// ---------------------------------------------------------------------------
// Enum normalization
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
  OSOBNI: "personal", DRUZSTEVNI: "cooperative", STATNI: "state",
};

const FURNISHING_NORMALIZE: Record<string, string> = {
  FURNISHED: "furnished", PARTIALLY: "partially", UNFURNISHED: "unfurnished",
  VYBAVENY: "furnished", CASTECNE: "partially", NEVYBAVENY: "unfurnished",
  ANO: "furnished", NE: "unfurnished",
};

function normEnum(val: string, map: Record<string, string>): string {
  return map[val] ?? val.toLowerCase();
}

function extractCityFromAddress(address: string): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].trim();
    if (part) {
      return part.replace(/\s+\d+\s*$/, "").trim() || part;
    }
  }
  return null;
}
