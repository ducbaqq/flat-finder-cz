/**
 * DB row -> ScraperResult stub.
 *
 * Used by the Phase 2 image-refresh sweep: it loads existing rows from
 * the DB, builds ScraperResult-shaped objects, then calls the scraper's
 * enrichListings which mutates them in place with fresh detail-page
 * values. upsertListing then lands them back on their original row via
 * external_id.
 *
 * Kept in its own module (no @flat-finder/db runtime imports) so unit
 * tests can exercise it without pulling in the drizzle client.
 */

import type { ListingRow } from "@flat-finder/db";
import type {
  PropertyType,
  ScraperResult,
  Source,
  TransactionType,
} from "@flat-finder/types";

export function rowToScraperResult(row: ListingRow): ScraperResult {
  const imageUrlsJson = Array.isArray(row.image_urls)
    ? JSON.stringify(row.image_urls)
    : "[]";
  const additionalParamsJson = row.additional_params
    ? JSON.stringify(row.additional_params)
    : null;

  return {
    external_id: row.external_id,
    source: row.source as Source,
    property_type: row.property_type as PropertyType,
    transaction_type: row.transaction_type as TransactionType,
    title: row.title,
    description: row.description,
    price: row.price,
    currency: row.currency ?? "CZK",
    price_note: row.price_note,
    address: row.address,
    city: row.city,
    district: row.district,
    region: row.region,
    latitude: row.latitude,
    longitude: row.longitude,
    size_m2: row.size_m2,
    layout: row.layout,
    floor: row.floor,
    total_floors: row.total_floors,
    condition: row.condition,
    construction: row.construction,
    ownership: row.ownership,
    furnishing: row.furnishing,
    energy_rating: row.energy_rating,
    amenities: row.amenities,
    image_urls: imageUrlsJson,
    thumbnail_url: row.thumbnail_url,
    source_url: row.source_url,
    listed_at: row.listed_at,
    // Refresh scraped_at so the row's "last seen" bookkeeping reflects
    // this pass — prevents the TTL sweep from flagging a freshly-re-enriched
    // row as stale just because nothing else updated scraped_at for days.
    scraped_at: new Date().toISOString(),
    enriched_at: row.enriched_at,
    is_active: row.is_active ?? true,
    deactivated_at: row.deactivated_at,
    deactivation_reason: row.deactivation_reason,
    seller_name: row.seller_name,
    seller_phone: row.seller_phone,
    seller_email: row.seller_email,
    seller_company: row.seller_company,
    additional_params: additionalParamsJson,
  };
}
