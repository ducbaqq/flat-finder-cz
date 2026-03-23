/**
 * Shared amenity normalizer for all scrapers.
 *
 * Target format: sorted JSON array of English lowercase keys.
 * Example: ["balcony","cellar","garage","lift","parking","terrace"]
 */

const CZECH_TO_ENGLISH: Record<string, string> = {
  // balcony
  balkón: "balcony",
  balkon: "balcony",
  // terrace
  terasa: "terrace",
  // loggia
  lodžie: "loggia",
  lodzie: "loggia",
  // cellar
  sklep: "cellar",
  sklepní: "cellar",
  sklepni: "cellar",
  // lift / elevator
  výtah: "lift",
  vytah: "lift",
  elevator: "lift",
  // garage
  garáž: "garage",
  garaz: "garage",
  garážové: "garage",
  garazove: "garage",
  "garážové stání": "garage",
  "garazove stani": "garage",
  // parking
  parkování: "parking",
  parkovani: "parking",
  parking: "parking",
  // garden
  zahrada: "garden",
  // barrier free
  bezbariérový: "barrier_free",
  bezbarierovy: "barrier_free",
  barrier_free: "barrier_free",
  // pool
  bazén: "pool",
  bazen: "pool",
  // air conditioning
  klimatizace: "air_conditioning",
};

/**
 * Normalize a single Czech or English amenity string to its English key.
 * Strips dimension suffixes like "Balkón 2 m²" → "balcony".
 */
function normalizeOne(raw: string): string | null {
  // Strip dimension suffixes: "Balkón 2 m²" → "Balkón"
  let cleaned = raw.replace(/\s*\d+[\s,.]*m[²2]?\s*$/i, "").trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();

  // Direct match
  if (CZECH_TO_ENGLISH[lower]) return CZECH_TO_ENGLISH[lower];

  // Substring match (e.g. "Osobní výtah" contains "výtah")
  for (const [czech, english] of Object.entries(CZECH_TO_ENGLISH)) {
    if (lower.includes(czech)) return english;
  }

  // Already an English key we know
  if (Object.values(CZECH_TO_ENGLISH).includes(lower)) return lower;

  return null;
}

/**
 * Normalize amenities from any format to a sorted JSON array of English keys.
 *
 * Handles:
 * - JSON array string: '["balkón","sklep"]'
 * - Comma-separated string: "balkón, sklep, výtah"
 * - Already-English keys: "balcony,cellar"
 * - Mixed formats with dimension suffixes: "Balkón 2 m², Terasa 5 m²"
 *
 * Returns null if no amenities could be normalized.
 */
export function normalizeAmenities(raw: string | null): string | null {
  if (!raw) return null;

  let items: string[];

  // Try parsing as JSON array first
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        items = parsed.map(String);
      } else {
        items = [trimmed];
      }
    } catch {
      items = [trimmed];
    }
  } else {
    // Comma-separated
    items = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const normalized = new Set<string>();
  for (const item of items) {
    const key = normalizeOne(item);
    if (key) normalized.add(key);
  }

  if (normalized.size === 0) return null;

  return JSON.stringify([...normalized].sort());
}
