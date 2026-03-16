/**
 * Cross-source value normalizer for listing fields.
 *
 * Maps the many Czech and English variations found across 10 different scrapers
 * to a canonical set of English lowercase values. This ensures reliable cross-source
 * filtering on condition, construction, ownership, energy_rating, furnishing, and layout.
 *
 * Created for SCR-01: No cross-source value normalization.
 */

// ---------------------------------------------------------------------------
// Canonical types
// ---------------------------------------------------------------------------

export type Condition =
  | "new"
  | "very_good"
  | "good"
  | "after_reconstruction"
  | "before_reconstruction"
  | "under_construction"
  | "poor"
  | "demolition"
  | "project";

export type Construction =
  | "brick"
  | "panel"
  | "mixed"
  | "wood"
  | "skeleton"
  | "prefab"
  | "stone"
  | "modular"
  | "other";

export type Ownership = "personal" | "cooperative" | "state" | "other";

export type EnergyRating = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type Furnishing = "furnished" | "unfurnished" | "partially";

// ---------------------------------------------------------------------------
// Condition normalization
// ---------------------------------------------------------------------------

const CONDITION_MAP: Array<[RegExp, Condition]> = [
  // "new" / "novostavba" variants
  [/novostavba/i, "new"],
  [/^new$/i, "new"],
  [/^NEW$/i, "new"],
  [/^new_build$/i, "new"],

  // "very_good" variants
  [/velmi\s+dobr/i, "very_good"],
  [/bezvad/i, "very_good"],
  [/very.?good/i, "very_good"],
  [/^VERY_GOOD$/i, "very_good"],

  // "good" variants (must come after very_good)
  [/^dobr[ýy]/i, "good"],
  [/^good$/i, "good"],
  [/^GOOD$/i, "good"],

  // "after_reconstruction" variants
  [/po\s+rekonstrukci/i, "after_reconstruction"],
  [/after.?reconstruction/i, "after_reconstruction"],
  [/^AFTER_RECONSTRUCTION$/i, "after_reconstruction"],

  // "before_reconstruction" variants
  [/p[řr]ed\s+rekonstrukc/i, "before_reconstruction"],
  [/before.?reconstruction/i, "before_reconstruction"],
  [/^BEFORE_RECONSTRUCTION$/i, "before_reconstruction"],
  [/before.?renovation/i, "before_reconstruction"],

  // "under_construction" variants
  [/ve\s+v[ýy]stavb/i, "under_construction"],
  [/under.?construction/i, "under_construction"],
  [/^UNDER_CONSTRUCTION$/i, "under_construction"],
  [/rozestav/i, "under_construction"],

  // "project" variants
  [/^projekt/i, "project"],
  [/^PROJECT$/i, "project"],

  // "poor" variants
  [/[šs]patn/i, "poor"],
  [/^poor$/i, "poor"],
  [/^BAD$/i, "poor"],
  [/^bad$/i, "poor"],

  // "demolition" variants
  [/k\s+demolici/i, "demolition"],
  [/demolition/i, "demolition"],
  [/^DEMOLITION$/i, "demolition"],
];

export function normalizeCondition(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  for (const [pattern, canonical] of CONDITION_MAP) {
    if (pattern.test(trimmed)) return canonical;
  }

  // If it looks like m2 values or land-use types, it's not a valid condition (SCR-02)
  if (/^\d+\s*m[²2]?$/i.test(trimmed)) return null;
  if (/^(obytn|rekrea[čc]n|pr[ůu]myslov|komer[čc]n|venkovsk)/i.test(trimmed)) return null;

  return null;
}

// ---------------------------------------------------------------------------
// Construction normalization
// ---------------------------------------------------------------------------

const CONSTRUCTION_MAP: Array<[RegExp, Construction]> = [
  // brick
  [/cihlo?v/i, "brick"],
  [/cihla/i, "brick"],
  [/zd[eě]n/i, "brick"],
  [/^brick$/i, "brick"],
  [/^BRICK$/i, "brick"],

  // panel
  [/panel/i, "panel"],
  [/^PANEL$/i, "panel"],

  // wood
  [/d[řr]ev/i, "wood"],
  [/^wood$/i, "wood"],
  [/^WOOD$/i, "wood"],

  // skeleton
  [/skelet/i, "skeleton"],
  [/^SKELETON$/i, "skeleton"],

  // prefab / montovana
  [/montovan/i, "prefab"],
  [/^prefab$/i, "prefab"],
  [/^MONTOVANA$/i, "prefab"],

  // mixed
  [/sm[íi][šs]en/i, "mixed"],
  [/^mixed$/i, "mixed"],
  [/^MIXED$/i, "mixed"],

  // stone
  [/kamen/i, "stone"],
  [/^stone$/i, "stone"],
  [/^STONE$/i, "stone"],

  // modular
  [/modul[áa]rn/i, "modular"],

  // other
  [/^OTHER$/i, "other"],
  [/^ostatn/i, "other"],
];

