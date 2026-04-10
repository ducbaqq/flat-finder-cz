const STORAGE_KEY = "search_preferences";

export interface SearchPreferences {
  property_type?: string;
  transaction_type?: string;
  location?: string;
  bbox?: [number, number, number, number];
}

export function saveSearchPreferences(prefs: SearchPreferences): void {
  if (typeof window === "undefined") return;

  const cleaned: SearchPreferences = {};
  if (prefs.property_type) cleaned.property_type = prefs.property_type;
  if (prefs.transaction_type) cleaned.transaction_type = prefs.transaction_type;
  if (prefs.location) cleaned.location = prefs.location;
  if (prefs.bbox) cleaned.bbox = prefs.bbox;

  if (Object.keys(cleaned).length === 0) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function getSearchPreferences(): SearchPreferences | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SearchPreferences;

    // Only return if at least one field is present
    if (!parsed.property_type && !parsed.transaction_type && !parsed.location) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSearchPreferences(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // silently ignore
  }
}
