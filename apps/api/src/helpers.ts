import type { ListingRow } from "@flat-finder/db";
import type { Listing } from "@flat-finder/types";

/**
 * Convert a DB row from Drizzle into the API response format.
 *
 * - image_urls: already jsonb array from Drizzle, ensure it's an array
 * - amenities: split comma-separated string into array, or empty array if null
 * - additional_params: already jsonb from Drizzle
 * - is_active: already boolean from Drizzle
 */
export function rowToListing(row: ListingRow): Listing {
  return {
    id: row.id,
    external_id: row.external_id,
    source: row.source as Listing["source"],
    property_type: row.property_type as Listing["property_type"],
    transaction_type: row.transaction_type as Listing["transaction_type"],
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
    amenities: row.amenities
      ? row.amenities.split(",").map((a) => a.trim()).filter(Boolean)
      : [],
    image_urls: Array.isArray(row.image_urls) ? row.image_urls : [],
    thumbnail_url: row.thumbnail_url,
    source_url: row.source_url,
    listed_at: row.listed_at,
    scraped_at: row.scraped_at ?? new Date().toISOString(),
    created_at: row.created_at ?? new Date().toISOString(),
    is_active: row.is_active ?? true,
    deactivated_at: row.deactivated_at,
    seller_name: row.seller_name,
    seller_phone: row.seller_phone,
    seller_email: row.seller_email,
    seller_company: row.seller_company,
    additional_params: row.additional_params ?? null,
    cluster_id: row.cluster_id ?? null,
    is_canonical: row.is_canonical ?? true,
  };
}

/**
 * Parse a query string value to a number, returning undefined if invalid.
 */
export function parseNumericParam(
  val: string | undefined,
): number | undefined {
  if (val == null || val === "") return undefined;
  const n = Number(val);
  return isNaN(n) ? undefined : n;
}
