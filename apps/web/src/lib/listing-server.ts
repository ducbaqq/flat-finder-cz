import "server-only";
import type {
  Listing,
  ClusterSibling,
  ClusterSiblingsResponse,
} from "@flat-finder/types";
import { propertyTypeLabels } from "@/lib/utils";

/**
 * Upstream Hono API base URL used for server-to-server fetches.
 *
 * Mirrors the rewrite rule in next.config.ts: the browser hits /api/* and
 * Next proxies to API_URL. On the server we can skip the rewrite hop and
 * talk to the API directly. Defaults to the local dev port (4000) used by
 * `pnpm --filter @flat-finder/api dev`.
 */
const API_BASE = process.env.API_URL || "http://localhost:4000";

/** Public URL used for canonical + OG tags. Defaults to the prod host. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://bytomat.com";

/**
 * Fetch a single listing on the server side. Returns null on 404 so the
 * page can call notFound(); throws on transport errors so they bubble up
 * to Next's error boundary.
 */
export async function fetchListing(id: number): Promise<Listing | null> {
  const res = await fetch(`${API_BASE}/api/listings/${id}`, {
    // Short revalidation window — listings change frequently enough that we
    // don't want to cache a stale "active" state for long, but we also don't
    // want to re-fetch on every request. 60s balances SEO crawl rate vs
    // responsiveness.
    next: { revalidate: 60 },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch listing ${id}: HTTP ${res.status}`);
  }
  return (await res.json()) as Listing;
}

/**
 * Fetch the cross-portal cluster siblings for a listing. Soft-fails to [] so
 * the detail page can render even when the cluster API is unavailable.
 */
export async function fetchClusterSiblings(
  id: number,
): Promise<ClusterSibling[]> {
  try {
    const res = await fetch(`${API_BASE}/api/listings/${id}/cluster-siblings`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as ClusterSiblingsResponse;
    return data.siblings ?? [];
  } catch {
    return [];
  }
}

/**
 * Compose a search-friendly Czech title. Target pattern:
 *   "Pronájem 2+kk 45 m², Praha 5 — 19 500 Kč/měs | Bytomat"
 * Gracefully degrades when individual fields are missing.
 */
export function buildListingTitle(listing: Listing): string {
  const transactionWord = TRANSACTION_NOMINATIVE[listing.transaction_type] ?? "";
  const propertyWord = propertyTypeLabels[listing.property_type] ?? "";
  const layout = listing.layout ?? "";
  const size = listing.size_m2 != null ? `${formatNumber(listing.size_m2)} m²` : "";
  const locality = listing.city || listing.district || listing.region || "";
  const price = listing.price != null
    ? `${formatNumber(listing.price)} ${listing.currency || "Kč"}${listing.transaction_type === "rent" ? "/měs" : ""}`
    : null;

  // Build "Pronájem bytu 2+kk 45 m²" — prefer layout over propertyWord when
  // both exist (layout is more specific for flats). For non-flats (house,
  // land, commercial), layout is null so propertyWord carries.
  const lead = [
    transactionWord,
    layout ? layout : (propertyWord ? propertyWord.toLowerCase() : ""),
    layout && propertyWord && listing.property_type !== "flat" ? propertyWord.toLowerCase() : "",
    size,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const parts: string[] = [];
  if (lead) parts.push(lead);
  if (locality) parts.push(locality);
  const head = parts.join(", ");

  if (price) return head ? `${head} — ${price}` : price;
  return head || (listing.title ?? `Nabídka ${listing.id}`);
}

const TRANSACTION_NOMINATIVE: Record<string, string> = {
  rent: "Pronájem",
  sale: "Prodej",
  auction: "Dražba",
};

function formatNumber(n: number): string {
  // cs-CZ uses space as thousands separator — matches native Czech formatting.
  return Math.round(n).toLocaleString("cs-CZ");
}

/**
 * First ~155 chars of the description, ending on a complete sentence when
 * possible. Falls back to the listing title if description is missing.
 */
export function buildListingDescription(listing: Listing): string {
  const raw = (listing.description || listing.title || "").trim();
  if (!raw) return "Prohlédněte si detail této nabídky na Bytomat.cz.";
  // Collapse any whitespace run (including newlines) to a single space so
  // meta descriptions don't render literal "\n".
  const flat = raw.replace(/\s+/g, " ");
  if (flat.length <= 155) return flat;
  const slice = flat.slice(0, 155);
  // Prefer the last sentence terminator; fall back to the last space.
  const lastPunct = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (lastPunct > 80) return slice.slice(0, lastPunct + 1);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > 80) return slice.slice(0, lastSpace) + "…";
  return slice + "…";
}

/**
 * Build schema.org JSON-LD for this listing. We emit RealEstateListing
 * (the umbrella type) wrapped around the concrete Apartment / House /
 * Place subtype so crawlers that only understand one or the other still
 * get useful structured data.
 */
export function buildListingJsonLd(listing: Listing): Record<string, unknown> {
  const url = `${SITE_URL}/listing/${listing.id}`;
  const images = (listing.image_urls || []).slice(0, 6).filter(Boolean);
  if (images.length === 0 && listing.thumbnail_url) {
    images.push(listing.thumbnail_url);
  }

  const address: Record<string, unknown> = {
    "@type": "PostalAddress",
    addressCountry: "CZ",
  };
  if (listing.address) address.streetAddress = listing.address;
  if (listing.city) address.addressLocality = listing.city;
  if (listing.region) address.addressRegion = listing.region;

  const subject: Record<string, unknown> = {
    "@type": SCHEMA_SUBJECT_TYPE[listing.property_type] ?? "Accommodation",
    name: listing.title ?? buildListingTitle(listing),
    address,
  };
  if (images.length > 0) subject.image = images;
  if (listing.size_m2 != null) {
    subject.floorSize = {
      "@type": "QuantitativeValue",
      value: listing.size_m2,
      unitCode: "MTK",
    };
  }
  if (listing.layout) {
    // Czech layouts like "2+kk" aren't schema.org-typed; emit the raw string
    // as numberOfRooms for search engines to read as-is.
    subject.numberOfRooms = listing.layout;
  }
  if (listing.latitude != null && listing.longitude != null) {
    subject.geo = {
      "@type": "GeoCoordinates",
      latitude: listing.latitude,
      longitude: listing.longitude,
    };
  }

  const offers: Record<string, unknown> = {
    "@type": "Offer",
    url,
    availability: listing.is_active
      ? "https://schema.org/InStock"
      : "https://schema.org/Discontinued",
    businessFunction:
      listing.transaction_type === "rent"
        ? "https://purl.org/goodrelations/v1#LeaseOut"
        : "https://purl.org/goodrelations/v1#Sell",
  };
  if (listing.price != null) {
    offers.price = listing.price;
    offers.priceCurrency = listing.currency || "CZK";
  }

  return {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    url,
    name: buildListingTitle(listing),
    description: buildListingDescription(listing),
    datePosted: listing.listed_at ?? listing.scraped_at,
    mainEntity: subject,
    offers,
  };
}

const SCHEMA_SUBJECT_TYPE: Record<string, string> = {
  flat: "Apartment",
  house: "House",
  cottage: "House",
  residential_building: "Residence",
  commercial: "LocalBusiness",
  land: "Place",
  garage: "Place",
};
