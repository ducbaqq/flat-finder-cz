"use client";

import { useQuery } from "@tanstack/react-query";
import type { ListingsResponse } from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";
import { useUiStore, type MapBounds } from "@/store/ui-store";

interface UseListingsOptions {
  filters: Record<string, string>;
  page: number;
  perPage?: number;
  /** When true, constrain results to the current map viewport */
  boundToMap?: boolean;
}

export function useListings({ filters, page, perPage = 20, boundToMap = false }: UseListingsOptions) {
  const mapBounds = useUiStore((s) => s.mapBounds);
  const bounds: MapBounds | null = boundToMap ? mapBounds : null;

  const params: Record<string, unknown> = {
    page,
    per_page: perPage,
  };

  for (const [key, value] of Object.entries(filters)) {
    if (value) params[key] = value;
  }

  if (bounds) {
    params.sw_lat = bounds.sw_lat;
    params.sw_lng = bounds.sw_lng;
    params.ne_lat = bounds.ne_lat;
    params.ne_lng = bounds.ne_lng;
  }

  return useQuery<ListingsResponse>({
    queryKey: ["listings", params],
    queryFn: () => apiGet<ListingsResponse>("/listings", params),
    staleTime: 60_000,
    retry: 2,
    retryDelay: 1000,
  });
}