export function normalizeConstruction(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  for (const [pattern, canonical] of CONSTRUCTION_MAP) {
    if (pattern.test(trimmed)) return canonical;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Ownership normalization
// ---------------------------------------------------------------------------

const OWNERSHIP_MAP: Array<[RegExp, Ownership]> = [
  // personal
  [/osobn[íi]/i, "personal"],
  [/^personal$/i, "personal"],
  [/^PERSONAL$/i, "personal"],
  [/^PRIVATE$/i, "personal"],
  [/soukrom/i, "personal"],

  // cooperative
  [/dru[žz]stevn/i, "cooperative"],
  [/^cooperative$/i, "cooperative"],
  [/^COOPERATIVE$/i, "cooperative"],

  // state / municipal
  [/st[áa]tn[íi]/i, "state"],
  [/obecn[íi]/i, "state"],
  [/^state$/i, "state"],
  [/^STATE$/i, "state"],

  // other
  [/^OTHER$/i, "other"],
  [/^ostatn/i, "other"],
];

export function normalizeOwnership(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  for (const [pattern, canonical] of OWNERSHIP_MAP) {
    if (pattern.test(trimmed)) return canonical;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Energy rating normalization
// ---------------------------------------------------------------------------

export function normalizeEnergyRating(raw: string | null | undefined): EnergyRating | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // SCR-03: Extract letter from "Trida G - Mimoradne nehospodarna..." patterns
  const classMatch = trimmed.match(/T[řr][íi]da\s+([A-Ga-g])/i);
  if (classMatch) {
    return classMatch[1].toUpperCase() as EnergyRating;
  }

  // Match patterns like "G_EXTREMELY_INEFFICIENT" or "A_VERY_EFFICIENT"
  const enumMatch = trimmed.match(/^([A-Ga-g])[_\s-]/);
  if (enumMatch) {
    return enumMatch[1].toUpperCase() as EnergyRating;
  }

  // Single letter
  const singleLetter = trimmed.match(/^([A-Ga-g])$/);
  if (singleLetter) {
    return singleLetter[1].toUpperCase() as EnergyRating;
  }

  // Extract any A-G letter from the string as last resort
  const anyLetter = trimmed.match(/\b([A-Ga-g])\b/);
  if (anyLetter) {
    return anyLetter[1].toUpperCase() as EnergyRating;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Furnishing normalization
// ---------------------------------------------------------------------------

const FURNISHING_MAP: Array<[RegExp, Furnishing]> = [
  // partially (must come before furnished)
  [/[čc][áa]ste[čc]n/i, "partially"],
  [/^partially$/i, "partially"],
  [/^PARTIALLY$/i, "partially"],
  [/^partlyFurnished$/i, "partially"],
  [/polo\s*vybav/i, "partially"],

  // furnished
  [/^za[řr][íi]zen/i, "furnished"],
  [/^vybaven/i, "furnished"],
  [/^furnished$/i, "furnished"],
  [/^FURNISHED$/i, "furnished"],
  [/^yes$/i, "furnished"],
  [/^true$/i, "furnished"],
  [/^ano$/i, "furnished"],
  [/pln[eě]\s+vybav/i, "furnished"],

  // unfurnished
  [/neza[řr][íi]zen/i, "unfurnished"],
  [/nevybaven/i, "unfurnished"],
  [/^unfurnished$/i, "unfurnished"],
  [/^UNFURNISHED$/i, "unfurnished"],
  [/^no$/i, "unfurnished"],
  [/^false$/i, "unfurnished"],
  [/^ne$/i, "unfurnished"],
];

export function normalizeFurnishing(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  for (const [pattern, canonical] of FURNISHING_MAP) {
    if (pattern.test(trimmed)) return canonical;
  }

  // SCR-12: If it looks like a comma-separated item list (furnishing items from ceskereality),
  // classify by count: 4+ items -> furnished, 1-3 -> partially, 0 -> null
  if (trimmed.includes(",") || trimmed.includes("linka") || trimmed.includes("Led")) {
    const items = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    if (items.length >= 4) return "furnished";
    if (items.length >= 1) return "partially";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Layout normalization (SCR-07)
// ---------------------------------------------------------------------------

export function normalizeLayout(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;

  // Lowercase everything first
  trimmed = trimmed.toLowerCase();

  // Map garsoniera/garsonka variants to 1+kk
  if (/garsoni[eé]ra|garsonka|garsoni[eé]/i.test(trimmed)) return "1+kk";

  // Map atypicky variants to "atypicky"
  if (/atypick[ýy]|atypick[ýy]\/jin[ýy]|^jiný$|^jiny$/i.test(trimmed)) return "atypicky";

  // Map "pokoj" to "pokoj" (room)
  if (/^pokoj$/i.test(trimmed)) return "pokoj";

  // Standard layout patterns: "2+kk", "2+1", etc.
  const layoutMatch = trimmed.match(/(\d+\+(?:kk|\d))/);
  if (layoutMatch) return layoutMatch[1];

  return trimmed;
}

// ---------------------------------------------------------------------------
// Normalize all fields on a single listing result object
// ---------------------------------------------------------------------------

export interface NormalizableFields {
  condition: string | null;
  construction: string | null;
  ownership: string | null;
  energy_rating: string | null;
  furnishing: string | null;
  layout: string | null;
}

export function normalizeListingFields<T extends NormalizableFields>(listing: T): T {
  listing.condition = normalizeCondition(listing.condition);
  listing.construction = normalizeConstruction(listing.construction);
  listing.ownership = normalizeOwnership(listing.ownership);
  listing.energy_rating = normalizeEnergyRating(listing.energy_rating);
  listing.furnishing = normalizeFurnishing(listing.furnishing);
  listing.layout = normalizeLayout(listing.layout);
  return listing;
}
