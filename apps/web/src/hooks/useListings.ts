"use client";

import { useQuery } from "@tanstack/react-query";
import type { ListingsResponse, ListingCardResponse } from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";
import { useUiStore, type MapBounds } from "@/store/ui-store";

interface UseListingsOptions {
  filters: Record<string, string>;
  page: number;
  perPage?: number;
  /** When true, constrain results to the current map viewport */
  boundToMap?: boolean;
}

/** Filter keys that indicate content filters are active (excludes sort) */
const CONTENT_FILTER_KEYS = [
  "transaction_type", "property_type", "location",
  "price_min", "price_max", "size_min", "size_max",
  "layout", "condition", "construction", "ownership",
  "furnishing", "energy_rating", "amenities", "source",
];

function hasContentFilters(filters: Record<string, string>): boolean {
  return CONTENT_FILTER_KEYS.some((k) => !!filters[k]);
}

type CombinedResponse = ListingsResponse | ListingCardResponse;

export function useListings({ filters, page, perPage = 20, boundToMap = false }: UseListingsOptions) {
  const mapBounds = useUiStore((s) => s.mapBounds);
  const bounds: MapBounds | null = boundToMap ? mapBounds : null;
  const filtered = hasContentFilters(filters);

  // Use instant Supercluster endpoint when: map-bounded + no content filters
  const useInstant = boundToMap && bounds !== null && !filtered;

  const params: Record<string, unknown> = {
    page,
    per_page: perPage,
  };

  // Always include sort
  if (filters.sort) params.sort = filters.sort;

  if (useInstant) {
    // Instant path: only needs bbox + pagination + sort
    if (bounds) {
      params.sw_lat = bounds.sw_lat;
      params.sw_lng = bounds.sw_lng;
      params.ne_lat = bounds.ne_lat;
      params.ne_lng = bounds.ne_lng;
    }
  } else {
    // DB path: include all filters
    for (const [key, value] of Object.entries(filters)) {
      if (value) params[key] = value;
    }
    if (bounds) {
      params.sw_lat = bounds.sw_lat;
      params.sw_lng = bounds.sw_lng;
      params.ne_lat = bounds.ne_lat;
      params.ne_lng = bounds.ne_lng;
    }
  }

  const endpoint = useInstant ? "/markers/listings" : "/listings";

  return useQuery<CombinedResponse>({
    queryKey: [endpoint, params],
    queryFn: ({ signal }) => apiGet<CombinedResponse>(endpoint, params, { signal }),
    staleTime: 60_000,
    retry: 2,
    retryDelay: 1000,
    placeholderData: (prev) => prev,
  });
}
