export interface ApiError {
  error: string;
}

export interface HealthResponse {
  status: "ok";
  total: number;
  by_source: Record<string, number>;
}
