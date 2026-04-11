const STORAGE_KEY = "search_preferences";

export type SearchView = "list" | "map" | "hybrid";

export interface SearchPreferences {
  property_type?: string;
  transaction_type?: string;
  location?: string;
  bbox?: [number, number, number, number];
  view?: SearchView;
}

export function saveSearchPreferences(prefs: SearchPreferences): void {
  if (typeof window === "undefined") return;

  // Merge with any existing record so partial updates (e.g. just the view)
  // don't wipe out previously-saved filter prefs.
  const existing = getSearchPreferences() ?? {};
  const merged: SearchPreferences = { ...existing };
  if (prefs.property_type) merged.property_type = prefs.property_type;
  if (prefs.transaction_type) merged.transaction_type = prefs.transaction_type;
  if (prefs.location) merged.location = prefs.location;
  if (prefs.bbox) merged.bbox = prefs.bbox;
  if (prefs.view) merged.view = prefs.view;

  if (Object.keys(merged).length === 0) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
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

    if (
      !parsed.property_type &&
      !parsed.transaction_type &&
      !parsed.location &&
      !parsed.view
    ) {
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
