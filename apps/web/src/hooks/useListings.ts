"use client";

import { useQuery } from "@tanstack/react-query";
import type { ListingsResponse } from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";

interface UseListingsOptions {
  filters: Record<string, string>;
  page: number;
  perPage?: number;
}

export function useListings({ filters, page, perPage = 20 }: UseListingsOptions) {
  const params: Record<string, unknown> = {
    page,
    per_page: perPage,
  };

  for (const [key, value] of Object.entries(filters)) {
    if (value) params[key] = value;
  }

  return useQuery<ListingsResponse>({
    queryKey: ["listings", params],
    queryFn: () => apiGet<ListingsResponse>("/listings", params),
    staleTime: 60_000,
    retry: 2,
    retryDelay: 1000,
  });
}
