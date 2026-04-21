/**
 * Shared upsert helpers used by both runCycle (in index.ts) and the
 * image-refresh sweep (in refresh.ts).
 *
 * Kept in its own module so refresh.ts doesn't have to import from
 * index.ts, which is the CLI entrypoint and pulls in the dashboard,
 * arg parser, etc.
 */

import type { NewListing, Db } from "@flat-finder/db";
import { upsertListing } from "@flat-finder/db";
import type { ScraperResult } from "@flat-finder/types";
import { normalizeListingFields } from "./normalizer.js";

// Keep in sync with runCycle's SCR-04 list. If this ever diverges, the
// user-facing filters will drift from the scraper's ingest-side filter.
const CITY_BLACKLIST = new Set([
  "spanelsko", "spain", "espana",
  "nemecko", "germany", "deutschland",
  "rakousko", "austria",
  "polsko", "poland",
  "slovensko", "slovakia",
  "francie", "france",
  "italie", "italy",
]);

export function toNewListing(result: ScraperResult): NewListing {
  normalizeListingFields(result);

  // image_urls comes as a JSON string from the scraper; DB expects string[]
  let imageUrls: string[] = [];
  try {
    const parsed = JSON.parse(result.image_urls);
    if (Array.isArray(parsed)) imageUrls = parsed;
  } catch {
    imageUrls = [];
  }

  // additional_params comes as a JSON string; DB expects Record | null
  let additionalParams: Record<string, unknown> | null = null;
  if (result.additional_params) {
    try {
      additionalParams = JSON.parse(result.additional_params);
    } catch {
      additionalParams = null;
    }
  }

  let price = result.price;
  if (price !== null && price < 0) price = null;

  // Czech Republic bounds — if outside, null both coordinates.
  let latitude = result.latitude;
  let longitude = result.longitude;
  if (latitude !== null && longitude !== null) {
    if (latitude < 48.5 || latitude > 51.1 || longitude < 12.0 || longitude > 18.9) {
      latitude = null;
      longitude = null;
    }
  } else if (latitude !== null || longitude !== null) {
    latitude = null;
    longitude = null;
  }

  let city = result.city;
  if (city && CITY_BLACKLIST.has(city.toLowerCase().trim())) {
    city = null;
  }

  return {
    external_id: result.external_id,
    source: result.source,
    property_type: result.property_type,
    transaction_type: result.transaction_type,
    title: result.title,
    description: result.description,
    price,
    currency: result.currency,
    price_note: result.price_note,
    address: result.address,
    city,
    district: result.district,
    region: result.region,
    latitude,
    longitude,
    size_m2: result.size_m2,
    layout: result.layout,
    floor: result.floor,
    total_floors: result.total_floors,
    condition: result.condition,
    construction: result.construction,
    ownership: result.ownership,
    furnishing: result.furnishing,
    energy_rating: result.energy_rating,
    amenities: result.amenities,
    image_urls: imageUrls,
    thumbnail_url: result.thumbnail_url,
    source_url: result.source_url,
    listed_at: result.listed_at,
    scraped_at: result.scraped_at,
    enriched_at: result.enriched_at ?? null,
    is_active: result.is_active,
    deactivated_at: result.deactivated_at,
    deactivation_reason: result.deactivation_reason ?? null,
    seller_name: result.seller_name,
    seller_phone: result.seller_phone,
    seller_email: result.seller_email,
    seller_company: result.seller_company,
    additional_params: additionalParams,
  };
}

/**
 * Heuristic: "enrichment succeeded" = at least one detail-only field
 * is populated. Listings whose detail page is genuinely empty (no
 * description, no seller, one image) will fail this check forever;
 * the ENRICHMENT_GIVE_UP_DAYS cap in listings.ts handles that case.
 */
export function wasEnriched(l: ScraperResult): boolean {
  if (l.description) return true;
  if (l.seller_name || l.seller_phone || l.seller_email) return true;
  if (l.floor !== null) return true;
  if (l.energy_rating) return true;
  if (l.condition || l.construction || l.furnishing || l.ownership) return true;
  if (
    l.additional_params &&
    l.additional_params !== "{}" &&
    l.additional_params !== "null"
  ) {
    return true;
  }
  try {
    const parsed = JSON.parse(l.image_urls);
    if (Array.isArray(parsed) && parsed.length > 1) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Stamp enriched_at = now on rows whose per-detail enrich actually populated something. */
export function stampEnrichedAt(batch: ScraperResult[]): void {
  const now = new Date().toISOString();
  for (const l of batch) {
    if (wasEnriched(l)) l.enriched_at = now;
  }
}

export async function upsertBatch(
  db: Db,
  rows: ScraperResult[],
  log: (msg: string) => void,
): Promise<{ newCount: number; updatedCount: number; errorCount: number }> {
  let newCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const result of rows) {
    try {
      const newListing = toNewListing(result);
      const { isNew } = await upsertListing(db, newListing);
      if (isNew) newCount++;
      else updatedCount++;
    } catch (err) {
      errorCount++;
      if (errorCount <= 5) {
        log(`Error upserting ${result.external_id}: ${err}`);
      } else if (errorCount === 6) {
        log("(suppressing further upsert error logs)");
      }
    }
  }

  return { newCount, updatedCount, errorCount };
}
