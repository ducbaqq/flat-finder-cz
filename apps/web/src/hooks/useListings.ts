"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type {
  ListingsResponse,
  ListingCardResponse,
  Listing,
  ListingCardData,
} from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";
import { useUiStore, type MapBounds } from "@/store/ui-store";

interface UseListingsOptions {
  filters: Record<string, string>;
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

export function useListings({
  filters,
  perPage = 20,
  boundToMap = false,
}: UseListingsOptions) {
  const mapBounds = useUiStore((s) => s.mapBounds);
  const bounds: MapBounds | null = boundToMap ? mapBounds : null;
  const filtered = hasContentFilters(filters);

  // Use instant Supercluster endpoint when: map-bounded + no content filters
  const useInstant = boundToMap && bounds !== null && !filtered;

  const baseParams: Record<string, unknown> = {
    per_page: perPage,
  };

  if (filters.sort) baseParams.sort = filters.sort;

  if (useInstant) {
    if (bounds) {
      baseParams.sw_lat = bounds.sw_lat;
      baseParams.sw_lng = bounds.sw_lng;
      baseParams.ne_lat = bounds.ne_lat;
      baseParams.ne_lng = bounds.ne_lng;
    }
  } else {
    for (const [key, value] of Object.entries(filters)) {
      if (value) baseParams[key] = value;
    }
    if (bounds) {
      baseParams.sw_lat = bounds.sw_lat;
      baseParams.sw_lng = bounds.sw_lng;
      baseParams.ne_lat = bounds.ne_lat;
      baseParams.ne_lng = bounds.ne_lng;
    }
  }

  const endpoint = useInstant ? "/markers/listings" : "/listings";

  const query = useInfiniteQuery<CombinedResponse>({
    queryKey: [endpoint, baseParams],
    queryFn: ({ pageParam, signal }) =>
      apiGet<CombinedResponse>(
        endpoint,
        { ...baseParams, page: pageParam as number },
        { signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    staleTime: 60_000,
    retry: 2,
    retryDelay: 1000,
    placeholderData: (prev) => prev,
  });

  const listings = useMemo<(Listing | ListingCardData)[]>(() => {
    const pages = query.data?.pages;
    if (!pages) return [];
    const seen = new Set<number>();
    const out: (Listing | ListingCardData)[] = [];
    for (const p of pages) {
      for (const l of p.listings) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        out.push(l);
      }
    }
    return out;
  }, [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;

  return {
    listings,
    total,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    isError: query.isError,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
  };
}
