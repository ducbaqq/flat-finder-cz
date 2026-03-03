"use client";

import { useQuery } from "@tanstack/react-query";
import type { ListingsResponse } from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";
import { useUiStore } from "@/store/ui-store";

interface UseListingsOptions {
  filters: Record<string, string>;
  page: number;
  perPage?: number;
}

export function useListings({ filters, page, perPage = 20 }: UseListingsOptions) {
  const mapBounds = useUiStore((s) => s.mapBounds);

  const params: Record<string, unknown> = {
    page,
    per_page: perPage,
  };

  for (const [key, value] of Object.entries(filters)) {
    if (value) params[key] = value;
  }

  if (mapBounds) {
    params.sw_lat = mapBounds.sw_lat;
    params.sw_lng = mapBounds.sw_lng;
    params.ne_lat = mapBounds.ne_lat;
    params.ne_lng = mapBounds.ne_lng;
  }

  return useQuery<ListingsResponse>({
    queryKey: ["listings", params],
    queryFn: () => apiGet<ListingsResponse>("/listings", params),
  });
}
