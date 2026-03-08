import type { PropertyType, Source, SortOption, TransactionType } from "./enums.js";

export interface Listing {
  id: number;
  external_id: string;
  source: Source;
  property_type: PropertyType;
  transaction_type: TransactionType;
  title: string | null;
  description: string | null;
  price: number | null;
  currency: string;
  price_note: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  size_m2: number | null;
  layout: string | null;
  floor: number | null;
  total_floors: number | null;
  condition: string | null;
  construction: string | null;
  ownership: string | null;
  furnishing: string | null;
  energy_rating: string | null;
  amenities: string[];
  image_urls: string[];
  thumbnail_url: string | null;
  source_url: string | null;
  listed_at: string | null;
  scraped_at: string;
  created_at: string;
  is_active: boolean;
  deactivated_at: string | null;
  seller_name: string | null;
  seller_phone: string | null;
  seller_email: string | null;
  seller_company: string | null;
  additional_params: Record<string, unknown> | null;
}

export interface ListingFilters {
  property_type?: string;
  transaction_type?: string;
  city?: string;
  region?: string;
  source?: string;
  layout?: string;
  condition?: string;
  construction?: string;
  ownership?: string;
  furnishing?: string;
  energy_rating?: string;
  amenities?: string;
  location?: string;
  price_min?: number;
  price_max?: number;
  size_min?: number;
  size_max?: number;
  sort?: SortOption;
  page?: number;
  per_page?: number;
  sw_lat?: number;
  sw_lng?: number;
  ne_lat?: number;
  ne_lng?: number;
  include_inactive?: boolean;
}

export interface ListingsResponse {
  listings: Listing[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface MarkerPoint {
  id: number;
  lat: number;
  lng: number;
  price: number | null;
}

export interface ClusterPoint {
  lat: number;
  lng: number;
  count: number;
  avg_price: number | null;
}

export interface MarkersResponse {
  markers: MarkerPoint[];
  clusters: ClusterPoint[];
  total: number;
  clustered: boolean;
}

export interface StatsResponse {
  total: number;
  total_all: number;
  inactive: number;
  by_source: Record<string, number>;
  by_type: Record<string, number>;
  by_transaction: Record<string, number>;
  by_city: Record<string, number>;
}
