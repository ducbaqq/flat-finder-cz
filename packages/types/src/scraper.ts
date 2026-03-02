import type { PropertyType, Source, TransactionType } from "./enums.js";

export interface ScraperResult {
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
  amenities: string | null;
  image_urls: string;
  thumbnail_url: string | null;
  source_url: string | null;
  listed_at: string | null;
  scraped_at: string;
  is_active: boolean;
  deactivated_at: string | null;
  seller_name: string | null;
  seller_phone: string | null;
  seller_email: string | null;
  seller_company: string | null;
  additional_params: string | null;
}

export interface ScraperConfig {
  name: string;
  baseUrl: string;
  rps: number;
  concurrency: number;
}

export interface ScraperRunResult {
  source: string;
  new_count: number;
  updated_count: number;
  error_count: number;
  deactivated_count: number;
  elapsed_ms: number;
}
