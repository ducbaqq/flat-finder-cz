"use client";

import {
  useQueryState,
  parseAsString,
  parseAsInteger,
} from "nuqs";

export const defaultSort = "newest";

export function useSearchFilters() {
  const [transactionType, setTransactionType] = useQueryState(
    "transaction_type",
    parseAsString.withDefault("")
  );
  const [propertyType, setPropertyType] = useQueryState(
    "property_type",
    parseAsString.withDefault("")
  );
  const [location, setLocation] = useQueryState(
    "location",
    parseAsString.withDefault("")
  );
  const [priceMin, setPriceMin] = useQueryState(
    "price_min",
    parseAsString.withDefault("")
  );
  const [priceMax, setPriceMax] = useQueryState(
    "price_max",
    parseAsString.withDefault("")
  );
  const [sizeMin, setSizeMin] = useQueryState(
    "size_min",
    parseAsString.withDefault("")
  );
  const [sizeMax, setSizeMax] = useQueryState(
    "size_max",
    parseAsString.withDefault("")
  );
  const [layout, setLayout] = useQueryState(
    "layout",
    parseAsString.withDefault("")
  );
  const [condition, setCondition] = useQueryState(
    "condition",
    parseAsString.withDefault("")
  );
  const [construction, setConstruction] = useQueryState(
    "construction",
    parseAsString.withDefault("")
  );
  const [ownership, setOwnership] = useQueryState(
    "ownership",
    parseAsString.withDefault("")
  );
  const [furnishing, setFurnishing] = useQueryState(
    "furnishing",
    parseAsString.withDefault("")
  );
  const [energyRating, setEnergyRating] = useQueryState(
    "energy_rating",
    parseAsString.withDefault("")
  );
  const [amenities, setAmenities] = useQueryState(
    "amenities",
    parseAsString.withDefault("")
  );
  const [source, setSource] = useQueryState(
    "source",
    parseAsString.withDefault("")
  );
  const [sort, setSort] = useQueryState(
    "sort",
    parseAsString.withDefault(defaultSort)
  );
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const [view, setView] = useQueryState(
    "view",
    parseAsString.withDefault("hybrid")
  );
  const filters = {
    transaction_type: transactionType,
    property_type: propertyType,
    location,
    price_min: priceMin,
    price_max: priceMax,
    size_min: sizeMin,
    size_max: sizeMax,
    layout,
    condition,
    construction,
    ownership,
    furnishing,
    energy_rating: energyRating,
    amenities,
    source,
    sort,
  };

  const setFilter = (key: string, value: string) => {
    const setters: Record<string, (v: string) => void> = {
      transaction_type: (v) => { setTransactionType(v || null); setPage(1); },
      property_type: (v) => { setPropertyType(v || null); setPage(1); },
      location: (v) => { setLocation(v || null); setPage(1); },
      price_min: (v) => { setPriceMin(v || null); setPage(1); },
      price_max: (v) => { setPriceMax(v || null); setPage(1); },
      size_min: (v) => { setSizeMin(v || null); setPage(1); },
      size_max: (v) => { setSizeMax(v || null); setPage(1); },
      layout: (v) => { setLayout(v || null); setPage(1); },
      condition: (v) => { setCondition(v || null); setPage(1); },
      construction: (v) => { setConstruction(v || null); setPage(1); },
      ownership: (v) => { setOwnership(v || null); setPage(1); },
      furnishing: (v) => { setFurnishing(v || null); setPage(1); },
      energy_rating: (v) => { setEnergyRating(v || null); setPage(1); },
      amenities: (v) => { setAmenities(v || null); setPage(1); },
      source: (v) => { setSource(v || null); setPage(1); },
      sort: (v) => { setSort(v || defaultSort); setPage(1); },
    };
    setters[key]?.(value);
  };

  const clearFilters = () => {
    setTransactionType(null);
    setPropertyType(null);
    setLocation(null);
    setPriceMin(null);
    setPriceMax(null);
    setSizeMin(null);
    setSizeMax(null);
    setLayout(null);
    setCondition(null);
    setConstruction(null);
    setOwnership(null);
    setFurnishing(null);
    setEnergyRating(null);
    setAmenities(null);
    setSource(null);
    setSort(defaultSort);
    setPage(1);
  };

  return {
    filters,
    page,
    setPage,
    view,
    setView,
    setFilter,
    clearFilters,
  };
}
