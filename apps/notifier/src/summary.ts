import type { ListingFilters } from "@flat-finder/types";

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  flat: "Byty",
  house: "Domy",
  land: "Pozemky",
  commercial: "Komerční",
  garage: "Garáže",
  cottage: "Chaty",
  residential_building: "Činžovní domy",
  other: "Ostatní",
};

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  rent: "Pronájem",
  sale: "Prodej",
  auction: "Aukce",
  flatshare: "Spolubydlení",
};

function multi(value: string | undefined, lookup: Record<string, string>): string | null {
  if (!value) return null;
  const labels = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => lookup[v] ?? v);
  if (labels.length === 0) return null;
  return labels.join(" + ");
}

/** Czech-style integer formatting with non-breaking-space thousands. */
function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
}

function buildSizeSegment(filters: ListingFilters): string | null {
  const { size_min, size_max } = filters;
  if (size_min != null && size_max != null) {
    return `${formatInt(size_min)}–${formatInt(size_max)} m²`;
  }
  if (size_min != null) {
    return `${formatInt(size_min)} m²+`;
  }
  if (size_max != null) {
    return `do ${formatInt(size_max)} m²`;
  }
  return null;
}

function buildPriceSegment(filters: ListingFilters): string | null {
  const { price_min, price_max, transaction_type } = filters;
  const suffix = transaction_type === "rent" ? " Kč/měsíc" : " Kč";
  if (price_min != null && price_max != null) {
    return `${formatInt(price_min)}–${formatInt(price_max)}${suffix}`;
  }
  if (price_min != null) {
    return `od ${formatInt(price_min)}${suffix}`;
  }
  if (price_max != null) {
    return `do ${formatInt(price_max)}${suffix}`;
  }
  return null;
}

function buildLocationSegment(
  filters: ListingFilters,
  locationLabel: string | null,
): string | null {
  if (filters.city) return filters.city;
  if (filters.location) return filters.location;
  if (filters.region) return filters.region;
  const hasBbox =
    filters.sw_lat != null &&
    filters.sw_lng != null &&
    filters.ne_lat != null &&
    filters.ne_lng != null;
  if (hasBbox) {
    return locationLabel ?? "vybraná oblast";
  }
  return null;
}

/**
 * Compose a one-line filter summary for the email's hero / preheader.
 *
 * Output joins non-empty segments with " · " (middle dot, matches the
 * existing email tone). When there are zero meaningful filters it
 * returns "Všechny nabídky" so the hero never renders empty.
 *
 * Order: property type · transaction · location · size · price.
 */
export function composeFilterSummary(
  filters: ListingFilters,
  locationLabel: string | null,
): string {
  const segments: string[] = [];

  const propertyType = multi(filters.property_type, PROPERTY_TYPE_LABELS);
  if (propertyType) segments.push(propertyType);

  const transaction = multi(filters.transaction_type, TRANSACTION_TYPE_LABELS);
  if (transaction) segments.push(transaction);

  const location = buildLocationSegment(filters, locationLabel);
  if (location) segments.push(location);

  const size = buildSizeSegment(filters);
  if (size) segments.push(size);

  const price = buildPriceSegment(filters);
  if (price) segments.push(price);

  if (segments.length === 0) return "Všechny nabídky";
  return segments.join(" · ");
}

/**
 * Build the "show me everything" URL the "+N more" CTA points at.
 * Serializes the same filters the watchdog stored, so the user lands on
 * a /search page already filtered to their criteria.
 */
export function composeMoreUrl(
  appBaseUrl: string,
  filters: ListingFilters,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === "" || value === false) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  const base = appBaseUrl.replace(/\/+$/, "");
  return qs ? `${base}/search?${qs}` : `${base}/search`;
}
