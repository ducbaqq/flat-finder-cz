"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarkersResponse } from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";
import { useUiStore } from "@/store/ui-store";

interface UseMarkersOptions {
  filters: Record<string, string>;
  zoom: number;
}

export function useMarkers({ filters, zoom }: UseMarkersOptions) {
  const mapBounds = useUiStore((s) => s.mapBounds);

  const params: Record<string, unknown> = { zoom };

  for (const [key, value] of Object.entries(filters)) {
    if (value) params[key] = value;
  }

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
