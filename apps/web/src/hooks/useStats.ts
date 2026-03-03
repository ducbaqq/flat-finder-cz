"use client";

import { useQuery } from "@tanstack/react-query";
import type { StatsResponse } from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";

export function useStats() {
  return useQuery<StatsResponse>({
    queryKey: ["stats"],
    queryFn: () => apiGet<StatsResponse>("/stats"),
    staleTime: 60_000,
  });
}
