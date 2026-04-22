import pLimit from "p-limit";
import type { ScraperResult, PropertyType, TransactionType } from "@flat-finder/types";
import { BaseScraper, type ScraperOptions, type PageResult } from "../base-scraper.js";
import { normalizeAmenities } from "../amenity-normalizer.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://www.realingo.cz";
const GRAPHQL_URL = `${BASE_URL}/graphql`;
const IMAGE_BASE = "https://realingo.cz/static/images";
const ITEMS_PER_PAGE = 100;

/**
 * Realingo is a meta-aggregator: most of its listings point at other Czech
 * real-estate portals. When the externalUrl host matches a portal we already
 * scrape directly, the realingo row is a duplicate of what we already have
 * — with worse data coverage because realingo's own detail API doesn't
 * consistently populate size_m2 / ownership / etc. for aggregated listings.
 *
 * 2026-04-21 audit: ~40K of realingo's 63K active rows hit these hosts
 * (20K bazos, 20K ceskereality subdomains). Skipping them removes pure
 * duplicates; we keep the ~15K realingo-native rows + ~7K unique
 * moravskereality rows (which no other scraper covers).
 *
 * Match-by-substring so subdomains (reality.bazos.cz, stredo.ceskereality.cz,
 * severo.ceskereality.cz, etc.) all match the base host.
 */
const EXTERNALLY_COVERED_HOSTS = [
  "sreality.cz",
  "bezrealitky.cz",
  "ulovdomov.cz",
  "bazos.cz",
  "ereality.cz",
  "eurobydleni.cz",
  "ceskereality.cz",
  "realitymix.cz",
  "realitymix.com",
  "idnes.cz",
] as const;

function isExternallyCoveredUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return EXTERNALLY_COVERED_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

const SEARCH_CONFIGS: { purpose: string; transactionType: TransactionType }[] = [
  { purpose: "SELL", transactionType: "sale" },
  { purpose: "RENT", transactionType: "rent" },
];

// ---------------------------------------------------------------------------
// GraphQL queries
// ---------------------------------------------------------------------------

const SEARCH_OFFER_QUERY = `
query SearchOffer($filter: OfferFilterInput!, $sort: OfferSort, $first: Int, $skip: Int) {
  searchOffer(filter: $filter, sort: $sort, first: $first, skip: $skip) {
    items {
      id url purpose property reserved createdAt category
      price { total canonical currency note }
      area { main plot floor cellar balcony terrace loggia }
      photos { main list }
      location { address addressUrl locationPrecision latitude longitude }
    }
    total
  }
}`;

const OFFER_DETAIL_QUERY = `
query OfferDetail($id: ID!) {
  offer(id: $id) {
    offer {
      id url purpose property category createdAt reserved
      price { total canonical currency note }
      area { main plot floor cellar balcony terrace loggia }
      location { address latitude longitude locationPrecision }
      photos { main list }
    }
    detail {
      externalUrl description buildingType buildingStatus buildingPosition
      ownership furniture floor floorTotal yearBuild
      energyPerformance parking lift cellar balcony terrace
      isBarrierFree heating electricity gully basin
      contact { type person { name phone } company { name phone } }
    }
  }
}`;

// ---------------------------------------------------------------------------
// Types matching GraphQL response shape
// ---------------------------------------------------------------------------

