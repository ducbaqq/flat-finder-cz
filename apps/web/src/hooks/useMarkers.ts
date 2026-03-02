"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarkersResponse } from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";
import { useFilterStore } from "@/store/filter-store";

export function useMarkers(zoom: number) {
  const filters = useFilterStore((s) => s.filters);
  const mapBounds = useFilterStore((s) => s.mapBounds);

  const params: Record<string, unknown> = {
    zoom,
  };

  if (filters.transaction_type) params.transaction_type = filters.transaction_type;
  if (filters.property_type) params.property_type = filters.property_type;
  if (filters.location) params.location = filters.location;
  if (filters.price_min) params.price_min = filters.price_min;
  if (filters.price_max) params.price_max = filters.price_max;
  if (filters.size_min) params.size_min = filters.size_min;
  if (filters.size_max) params.size_max = filters.size_max;
  if (filters.layout) params.layout = filters.layout;
  if (filters.condition) params.condition = filters.condition;
  if (filters.construction) params.construction = filters.construction;
  if (filters.ownership) params.ownership = filters.ownership;
  if (filters.furnishing) params.furnishing = filters.furnishing;
  if (filters.energy_rating) params.energy_rating = filters.energy_rating;
  if (filters.amenities) params.amenities = filters.amenities;
  if (filters.source) params.source = filters.source;
  if (filters.sort) params.sort = filters.sort;

  if (mapBounds) {
    params.sw_lat = mapBounds.sw_lat;
    params.sw_lng = mapBounds.sw_lng;
    params.ne_lat = mapBounds.ne_lat;
    params.ne_lng = mapBounds.ne_lng;
  }

  return useQuery<MarkersResponse>({
    queryKey: ["markers", params],
    queryFn: () => apiGet<MarkersResponse>("/markers", params),
    enabled: zoom > 0,
  });
}
