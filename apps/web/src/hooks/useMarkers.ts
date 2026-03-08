"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarkersResponse } from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";
import { useUiStore } from "@/store/ui-store";

export function useMarkers(filters: Record<string, string>) {
  const mapBounds = useUiStore((s) => s.mapBounds);
  const mapZoom = useUiStore((s) => s.mapZoom);

  const params: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(filters)) {
    if (value) params[key] = value;
  }

  if (mapBounds) {
    params.sw_lat = mapBounds.sw_lat;
    params.sw_lng = mapBounds.sw_lng;
    params.ne_lat = mapBounds.ne_lat;
    params.ne_lng = mapBounds.ne_lng;
  }

  if (mapZoom != null) {
    params.zoom = Math.floor(mapZoom);
  }

  return useQuery<MarkersResponse>({
    queryKey: ["markers", params],
    queryFn: () => apiGet<MarkersResponse>("/markers", params),
    enabled: mapBounds !== null,
    placeholderData: (prev) => prev,
  });
}
