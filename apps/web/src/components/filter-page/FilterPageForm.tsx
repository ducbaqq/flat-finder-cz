"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Building2,
  Home,
  TreePine,
  Landmark,
  Package,
  MapPin,
} from "lucide-react";
import { PillToggle } from "./PillToggle";
import { PillRangeInput } from "./PillRangeInput";
import { FilterSection } from "./FilterSection";

/* ------------------------------------------------------------------ */
/*  Types & constants                                                  */
/* ------------------------------------------------------------------ */

interface FilterPageFormProps {
  initialPropertyType?: string;
  initialTransactionType?: string;
}

const PROPERTY_TYPES = [
  { value: "flat", label: "Byty", icon: <Building2 className="h-4 w-4" /> },
  { value: "house", label: "Domy", icon: <Home className="h-4 w-4" /> },
  { value: "land", label: "Pozemky", icon: <TreePine className="h-4 w-4" /> },
  {
    value: "commercial",
    label: "Komerční",
    icon: <Landmark className="h-4 w-4" />,
  },
  {
    value: "other",
    label: "Ostatní",
    icon: <Package className="h-4 w-4" />,
  },
] as const;

const TRANSACTION_TYPES = [
  { value: "sale", label: "Prodej" },
  { value: "rent", label: "Pronájem" },
] as const;

const LAYOUTS = [
  "1+kk",
  "1+1",
  "2+kk",
  "2+1",
  "3+kk",
  "3+1",
  "4+kk",
  "4+1",
  "5+kk",
  "5+1",
  "6+",
  "Atypický",
  "Pokoj",
] as const;

const BUILDING_CONDITIONS = [
  { value: "very_good", label: "Velmi dobrý" },
  { value: "good", label: "Dobrý" },
  { value: "bad", label: "Špatný" },
  { value: "under_construction", label: "Ve výstavbě" },
  { value: "new_build", label: "Novostavba" },
  { value: "for_demolition", label: "K demolici" },
  { value: "before_renovation", label: "Před rekonstrukcí" },
  { value: "after_renovation", label: "Po rekonstrukci" },
] as const;

const OWNERSHIP_TYPES = [
  { value: "private", label: "Osobní" },
  { value: "cooperative", label: "Družstevní" },
  { value: "municipal", label: "Obecní" },
] as const;

const FURNISHING_OPTIONS = [
  { value: "furnished", label: "Vybaveno" },
  { value: "unfurnished", label: "Nevybaveno" },
  { value: "partially", label: "Částečně" },
] as const;

const BUILDING_TYPES = [
  { value: "panel", label: "Panelová" },
  { value: "brick", label: "Cihlová" },
  { value: "other", label: "Ostatní" },
] as const;

const OUTDOOR_AMENITIES = [
  { value: "garden", label: "Zahrada" },
  { value: "balcony", label: "Balkón" },
  { value: "loggia", label: "Lodžie" },
  { value: "terrace", label: "Terasa" },
] as const;

const INDOOR_AMENITIES = [
  { value: "cellar", label: "Sklep" },
  { value: "parking", label: "Parkování" },
  { value: "garage", label: "Garáž" },
] as const;

const ACCESSIBILITY_OPTIONS = [
  { value: "elevator", label: "Výtah" },
  { value: "wheelchair", label: "Bezbariérový" },
] as const;

