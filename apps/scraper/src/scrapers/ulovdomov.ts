import pLimit from "p-limit";
import type { ScraperResult, PropertyType, TransactionType } from "@flat-finder/types";
import { BaseScraper, type ScraperOptions, type PageResult } from "../base-scraper.js";

// ---------------------------------------------------------------------------
// Constants & lookup maps
// ---------------------------------------------------------------------------

const API_URL = "https://ud.api.ulovdomov.cz/v1/offer/find";
const PER_PAGE = 20;

/** Czech Republic bounding box */
const CZ_BOUNDS = {
  northEast: { lat: 51.06, lng: 18.87 },
  southWest: { lat: 48.55, lng: 12.09 },
};

/**
 * (offer_type, property_type) combinations to fetch.
 */
const COMBINATIONS: [TransactionType, PropertyType][] = [
  ["rent",  "flat"],
  ["sale",  "flat"],
  ["rent",  "house"],
  ["sale",  "house"],
  ["sale",  "land"],
];

const DISPOSITION_MAP: Record<string, string> = {
  onePlusKk:    "1+kk",
  onePlusOne:   "1+1",
  twoPlusKk:    "2+kk",
  twoPlusOne:   "2+1",
  threePlusKk:  "3+kk",
  threePlusOne: "3+1",
  fourPlusKk:   "4+kk",
  fourPlusOne:  "4+1",
  fivePlusKk:   "5+kk",
  fivePlusOne:  "5+1",
  sixPlusKk:    "6+kk",
  sixPlusOne:   "6+1",
  other:        "atypický",
  atypical:     "atypický",
};

const FURNISHING_MAP: Record<string, string> = {
  furnished:       "furnished",
  partlyFurnished: "partially",
  unfurnished:     "unfurnished",
};

const CONDITION_MAP: Record<string, string> = {
  new:  "new_build",
  good: "good",
  poor: "before_renovation",
};

const CONSTRUCTION_MAP: Record<string, string> = {
  brick: "brick",
  panel: "panel",
};

// ---------------------------------------------------------------------------
// UlovDomov scraper
// ---------------------------------------------------------------------------

export class UlovDomovScraper extends BaseScraper {
  readonly name = "ulovdomov";
  readonly baseUrl = API_URL;

  private readonly batchMultiplier: number;
  private readonly detailBatchSize: number;

  constructor(
    opts: ScraperOptions & { batchMultiplier?: number; detailBatchSize?: number },
  ) {
    super(opts);
    this.batchMultiplier = opts.batchMultiplier ?? 2;
    this.detailBatchSize = opts.detailBatchSize ?? 20;
  }

  // ------------------------------------------------------------------
  // Public entry point
  // ------------------------------------------------------------------

