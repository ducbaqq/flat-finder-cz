import type { ListingFilters } from "./listing.js";

export interface Watchdog {
  id: number;
  email: string;
  filters: ListingFilters;
  label: string | null;
  active: boolean;
  created_at: string;
  last_notified_at: string | null;
}

export interface CreateWatchdogRequest {
  email: string;
  filters: ListingFilters;
  label?: string;
}

export interface WatchdogsResponse {
  watchdogs: Watchdog[];
  total: number;
}