const ENERGY_CLASSES = [
  { value: "A", label: "A", color: "#1B7D3A" },
  { value: "B", label: "B", color: "#3DA648" },
  { value: "C", label: "C", color: "#8DC641" },
  { value: "D", label: "D", color: "#FDD835" },
  { value: "E", label: "E", color: "#F9A825" },
  { value: "F", label: "F", color: "#EF6C00" },
  { value: "G", label: "G", color: "#D32F2F" },
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function toggle(arr: string[], item: string): string[] {
  return arr.includes(item)
    ? arr.filter((x) => x !== item)
    : [...arr, item];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function FilterPageForm({
  initialPropertyType,
  initialTransactionType,
}: FilterPageFormProps) {
  const router = useRouter();

  // --- state ----------------------------------------------------------
  const [propertyTypes, setPropertyTypes] = useState<string[]>(
    initialPropertyType ? initialPropertyType.split(",") : [],
  );
  const [transactionTypes, setTransactionTypes] = useState<string[]>(
    initialTransactionType ? [initialTransactionType] : [],
  );
  const [layouts, setLayouts] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [areaMin, setAreaMin] = useState("");
  const [areaMax, setAreaMax] = useState("");
  const [conditions, setConditions] = useState<string[]>([]);
  const [ownership, setOwnership] = useState<string[]>([]);
  const [furnishing, setFurnishing] = useState<string[]>([]);
  const [buildingTypes, setBuildingTypes] = useState<string[]>([]);
  const [outdoorAmenities, setOutdoorAmenities] = useState<string[]>([]);
  const [indoorAmenities, setIndoorAmenities] = useState<string[]>([]);
  const [accessibility, setAccessibility] = useState<string[]>([]);
  const [energyClasses, setEnergyClasses] = useState<string[]>([]);

  // --- handlers -------------------------------------------------------
  const handleSubmit = useCallback(() => {
    const params = new URLSearchParams();

    if (propertyTypes.length)
      params.set("property_type", propertyTypes.join(","));
    if (transactionTypes.length)
      params.set("transaction_type", transactionTypes[0]);
    if (layouts.length) params.set("layout", layouts.join(","));
    if (location.trim()) params.set("location", location.trim());
    if (priceMin) params.set("price_min", priceMin);
    if (priceMax) params.set("price_max", priceMax);
    if (areaMin) params.set("size_min", areaMin);
    if (areaMax) params.set("size_max", areaMax);
    if (conditions.length) params.set("condition", conditions.join(","));
    if (ownership.length) params.set("ownership", ownership.join(","));
    if (furnishing.length) params.set("furnishing", furnishing.join(","));
    if (buildingTypes.length)
      params.set("construction", buildingTypes.join(","));
    const allAmenities = [...outdoorAmenities, ...indoorAmenities, ...accessibility];
    if (allAmenities.length)
      params.set("amenities", allAmenities.join(","));
    if (energyClasses.length)
      params.set("energy_rating", energyClasses.join(","));

    router.push(`/search?${params.toString()}`);
  }, [
    propertyTypes,
    transactionTypes,
    layouts,
    location,
    priceMin,
    priceMax,
    areaMin,
    areaMax,
    conditions,
    ownership,
    furnishing,
    buildingTypes,
    outdoorAmenities,
    indoorAmenities,
    accessibility,
    energyClasses,
    router,
  ]);

  // --- render ---------------------------------------------------------
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      className="space-y-8"
    >
      {/* 1. Property Type */}
      <FilterSection title="Typ nemovitosti">
        <div className="flex flex-wrap gap-2">
          {PROPERTY_TYPES.map(({ value, label, icon }) => (
            <PillToggle
              key={value}
              label={label}
              icon={icon}
              selected={propertyTypes.includes(value)}
              onClick={() => setPropertyTypes((s) => toggle(s, value))}
            />
          ))}
        </div>
      </FilterSection>

      {/* 2. Transaction Type */}
      <FilterSection title="Typ nabídky">
        <div className="flex flex-wrap gap-2">
          {TRANSACTION_TYPES.map(({ value, label }) => (
            <PillToggle
              key={value}
              label={label}
              selected={transactionTypes.includes(value)}
              onClick={() => setTransactionTypes((s) => toggle(s, value))}
            />
          ))}
        </div>
      </FilterSection>

      {/* 3. Layout / Disposition */}
      <FilterSection title="Dispozice">
        <div className="flex flex-wrap gap-2">
          {LAYOUTS.map((layout) => (
            <PillToggle
              key={layout}
              label={layout}
              selected={layouts.includes(layout)}
              onClick={() => setLayouts((s) => toggle(s, layout))}
            />
          ))}
        </div>
      </FilterSection>

      {/* 4. Location */}
      <FilterSection title="Lokalita">
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#626D82]" />
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Zadejte adresu nebo lokalitu..."
            className="w-full rounded-full border border-[#E0E0E0] bg-white py-2.5 pl-10 pr-4 text-sm text-[#232B3A] outline-none transition-colors placeholder:text-[#626D82] focus:border-[#CC0000]"
          />
        </div>
      </FilterSection>

      {/* 5. Price */}
      <PillRangeInput
        label="Cena"
        minValue={priceMin}
        maxValue={priceMax}
        onMinChange={setPriceMin}
        onMaxChange={setPriceMax}
        unit="Kč"
      />

      {/* 6. Area */}
      <PillRangeInput
        label="Plocha"
        minValue={areaMin}
        maxValue={areaMax}
        onMinChange={setAreaMin}
        onMaxChange={setAreaMax}
        unit="m²"
      />

      {/* 7. Building Condition */}
      <FilterSection title="Stav objektu">
        <div className="flex flex-wrap gap-2">
          {BUILDING_CONDITIONS.map(({ value, label }) => (
            <PillToggle
              key={value}
              label={label}
              selected={conditions.includes(value)}
              onClick={() => setConditions((s) => toggle(s, value))}
            />
          ))}
        </div>
      </FilterSection>

      {/* 8. Ownership */}
      <FilterSection title="Vlastnictví">
        <div className="flex flex-wrap gap-2">
          {OWNERSHIP_TYPES.map(({ value, label }) => (
            <PillToggle
              key={value}
              label={label}
              selected={ownership.includes(value)}
              onClick={() => setOwnership((s) => toggle(s, value))}
            />
          ))}
        </div>
      </FilterSection>

      {/* 9. Furnishing */}
      <FilterSection title="Vybavení">
        <div className="flex flex-wrap gap-2">
          {FURNISHING_OPTIONS.map(({ value, label }) => (
            <PillToggle
              key={value}
              label={label}
              selected={furnishing.includes(value)}
              onClick={() => setFurnishing((s) => toggle(s, value))}
            />
          ))}
        </div>
      </FilterSection>

      {/* 10. Building Type */}
      <FilterSection title="Stavba">
        <div className="flex flex-wrap gap-2">
          {BUILDING_TYPES.map(({ value, label }) => (
            <PillToggle
              key={value}
              label={label}
              selected={buildingTypes.includes(value)}
              onClick={() => setBuildingTypes((s) => toggle(s, value))}
            />
          ))}
        </div>
      </FilterSection>

      {/* 11. Outdoor Amenities */}
      <FilterSection title="Doplňky - Venkovní">
        <div className="flex flex-wrap gap-2">
          {OUTDOOR_AMENITIES.map(({ value, label }) => (
            <PillToggle
              key={value}
              label={label}
              selected={outdoorAmenities.includes(value)}
              onClick={() => setOutdoorAmenities((s) => toggle(s, value))}
            />
          ))}
        </div>
      </FilterSection>

      {/* 12. Indoor Amenities */}
      <FilterSection title="Doplňky - Vnitřní">
        <div className="flex flex-wrap gap-2">
          {INDOOR_AMENITIES.map(({ value, label }) => (
            <PillToggle
              key={value}
              label={label}
              selected={indoorAmenities.includes(value)}
              onClick={() => setIndoorAmenities((s) => toggle(s, value))}
            />
          ))}
        </div>
      </FilterSection>

      {/* 13. Accessibility */}
      <FilterSection title="Přístupnost">
        <div className="flex flex-wrap gap-2">
          {ACCESSIBILITY_OPTIONS.map(({ value, label }) => (
            <PillToggle
              key={value}
              label={label}
              selected={accessibility.includes(value)}
              onClick={() => setAccessibility((s) => toggle(s, value))}
            />
          ))}
        </div>
      </FilterSection>

      {/* 14. Energy Class */}
      <FilterSection title="Energetická třída">
        <div className="flex flex-wrap gap-2">
          {ENERGY_CLASSES.map(({ value, label, color }) => (
            <button
              key={value}
              type="button"
              onClick={() => setEnergyClasses((s) => toggle(s, value))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all"
              style={
                energyClasses.includes(value)
                  ? {
                      backgroundColor: color,
                      color: "#FFFFFF",
                      boxShadow: `0 0 0 2px ${color}`,
                    }
                  : {
                      backgroundColor: "#F8F8F8",
                      color,
                    }
              }
            >
              {label}
            </button>
          ))}
        </div>
      </FilterSection>

      {/* Submit */}
      <div className="pt-4">
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#CC0000] px-8 py-3.5 text-base font-semibold text-white transition-colors hover:bg-[#AE0000] active:bg-[#8B0000] sm:mx-auto sm:w-auto sm:min-w-[280px]"
        >
          <Search className="h-5 w-5" />
          Zobrazit výsledky
        </button>
      </div>
    </form>
  );
}