  async *fetchPages(): AsyncGenerator<PageResult> {
    this.init();
    const batchSize = this.batchMultiplier * this.concurrency;

    for (const [offerType, propertyType] of COMBINATIONS) {
      const comboLabel = `${offerType}/${propertyType}`;
      this.log(`Fetching: ${comboLabel}`);

      // Fetch page 1 to discover total_pages
      let firstData: UlovDomovListResponse;
      try {
        firstData = await this.fetchPage(offerType, propertyType, 1);
      } catch (err) {
        this.log(`Error fetching page 1 of ${comboLabel}: ${err}`);
        continue;
      }

      if (!firstData.success) {
        this.log(`API returned success=false for ${comboLabel} page 1`);
        continue;
      }

      const extra = firstData.extraData ?? {};
      const totalPages = extra.totalPages ?? 1;
      const totalCount = extra.total ?? 0;
      this.log(`  ${comboLabel}: ${totalCount} listings, ${totalPages} pages`);

      // Yield page 1 immediately
      const page1Results = this.parsePageOffers(firstData, offerType, propertyType);
      yield { category: comboLabel, page: 1, totalPages, listings: page1Results };

      if (totalPages <= 1) continue;

      // Batch-concurrent fetching of remaining pages
      const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

      for (let bStart = 0; bStart < remaining.length; bStart += batchSize) {
        const batchPages = remaining.slice(bStart, bStart + batchSize);
        this.log(
          `  ${comboLabel}: Fetching pages ${batchPages[0]}-${batchPages[batchPages.length - 1]} concurrently`,
        );

        const pagePromises = batchPages.map((p) =>
          this.limiter(() =>
            this.fetchPage(offerType, propertyType, p).catch((err) => {
              this.log(`Error fetching ${comboLabel} page ${p}: ${err}`);
              return null;
            }),
          ),
        );

        const pageResults = await Promise.all(pagePromises);

        for (const pgData of pageResults) {
          if (!pgData || !pgData.success) {
            if (pgData && !pgData.success) {
              this.log(`API returned success=false for ${comboLabel}`);
            }
            continue;
          }
          const parsed = this.parsePageOffers(pgData, offerType, propertyType);
          yield { category: comboLabel, page: batchPages[0], totalPages, listings: parsed };
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
        const offerId = listing.external_id.replace("ulovdomov_", "");
        return limit(async () => {
          const detail = await this.fetchDetail(Number(offerId));
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
    offerType: string,
    propertyType: string,
    page: number,
  ): Promise<UlovDomovListResponse> {
    const url = `${API_URL}?page=${page}&perPage=${PER_PAGE}&sorting=latest`;
    const body = {
      offerType,
      propertyType,
      bounds: CZ_BOUNDS,
    };
    return this.http.post<UlovDomovListResponse>(url, body, {
      Origin: "https://www.ulovdomov.cz",
      Referer: `https://www.ulovdomov.cz/${offerType === "rent" ? "pronajem" : "prodej"}/byty`,
    });
  }

  // ------------------------------------------------------------------
  // Detail fetching
  // ------------------------------------------------------------------

  private async fetchDetail(offerId: number): Promise<Record<string, unknown> | null> {
    const url = `https://ud.api.ulovdomov.cz/v1/offer/detail?offerId=${offerId}`;
    try {
      return await this.http.get<Record<string, unknown>>(url, {
        Origin: "https://www.ulovdomov.cz",
        Referer: `https://www.ulovdomov.cz/inzerat/x/${offerId}`,
      });
    } catch (err) {
      this.log(`Detail fetch failed for offer_id=${offerId}: ${err}`);
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Parsing
  // ------------------------------------------------------------------

  private parsePageOffers(
    data: UlovDomovListResponse,
    offerType: TransactionType,
    propertyType: PropertyType,
  ): ScraperResult[] {
    const offers = data.data?.offers ?? [];
    const results: ScraperResult[] = [];

    for (const offer of offers) {
      try {
        results.push(this.parseOffer(offer, offerType, propertyType));
      } catch (err) {
        this.log(`Parse error for offer id=${offer.id}: ${err}`);
      }
    }

    return results;
  }

  private parseOffer(
    offer: UlovDomovOffer,
    offerType: TransactionType,
    propertyType: PropertyType,
  ): ScraperResult {
    const offerId = offer.id;
    const externalId = `ulovdomov_${offerId}`;

    // Layout
    const dispositionRaw = offer.disposition ?? "other";
    const layout = DISPOSITION_MAP[dispositionRaw] ?? null;

    // Price
    let price: number | null = null;
    let currency = "CZK";
    if (offerType === "rent") {
      const rental = offer.rentalPrice ?? {};
      price = rental.value ?? null;
      currency = rental.currency ?? "CZK";
    } else {
      const selling = offer.sellingPrice ?? {};
      price = selling.value ?? null;
      currency = selling.currency ?? "CZK";
    }
    if (price != null) {
      try {
        price = Number(price);
        if (isNaN(price)) price = null;
      } catch {
        price = null;
      }
    }

    // Price note
    let priceNote = offer.priceNote ?? null;
    const monthlyFees = offer.monthlyFeesPrice;
    if (monthlyFees && !priceNote) {
      priceNote = `+ ${monthlyFees} Kč poplatky`;
    }

    // Address parts
    const street = offer.street?.title ?? "";
    const village = offer.village?.title ?? "";
    const villagePart = offer.villagePart?.title ?? "";

    const addressParts = [street, villagePart, village].filter(Boolean);
    const address = addressParts.length > 0 ? addressParts.join(", ") : null;
    const city = village || villagePart || null;

    // GPS
    const geo = offer.geoCoordinates ?? {};
    const lat = geo.lat ?? null;
    const lng = geo.lng ?? null;

    // Images
    const photos = offer.photos ?? [];
    const imageUrls = photos.filter((p) => p.path).map((p) => p.path!);
    const thumbnailUrl = imageUrls[0] ?? null;

    // Amenities
    const convenience = offer.convenience ?? [];
    const houseConv = offer.houseConvenience ?? [];
    const allAmenities = [...convenience, ...houseConv];
    const amenities = allAmenities.length > 0 ? allAmenities.join(",") : null;

    // Floor
    let floor: number | null = null;
    if (offer.floorLevel != null) {
      const parsed = parseInt(String(offer.floorLevel), 10);
      if (!isNaN(parsed)) floor = parsed;
    }

    // Listed at
    let listedAt: string;
    if (offer.published) {
      listedAt = offer.published.replace("T", " ").split("+")[0];
    } else {
      listedAt = new Date().toISOString();
    }

    // Furnished
    const furnishedRaw = offer.furnished;
    const furnishing = furnishedRaw ? (FURNISHING_MAP[furnishedRaw] ?? null) : null;

    // Condition
    const conditionRaw = offer.buildingCondition;
    const condition = conditionRaw ? (CONDITION_MAP[conditionRaw] ?? null) : null;

    // Construction
    const constructionRaw = offer.buildingType ?? offer.material;
    const construction = constructionRaw ? (CONSTRUCTION_MAP[constructionRaw] ?? null) : null;

    // Energy rating
    const energyRating = offer.energyEfficiencyRating ?? null;

    // Size
    let sizeM2: number | null = null;
    if (offer.area != null) {
      sizeM2 = Number(offer.area);
      if (isNaN(sizeM2)) sizeM2 = null;
    }

    const now = new Date().toISOString();

    return {
      external_id: externalId,
      source: "ulovdomov",
      property_type: propertyType,
      transaction_type: offerType,
      title: offer.title ?? null,
      description: offer.description ?? null,
      price,
      currency: currency || "CZK",
      price_note: priceNote,
      address,
      city,
      district: null,
      region: null,
      latitude: lat,
      longitude: lng,
      size_m2: sizeM2,
      layout,
      floor,
      total_floors: null,
      condition,
      construction,
      ownership: null,
      furnishing,
      energy_rating: energyRating,
      amenities,
      image_urls: JSON.stringify(imageUrls),
      thumbnail_url: thumbnailUrl,
      source_url: `https://www.ulovdomov.cz/inzerat/x/${offerId}`,
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

  private enrichFromDetail(
    listing: ScraperResult,
    detail: Record<string, unknown>,
  ): void {
    const data = (detail.data as Record<string, unknown>) ?? detail;

    // Seller info from owner
    const owner = (data.owner as Record<string, unknown>) ?? {};
    if (owner && typeof owner === "object") {
      const first = (owner.firstName as string) ?? "";
      const surname = (owner.surname as string) ?? "";
      const name = `${first} ${surname}`.trim();
      listing.seller_name = name || null;
      listing.seller_phone = (owner.phone as string) ?? null;
      listing.seller_email = null; // UlovDomov doesn't provide email
      listing.seller_company = (owner.type as string) ?? null;
    }

    // Description override from detail
    const desc = data.description as string | undefined;
    if (desc && !listing.description) {
      listing.description = desc;
    }

    // Additional params from parameters dict
    const extraParams: Record<string, string> = {};
    const parameters = (data.parameters as Record<string, unknown>) ?? {};
    for (const [key, param] of Object.entries(parameters)) {
      if (typeof param !== "object" || param === null) {
        extraParams[key] = String(param);
        continue;
      }

      const paramObj = param as Record<string, unknown>;
      const title = (paramObj.title as string) ?? key;

      // Value can be direct or inside options
      let value: string | null = paramObj.value != null ? String(paramObj.value) : null;

      if (value == null) {
        const options = paramObj.options;
        if (Array.isArray(options)) {
          const selected = options
            .filter(
              (o): o is Record<string, unknown> =>
                typeof o === "object" && o !== null && !!(o as Record<string, unknown>).isActive,
            )
            .map(
              (o) =>
                (o.title as string) ?? (o.value as string) ?? String(o),
            );

          if (selected.length === 0) {
            const allOpts = options
              .filter(
                (o): o is Record<string, unknown> =>
                  typeof o === "object" && o !== null,
              )
              .map(
                (o) =>
                  (o.title as string) ?? (o.value as string) ?? String(o),
              );
            value = allOpts.length > 0 ? allOpts.join(", ") : null;
          } else {
            value = selected.join(", ");
          }
        }
      }

      if (value != null) {
        extraParams[title] = value;
      }
    }

    if (Object.keys(extraParams).length > 0) {
      listing.additional_params = JSON.stringify(extraParams);
    }
  }
}

// ---------------------------------------------------------------------------
// Type definitions for UlovDomov API responses
// ---------------------------------------------------------------------------

interface UlovDomovListResponse {
  success?: boolean;
  data?: {
    offers?: UlovDomovOffer[];
  };
  extraData?: {
    totalPages?: number;
    total?: number;
  };
}

interface UlovDomovOffer {
  id: number;
  title?: string;
  description?: string;
  disposition?: string;
  area?: number;
  floorLevel?: number;
  published?: string;
  priceNote?: string;
  monthlyFeesPrice?: number;
  furnished?: string;
  buildingCondition?: string;
  buildingType?: string;
  material?: string;
  energyEfficiencyRating?: string;
  rentalPrice?: { value?: number; currency?: string };
  sellingPrice?: { value?: number; currency?: string };
  street?: { title?: string };
  village?: { title?: string };
  villagePart?: { title?: string };
  geoCoordinates?: { lat?: number; lng?: number };
  photos?: Array<{ path?: string }>;
  convenience?: string[];
  houseConvenience?: string[];
}
