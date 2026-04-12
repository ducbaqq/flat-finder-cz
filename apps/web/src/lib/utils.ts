import type { Listing } from "@flat-finder/types";

export function formatPrice(price: number | null | undefined, currency?: string): string {
  if (!price) return "Na dotaz";
  const p = Math.round(price);
  return p.toLocaleString("cs-CZ") + " " + (currency || "K\u010d");
}

export function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr.replace(" ", "T") + "Z");
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return "pr\u00e1v\u011b te\u010f";
  if (diff < 3600) return `p\u0159ed ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `p\u0159ed ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return "v\u010dera";
  if (days < 7) return `p\u0159ed ${days} dny`;
  if (days < 30) return `p\u0159ed ${Math.floor(days / 7)} t\u00fdd.`;
  return `p\u0159ed ${Math.floor(days / 30)} m\u011bs.`;
}

const SREALITY_TRANS_CZ: Record<string, string> = {
  sale: "prodej",
  rent: "pronajem",
  auction: "drazby",
};
const SREALITY_PROP_CZ: Record<string, string> = {
  flat: "byt",
  house: "dum",
  land: "pozemek",
  commercial: "komercni",
  other: "ostatni",
  garage: "garaz",
};

const SOURCE_URLS: Record<string, (listing: Listing) => string | null> = {
  sreality(listing) {
    const hashId = (listing.external_id || "").replace("sreality_", "");
    if (!hashId) return null;
    const trans =
      SREALITY_TRANS_CZ[listing.transaction_type] || listing.transaction_type;
    const prop =
      SREALITY_PROP_CZ[listing.property_type] || listing.property_type;
    const slug =
      listing.property_type === "flat" && listing.layout
        ? listing.layout
        : "x";
    return `https://www.sreality.cz/detail/${trans}/${prop}/${slug}/x/${hashId}`;
  },
  ulovdomov(listing) {
    const offerId = (listing.external_id || "").replace("ulovdomov_", "");
    if (!offerId) return null;
    return `https://www.ulovdomov.cz/inzerat/x/${offerId}`;
  },
  bezrealitky(listing) {
    if (
      listing.source_url &&
      listing.source_url.includes("/nemovitosti-byty-domy/")
    ) {
      return listing.source_url;
    }
    const advertId = (listing.external_id || "").replace("bezrealitky_", "");
    if (!advertId) return null;
    return `https://www.bezrealitky.cz/nemovitosti-byty-domy/${advertId}`;
  },
};

export function buildSourceUrl(listing: Listing): string | null {
  const builder = SOURCE_URLS[listing.source];
  if (builder) return builder(listing);
  return listing.source_url || null;
}

export const propertyTypeLabels: Record<string, string> = {
  flat: "Byt",
  house: "D\u016fm",
  commercial: "Komer\u010dn\u00ed",
  garage: "Gar\u00e1\u017e",
  residential_building: "\u010cin\u017eovn\u00ed d\u016fm",
  land: "Pozemek",
  cottage: "Chata",
};

export const conditionLabels: Record<string, string> = {
  very_good: "Velmi dobr\u00fd",
  good: "Dobr\u00fd",
  bad: "\u0160patn\u00fd",
  new_build: "Novostavba",
  after_renovation: "Po rekonstrukci",
  before_renovation: "P\u0159ed rekonstrukc\u00ed",
  under_construction: "Ve v\u00fdstavb\u011b",
  project: "Projekt",
  for_demolition: "K demolici",
};

export const constructionLabels: Record<string, string> = {
  brick: "Cihlov\u00e1",
  panel: "Panelov\u00e1",
  wooden: "D\u0159ev\u011bn\u00e1",
  stone: "Kamenn\u00e1",
  mixed: "Sm\u00ed\u0161en\u00e1",
  prefab: "Montovan\u00e1",
  skeletal: "Skeletov\u00e1",
};

export const ownershipLabels: Record<string, string> = {
  personal: "Osobní",
  cooperative: "Družstevní",
  state: "Státní / Obecní",
  other: "Ostatní",
};

export const furnishingLabels: Record<string, string> = {
  furnished: "Za\u0159\u00edzen\u00e9",
  partially: "\u010c\u00e1ste\u010dn\u011b",
  unfurnished: "Neza\u0159\u00edzen\u00e9",
};

export const amenityLabels: Record<string, string> = {
  balcony: "Balkón",
  lift: "Výtah",
  elevator: "Výtah",
  parking: "Parkování",
  cellar: "Sklep",
  garden: "Zahrada",
  terrace: "Terasa",
  loggia: "Lodžie",
  garage: "Garáž",
  barrier_free: "Bezbariérový",
  pool: "Bazén",
  air_conditioning: "Klimatizace",
  dishwasher: "Myčka",
  washing_machine: "Pračka",
};

export interface FilterSummaryTag {
  label: string;
  value: string;
}

export function getFilterSummaryTags(
  filters: Record<string, string | undefined>
): FilterSummaryTag[] {
  const tags: FilterSummaryTag[] = [];
  const f = filters;

  const transLabels: Record<string, string> = {
    rent: "Pron\u00e1jem",
    sale: "Prodej",
  };
  if (f.transaction_type)
    tags.push({
      label: "Typ",
      value: transLabels[f.transaction_type] || f.transaction_type,
    });
  if (f.property_type) {
    const types = f.property_type
      .split(",")
      .map((t) => propertyTypeLabels[t] || t);
    tags.push({ label: "Nemovitost", value: types.join(", ") });
  }
  if (f.location) tags.push({ label: "Lokalita", value: f.location });
  if (f.price_min || f.price_max) {
    const parts: string[] = [];
    if (f.price_min)
      parts.push("od " + Number(f.price_min).toLocaleString("cs-CZ"));
    if (f.price_max)
      parts.push("do " + Number(f.price_max).toLocaleString("cs-CZ"));
    tags.push({ label: "Cena", value: parts.join(" ") + " K\u010d" });
  }
  if (f.size_min || f.size_max) {
    const parts: string[] = [];
    if (f.size_min) parts.push("od " + f.size_min);
    if (f.size_max) parts.push("do " + f.size_max);
    tags.push({ label: "Plocha", value: parts.join(" ") + " m\u00b2" });
  }
  if (f.layout) tags.push({ label: "Dispozice", value: f.layout });
  if (f.condition)
    tags.push({
      label: "Stav",
      value: f.condition
        .split(",")
        .map((c) => conditionLabels[c] || c)
        .join(", "),
    });
  if (f.construction)
    tags.push({
      label: "Konstrukce",
      value: f.construction
        .split(",")
        .map((c) => constructionLabels[c] || c)
        .join(", "),
    });
  if (f.ownership)
    tags.push({
      label: "Vlastnictv\u00ed",
      value: f.ownership
        .split(",")
        .map((o) => ownershipLabels[o] || o)
        .join(", "),
    });
  if (f.furnishing)
    tags.push({
      label: "Vybavenost",
      value: furnishingLabels[f.furnishing] || f.furnishing,
    });
  if (f.energy_rating)
    tags.push({ label: "Energetická třída (PENB)", value: f.energy_rating });
  if (f.amenities)
    tags.push({
      label: "Vybaven\u00ed",
      value: f.amenities
        .split(",")
        .map((a) => amenityLabels[a] || a)
        .join(", "),
    });
  if (f.source)
    tags.push({
      label: "Zdroj inzerátu",
      value: f.source
        .split(",")
        .map((s) => s + ".cz")
        .join(", "),
    });

  return tags;
}
