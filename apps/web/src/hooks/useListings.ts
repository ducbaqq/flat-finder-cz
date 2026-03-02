"use client";

import { useQuery } from "@tanstack/react-query";
import type { ListingsResponse } from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";
import { useFilterStore } from "@/store/filter-store";
import { useEffect } from "react";

export function useListings() {
  const filters = useFilterStore((s) => s.filters);
  const page = useFilterStore((s) => s.page);
  const perPage = useFilterStore((s) => s.perPage);
  const mapBounds = useFilterStore((s) => s.mapBounds);
  const setTotal = useFilterStore((s) => s.setTotal);

  const params: Record<string, unknown> = {
    page,
    per_page: perPage,
    sort: filters.sort,
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

  if (mapBounds) {
    params.sw_lat = mapBounds.sw_lat;
    params.sw_lng = mapBounds.sw_lng;
    params.ne_lat = mapBounds.ne_lat;
    params.ne_lng = mapBounds.ne_lng;
  }

  const query = useQuery<ListingsResponse>({
    queryKey: ["listings", params],
    queryFn: () => apiGet<ListingsResponse>("/listings", params),
  });

  useEffect(() => {
    if (query.data) {
      setTotal(query.data.total, query.data.total_pages);
    }
  }, [query.data, setTotal]);

  return query;
}