interface ReaLingoListItem {
  id: string;
  url: string;
  purpose: string;
  property: string;
  reserved: boolean;
  createdAt: string;
  category: string;
  price: {
    total: number | null;
    canonical: number | null;
    currency: string;
    note: string | null;
  } | null;
  area: {
    main: number | null;
    plot: number | null;
    floor: number | null;
    cellar: number | null;
    balcony: number | null;
    terrace: number | null;
    loggia: number | null;
  } | null;
  photos: {
    main: string | null;
    list: string[] | null;
  } | null;
  location: {
    address: string | null;
    addressUrl: string | null;
    locationPrecision: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
}

interface GraphQLResponse {
  data: {
    searchOffer: {
      items: ReaLingoListItem[];
      total: number;
    };
  };
}

interface OfferDetailResponse {
  data: {
    offer: {
      offer: {
        id: string;
        url: string;
        purpose: string;
        property: string;
        category: string;
        createdAt: string;
        reserved: boolean;
        price: {
          total: number | null;
          canonical: number | null;
          currency: string;
          note: string | null;
        } | null;
        area: {
          main: number | null;
          plot: number | null;
          floor: number | null;
          cellar: number | null;
          balcony: number | null;
          terrace: number | null;
          loggia: number | null;
        } | null;
        location: {
          address: string | null;
          latitude: number | null;
          longitude: number | null;
          locationPrecision: string | null;
        } | null;
        photos: {
          main: string | null;
          list: string[] | null;
        } | null;
      };
      detail: {
        externalUrl: string | null;
        description: string | null;
        buildingType: string | null;
        buildingStatus: string | null;
        buildingPosition: string | null;
        ownership: string | null;
        furniture: string | null;
        floor: number | null;
        floorTotal: number | null;
        yearBuild: number | null;
        energyPerformance: string | null;
        parking: boolean | null;
        lift: boolean | null;
        cellar: boolean | null;
        balcony: boolean | null;
        terrace: boolean | null;
        isBarrierFree: boolean | null;
        heating: string | null;
        electricity: string | null;
        gully: string | null;
        basin: string | null;
        contact: {
          type: string | null;
          person: { name: string | null; phone: string | null } | null;
          company: { name: string | null; phone: string | null } | null;
        } | null;
      } | null;
    } | null;
  };
}

// ---------------------------------------------------------------------------
// Property type mapping
// ---------------------------------------------------------------------------

/**
 * Maps realingo category strings to our PropertyType.
 * Subcategories like OTHERS_COTTAGE -> "cottage", OTHERS_GARAGE -> "garage".
 */
function mapPropertyType(property: string, category: string): PropertyType {
  // First check subcategories for OTHERS
  if (property === "OTHERS") {
    const cat = category.toUpperCase();
    if (cat.includes("COTTAGE") || cat.includes("HUT")) return "cottage";
    if (cat.includes("GARAGE")) return "garage";
    if (cat.includes("FARMHOUSE")) return "house";
    if (cat.includes("FLAT")) return "flat";
    return "other";
  }

  switch (property) {
    case "FLAT":
      return "flat";
    case "HOUSE":
      return "house";
    case "LAND":
      return "land";
    case "COMMERCIAL":
      return "commercial";
    default:
      return "other";
  }
}

/**
 * Extract layout string from category.
 * FLAT21 -> "2+1", FLAT2_KK -> "2+kk", FLAT11 -> "1+1"
 */
function extractLayoutFromCategory(category: string): string | null {
  if (!category) return null;

  // Match FLAT patterns: FLAT21, FLAT2_KK, FLAT31, FLAT3_KK, FLAT11, FLAT1_KK, etc.
  const kkMatch = category.match(/FLAT(\d+)_KK/i);
  if (kkMatch) return `${kkMatch[1]}+kk`;

  const numMatch = category.match(/FLAT(\d)(\d)/i);
  if (numMatch) return `${numMatch[1]}+${numMatch[2]}`;

  return null;
}

/**
 * Try to extract city from the address string.
 * "Valdštejnská, Litvínov" -> "Litvínov"
 */
function extractCity(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  const nonPostal = parts.filter((p) => !/^\d{3}\s?\d{2}$/.test(p));
  if (nonPostal.length === 0) return null;
  return nonPostal[nonPostal.length - 1] || null;
}

/**
 * Build full image URL from the photo path.
 */
function buildImageUrl(photoPath: string | null): string | null {
  if (!photoPath) return null;
  return `${IMAGE_BASE}/${photoPath}.jpg`;
}

// ---------------------------------------------------------------------------
// Normalization helpers (Realingo returns English enums)
// ---------------------------------------------------------------------------

const CONSTRUCTION_MAP: Record<string, string> = {
  BRICK: "brick",
  PANEL: "panel",
  WOOD: "wood",
  STONE: "stone",
  MIXED: "mixed",
  OTHER: "other",
};

const CONDITION_MAP: Record<string, string> = {
  NEW: "new",
  VERY_GOOD: "very_good",
  GOOD: "good",
  BAD: "bad",
  UNDER_CONSTRUCTION: "under_construction",
  BEFORE_RECONSTRUCTION: "before_reconstruction",
  AFTER_RECONSTRUCTION: "after_reconstruction",
  DEMOLITION: "demolition",
  PROJECT: "project",
  OTHER: "other",
};

const OWNERSHIP_MAP: Record<string, string> = {
  PRIVATE: "personal",
  COOPERATIVE: "cooperative",
  STATE: "state",
  OTHER: "other",
};

const FURNISHING_MAP: Record<string, string> = {
  FURNISHED: "furnished",
  PARTIALLY: "partially",
  UNFURNISHED: "unfurnished",
};

function normalizeConstruction(val: string | null): string | null {
  if (!val) return null;
  return CONSTRUCTION_MAP[val] ?? val.toLowerCase();
}

function normalizeCondition(val: string | null): string | null {
  if (!val) return null;
  return CONDITION_MAP[val] ?? val.toLowerCase();
}

function normalizeOwnership(val: string | null): string | null {
  if (!val) return null;
  return OWNERSHIP_MAP[val] ?? val.toLowerCase();
}

function normalizeFurnishing(val: string | null): string | null {
  if (!val) return null;
  return FURNISHING_MAP[val] ?? val.toLowerCase();
}

function normalizeEnergyRating(val: string | null): string | null {
  if (!val) return null;
  // "G_EXTREMELY_INEFFICIENT" -> "G", "A_VERY_EFFICIENT" -> "A"
  const first = val.charAt(0).toUpperCase();
  if (first >= "A" && first <= "G") return first;
  return val.toLowerCase();
}

function collectAmenities(detail: NonNullable<OfferDetailResponse["data"]["offer"]>["detail"]): string | null {
  if (!detail) return null;
  const amenities: string[] = [];
  if (detail.parking) amenities.push("parking");
  if (detail.lift) amenities.push("lift");
  if (detail.cellar) amenities.push("cellar");
  if (detail.balcony) amenities.push("balcony");
  if (detail.terrace) amenities.push("terrace");
  if (detail.isBarrierFree) amenities.push("barrier_free");
  return amenities.length > 0 ? JSON.stringify(amenities) : null;
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

export class ReaLingoScraper extends BaseScraper {
  readonly name = "realingo";
  readonly baseUrl = "https://www.realingo.cz";

  override get hasDetailPhase() { return true; }

  constructor(opts: ScraperOptions) {
    super(opts);
  }

  // ─── Phase 1: List scan ────────────────────────────────────────────

  async *fetchPages(): AsyncGenerator<PageResult> {
    this.init();
    for (const config of SEARCH_CONFIGS) {
      this.log(`Scraping ${config.transactionType} listings (purpose=${config.purpose})`);
      try {
        yield* this.fetchPurposePages(config.purpose, config.transactionType);
      } catch (err) {
        this.log(`Error scraping ${config.transactionType}: ${err}`);
      }
    }
  }

  private async *fetchPurposePages(
    purpose: string,
    transactionType: TransactionType,
  ): AsyncGenerator<PageResult> {
    let totalItems = 0;

    for (let page = 0; ; page++) {
      if (this.isCategorySkipped(transactionType)) return;
      const skip = page * ITEMS_PER_PAGE;

      this.log(`  Page ${page + 1}: skip=${skip}, first=${ITEMS_PER_PAGE}`);

      let response: GraphQLResponse;
      try {
        response = await this.http.post<GraphQLResponse>(GRAPHQL_URL, {
          query: SEARCH_OFFER_QUERY,
          variables: {
            filter: { purpose },
            sort: "NEWEST",
            first: ITEMS_PER_PAGE,
            skip,
          },
        }, {
          Accept: "application/json",
        });
      } catch (err) {
        this.log(`  Failed to fetch page ${page + 1}: ${err}`);
        break;
      }

      const searchResult = response?.data?.searchOffer;
      if (!searchResult || !searchResult.items || searchResult.items.length === 0) {
        this.log(`  No items on page ${page + 1}, stopping`);
        break;
      }

      if (page === 0) {
        totalItems = searchResult.total;
        this.log(`  Total available: ${totalItems}`);
      }

      const items = searchResult.items;
      const listings: ScraperResult[] = [];

      for (const item of items) {
        try {
          const listing = this.parseListItem(item, transactionType);
          if (listing) listings.push(listing);
        } catch (err) {
          this.log(`  Failed to parse listing ${item.id}: ${err}`);
        }
      }

      const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
      this.log(`  Parsed ${listings.length}/${items.length} listings from page ${page + 1}/${totalPages}`);

      if (listings.length > 0) {
        yield {
          category: transactionType,
          page: page + 1,
          totalPages,
          listings,
        };
      }

      // Check if we've fetched all items
      if (skip + items.length >= totalItems) {
        this.log(`  Reached last page (${page + 1}/${totalPages})`);
        break;
      }
    }
  }

  // ─── Phase 2: Detail enrichment ────────────────────────────────────

  override async enrichListings(
    listings: ScraperResult[],
    opts?: { concurrency?: number; batchSize?: number },
  ): Promise<void> {
    if (listings.length === 0) return;

    this.init();
    this.log(`Enriching ${listings.length} new listings...`);
    const limit = opts?.concurrency ? pLimit(opts.concurrency) : this.limiter;

    // external_ids turned into tombstones because their externalUrl points at
    // a portal we already scrape directly (see EXTERNALLY_COVERED_HOSTS).
    const tombstoneIds = new Set<string>();

    await Promise.all(
      listings.map((listing) =>
        limit(async () => {
          try {
            const isTombstone = await this.enrichOne(listing);
            if (isTombstone) tombstoneIds.add(listing.external_id);
          } catch (err) {
            this.log(`Failed to enrich ${listing.external_id}: ${err}`);
          }
        }),
      ),
    );

    // Tombstones flow through upsertBatch as inactive rows so the next watch
    // cycle's findEnrichmentDoneIds gate excludes them — without this, every
    // cycle re-detail-fetches the same ~40K aggregator duplicates forever.
    if (tombstoneIds.size > 0) {
      this.log(
        `Tombstoning ${tombstoneIds.size}/${listings.length} aggregator-duplicate listings ` +
          `(redirect to bazos / ceskereality / etc.)`,
      );
    }

    const kept = listings.filter((l) => !tombstoneIds.has(l.external_id));
    if (kept.length === 0) return;

    const withDesc = kept.filter((l) => l.description !== null).length;
    const withExtUrl = kept.filter((l) => {
      try {
        const p = l.additional_params ? JSON.parse(l.additional_params) : null;
        return p?.realingo_url != null;
      } catch {
        return false;
      }
    }).length;
    const withGallery = kept.filter((l) => {
      try {
        return JSON.parse(l.image_urls).length > 1;
      } catch {
        return false;
      }
    }).length;
    this.log(
      `Enrichment: ${withDesc}/${kept.length} description, ${withExtUrl}/${kept.length} external URL, ${withGallery}/${kept.length} gallery`,
    );
  }

  /**
   * Returns `true` when this listing has been turned into a tombstone because
   * its detail externalUrl points at a portal we already scrape directly. The
   * listing is mutated in place (is_active=false, enriched_at=now) so the
   * caller's upsertBatch inserts it as a dead row. Next cycle's
   * findEnrichmentDoneIds gate then excludes it — we pay the detail-API cost
   * exactly once per aggregator duplicate, not every 5 minutes forever.
   *
   * Note: we still burn the one detail-API request per duplicate to learn
   * the externalUrl — realingo's list-phase GraphQL doesn't expose it.
   */
  private async enrichOne(listing: ScraperResult): Promise<boolean> {
    // Extract raw ID: "realingo_24523638" -> "24523638"
    const rawId = listing.external_id.replace(/^realingo_/, "");

    let response: OfferDetailResponse;
    try {
      response = await this.http.post<OfferDetailResponse>(GRAPHQL_URL, {
        query: OFFER_DETAIL_QUERY,
        variables: { id: rawId },
      }, {
        Accept: "application/json",
      });
    } catch (err) {
      this.log(`  Detail query failed for ${listing.external_id}: ${err}`);
      return false;
    }

    const data = response?.data?.offer;
    if (!data) return false;

    const { offer, detail } = data;

    // Duplicate guard: turn any listing whose externalUrl points at one of
    // our directly-scraped portals into a tombstone. We already have the
    // canonical row via the direct scrape; realingo's data for these tends
    // to be worse anyway. Writing an inactive row (vs dropping) is what
    // stops next cycle from re-discovering and re-detail-fetching it.
    if (isExternallyCoveredUrl(detail?.externalUrl)) {
      const now = new Date().toISOString();
      let additionalParams: Record<string, unknown> = {};
      try {
        additionalParams = listing.additional_params
          ? JSON.parse(listing.additional_params)
          : {};
      } catch {
        additionalParams = {};
      }
      additionalParams.realingo_url = listing.source_url;
      listing.source_url = detail!.externalUrl!;
      listing.additional_params = JSON.stringify(additionalParams);
      listing.is_active = false;
      listing.deactivated_at = now;
      listing.deactivation_reason = "realingo_external_duplicate";
      listing.enriched_at = now;
      return true;
    }

    // Parse existing additional_params
    let additionalParams: Record<string, unknown> = {};
    try {
      additionalParams = listing.additional_params ? JSON.parse(listing.additional_params) : {};
    } catch {
      additionalParams = {};
    }

    // Swap source_url: realingo URL -> additional_params, externalUrl -> source_url
    if (detail?.externalUrl) {
      additionalParams.realingo_url = listing.source_url;
      listing.source_url = detail.externalUrl;
    }

    // Description
    if (detail?.description) {
      listing.description = detail.description;
    }

    // Floor info
    if (detail?.floor != null) listing.floor = detail.floor;
    if (detail?.floorTotal != null) listing.total_floors = detail.floorTotal;

    // Property attributes
    listing.construction = normalizeConstruction(detail?.buildingType ?? null);
    listing.condition = normalizeCondition(detail?.buildingStatus ?? null);
    listing.ownership = normalizeOwnership(detail?.ownership ?? null);
    listing.furnishing = normalizeFurnishing(detail?.furniture ?? null);
    listing.energy_rating = normalizeEnergyRating(detail?.energyPerformance ?? null);

    // Price note
    if (offer?.price?.note) {
      listing.price_note = offer.price.note;
    }

    // Full image gallery
    if (offer?.photos?.list && offer.photos.list.length > 0) {
      const images = offer.photos.list
        .map((p) => buildImageUrl(p))
        .filter((url): url is string => url !== null);
      if (images.length > 0) {
        listing.image_urls = JSON.stringify(images);
        listing.thumbnail_url = listing.thumbnail_url ?? images[0];
      }
    }

    // Amenities
    listing.amenities = normalizeAmenities(collectAmenities(detail));

    // Contact info
    if (detail?.contact) {
      const { person, company } = detail.contact;
      if (person?.name) listing.seller_name = person.name;
      if (person?.phone) listing.seller_phone = person.phone;
      if (company?.name) listing.seller_company = company.name;
      // If no person phone but company has one, use it
      if (!listing.seller_phone && company?.phone) listing.seller_phone = company.phone;
    }

    // Extra metadata in additional_params
    if (detail?.yearBuild != null) additionalParams.year_build = detail.yearBuild;
    if (detail?.heating) additionalParams.heating = detail.heating;
    if (detail?.electricity) additionalParams.electricity = detail.electricity;
    if (detail?.gully) additionalParams.gully = detail.gully;
    if (detail?.buildingPosition) additionalParams.building_position = detail.buildingPosition;
    if (offer?.area) {
      if (offer.area.floor != null) additionalParams.floor_area = offer.area.floor;
      if (offer.area.cellar != null) additionalParams.cellar_area = offer.area.cellar;
      if (offer.area.balcony != null) additionalParams.balcony_area = offer.area.balcony;
      if (offer.area.terrace != null) additionalParams.terrace_area = offer.area.terrace;
      if (offer.area.loggia != null) additionalParams.loggia_area = offer.area.loggia;
    }

    listing.additional_params = JSON.stringify(additionalParams);
    return false;
  }

  // ─── Parsing helpers ───────────────────────────────────────────────

  private parseListItem(
    item: ReaLingoListItem,
    transactionType: TransactionType,
  ): ScraperResult | null {
    if (!item.id) return null;

    const now = new Date().toISOString();

    const propertyType = mapPropertyType(item.property, item.category);
    const layout = extractLayoutFromCategory(item.category);
    const address = item.location?.address ?? null;
    const city = extractCity(address);

    const price = item.price?.total ?? item.price?.canonical ?? null;
    const currency = item.price?.currency ?? "CZK";

    // Use full photo list if available, fall back to main photo
    const photoList = item.photos?.list;
    let imageUrls: string;
    let imageUrl: string | null;
    if (photoList && photoList.length > 0) {
      const urls = photoList.map(p => buildImageUrl(p)).filter((u): u is string => u !== null);
      imageUrls = JSON.stringify(urls);
      imageUrl = urls[0] ?? null;
    } else {
      const mainPhoto = item.photos?.main ?? null;
      imageUrl = buildImageUrl(mainPhoto);
      imageUrls = imageUrl ? JSON.stringify([imageUrl]) : "[]";
    }

    const sourceUrl = item.url ? `${BASE_URL}${item.url}` : null;

    // Build title from available data
    const sizeStr = item.area?.main ? `${item.area.main} m\u00B2` : "";
    const title = [layout, address, sizeStr].filter(Boolean).join(", ") || null;

    return {
      external_id: `realingo_${item.id}`,
      source: "realingo",
      property_type: propertyType,
      transaction_type: transactionType,
      title,
      description: null,
      price,
      currency,
      price_note: item.price?.note ?? null,
      address,
      city,
      district: null,
      region: null,
      latitude: item.location?.latitude ?? null,
      longitude: item.location?.longitude ?? null,
      size_m2: item.area?.main ?? null,
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
      thumbnail_url: imageUrl,
      source_url: sourceUrl,
      listed_at: item.createdAt ?? null,
      scraped_at: now,
      is_active: !item.reserved,
      deactivated_at: null,
      seller_name: null,
      seller_phone: null,
      seller_email: null,
      seller_company: null,
      additional_params: JSON.stringify({
        realingo_property: item.property,
        realingo_category: item.category,
        location_precision: item.location?.locationPrecision ?? null,
        plot_area: item.area?.plot ?? null,
        floor_area: item.area?.floor ?? null,
        cellar_area: item.area?.cellar ?? null,
        balcony_area: item.area?.balcony ?? null,
        terrace_area: item.area?.terrace ?? null,
        loggia_area: item.area?.loggia ?? null,
      }),
    };
  }
}
