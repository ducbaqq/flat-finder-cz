"use client";

import { useEffect, useRef } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { getSearchPreferences, saveSearchPreferences } from "./useSearchPreferences";
import { useUiStore } from "@/store/ui-store";

export const defaultSort = "newest";

export function useSearchFilters() {
  const mapBounds = useUiStore((s) => s.mapBounds);
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

  // Restore saved preferences on mount. Filter restoration is skipped when
  // the URL already has explicit filter params; view restoration is skipped
  // only when the URL has an explicit ?view= param (so users with shared
  // filter links still get their preferred view).
  const restoredRef = useRef(false);
  const setPendingBbox = useUiStore((s) => s.setPendingBbox);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const hasFilters =
      params.has("property_type") ||
      params.has("transaction_type") ||
      params.has("location");
    const hasView = params.has("view");

    const prefs = getSearchPreferences();

    if (!hasFilters) {
      // Apply saved preferences, or sensible defaults for cold visitors
      const pType = prefs?.property_type || "flat";
      const tType = prefs?.transaction_type || "rent";

      setPropertyType(pType);
      setTransactionType(tType);
      if (prefs?.location) setLocation(prefs.location);
      if (prefs?.bbox) setPendingBbox(prefs.bbox);
    }

    if (!hasView && prefs?.view) {
      setView(prefs.view);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist preference fields to localStorage whenever they change.
  // View is persisted independently so users get their preferred layout
  // even before any filter has been set.
  useEffect(() => {
    if (transactionType || propertyType || location) {
      saveSearchPreferences({
        property_type: propertyType || undefined,
        transaction_type: transactionType || undefined,
        location: location || undefined,
        bbox: mapBounds
          ? [mapBounds.sw_lng, mapBounds.sw_lat, mapBounds.ne_lng, mapBounds.ne_lat]
          : undefined,
      });
    }
  }, [transactionType, propertyType, location, mapBounds]);

  useEffect(() => {
    if (!restoredRef.current) return;
    if (view === "list" || view === "map" || view === "hybrid") {
      saveSearchPreferences({ view });
    }
  }, [view]);

  const setFilter = (key: string, value: string) => {
    const setters: Record<string, (v: string) => void> = {
      transaction_type: (v) => setTransactionType(v || null),
      property_type: (v) => setPropertyType(v || null),
      location: (v) => setLocation(v || null),
      price_min: (v) => setPriceMin(v || null),
      price_max: (v) => setPriceMax(v || null),
      size_min: (v) => setSizeMin(v || null),
      size_max: (v) => setSizeMax(v || null),
      layout: (v) => setLayout(v || null),
      condition: (v) => setCondition(v || null),
      construction: (v) => setConstruction(v || null),
      ownership: (v) => setOwnership(v || null),
      furnishing: (v) => setFurnishing(v || null),
      energy_rating: (v) => setEnergyRating(v || null),
      amenities: (v) => setAmenities(v || null),
      source: (v) => setSource(v || null),
      sort: (v) => setSort(v || defaultSort),
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
  };

  return {
    filters,
    view,
    setView,
    setFilter,
    clearFilters,
  };
}
