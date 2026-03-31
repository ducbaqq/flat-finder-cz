export interface ApiError {
  error: string;
}

export interface HealthResponse {
  status: "ok";
  total: number;
  by_source: Record<string, number>;
}

export interface SuggestItem {
  name: string;
  label: string;
  position: { lon: number; lat: number };
  type: string;
  location?: string;
  zip?: string;
}

export interface SuggestResponse {
  items: SuggestItem[];
}
