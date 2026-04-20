"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Search,
  Building2,
  Home,
  TreePine,
  Landmark,
  Package,
} from "lucide-react";
import { PillToggle } from "./PillToggle";
import { PillRangeInput } from "./PillRangeInput";
import { FilterSection } from "./FilterSection";
import { LocationAutocomplete } from "@/components/filters/LocationAutocomplete";
import { saveSearchPreferences } from "@/hooks/useSearchPreferences";
import { useUiStore } from "@/store/ui-store";

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
  { value: "new", label: "Novostavba" },
  { value: "very_good", label: "Velmi dobrý" },
  { value: "good", label: "Dobrý" },
  { value: "after_reconstruction", label: "Po rekonstrukci" },
  { value: "before_reconstruction", label: "Před rekonstrukcí" },
  { value: "under_construction", label: "Ve výstavbě" },
  { value: "project", label: "Projekt" },
  { value: "poor", label: "Špatný" },
  { value: "demolition", label: "K demolici" },
] as const;

const OWNERSHIP_TYPES = [
  { value: "personal", label: "Osobní" },
  { value: "cooperative", label: "Družstevní" },
  { value: "state", label: "Státní / Obecní" },
  { value: "other", label: "Ostatní" },
] as const;

const FURNISHING_OPTIONS = [
  { value: "furnished", label: "Zařízené" },
  { value: "unfurnished", label: "Nezařízené" },
  { value: "partially", label: "Částečně" },
] as const;

const BUILDING_TYPES = [
  { value: "brick", label: "Cihlová" },
  { value: "panel", label: "Panelová" },
  { value: "mixed", label: "Smíšená" },
  { value: "skeleton", label: "Skeletová" },
  { value: "wood", label: "Dřevěná" },
  { value: "prefab", label: "Montovaná" },
  { value: "stone", label: "Kamenná" },
  { value: "modular", label: "Modulární" },
  { value: "other", label: "Ostatní" },
] as const;

const AMENITIES = [
  { value: "balcony", label: "Balkón" },
  { value: "loggia", label: "Lodžie" },
  { value: "terrace", label: "Terasa" },
  { value: "garden", label: "Zahrada" },
  { value: "cellar", label: "Sklep" },
  { value: "parking", label: "Parkování" },
  { value: "garage", label: "Garáž" },
  { value: "elevator", label: "Výtah" },
  { value: "barrier_free", label: "Bezbariérový" },
  { value: "pool", label: "Bazén" },
  { value: "air_conditioning", label: "Klimatizace" },
  { value: "dishwasher", label: "Myčka" },
  { value: "washing_machine", label: "Pračka" },
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

const SOURCES = [
  { value: "sreality", label: "sreality.cz" },
  { value: "bezrealitky", label: "bezrealitky.cz" },
  { value: "ulovdomov", label: "ulovdomov.cz" },
  { value: "bazos", label: "bazos.cz" },
  { value: "idnes", label: "idnes.cz" },
  { value: "ceskereality", label: "ceskereality.cz" },
  { value: "realitymix", label: "realitymix.cz" },
  { value: "ereality", label: "ereality.cz" },
  { value: "eurobydleni", label: "eurobydleni.cz" },
  { value: "realingo", label: "realingo.cz" },
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
/*  Animation variants                                                 */
/* ------------------------------------------------------------------ */

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.04,
      duration: 0.4,
      ease: [0, 0, 0.58, 1] as const,
    },
  }),
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function FilterPageForm({
  initialPropertyType,
  initialTransactionType,
}: FilterPageFormProps) {
  const router = useRouter();
  const pendingBbox = useUiStore((s) => s.pendingBbox);

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
  const [amenities, setAmenities] = useState<string[]>([]);
  const [energyClasses, setEnergyClasses] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);

  // --- handlers -------------------------------------------------------
  const handleSubmit = useCallback(() => {
    const params = new URLSearchParams();

    if (propertyTypes.length)
      params.set("property_type", propertyTypes.join(","));
    if (transactionTypes.length)
      params.set("transaction_type", transactionTypes.join(","));
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
    if (amenities.length)
      params.set("amenities", amenities.join(","));
    if (energyClasses.length)
      params.set("energy_rating", energyClasses.join(","));
    if (sources.length) params.set("source", sources.join(","));

    saveSearchPreferences({
      property_type: propertyTypes.length ? propertyTypes.join(",") : undefined,
      transaction_type: transactionTypes.length ? transactionTypes.join(",") : undefined,
      location: location.trim() || undefined,
      bbox: pendingBbox ?? undefined,
    });

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
    buildingTypes,
    ownership,
    amenities,
    furnishing,
    energyClasses,
    sources,
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
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
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
      </motion.div>

      {/* 2. Transaction Type */}
      <motion.div custom={1} variants={sectionVariants} initial="hidden" animate="visible">
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
      </motion.div>

      {/* 3. Layout / Disposition */}
      <motion.div custom={2} variants={sectionVariants} initial="hidden" animate="visible">
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
      </motion.div>

      {/* 4. Location */}
      <motion.div custom={3} variants={sectionVariants} initial="hidden" animate="visible">
        <FilterSection title="Lokalita">
          <LocationAutocomplete
            value={location}
            onChange={setLocation}
          />
        </FilterSection>
      </motion.div>

      {/* 5. Price */}
      <motion.div custom={4} variants={sectionVariants} initial="hidden" animate="visible">
        <PillRangeInput
          label="Cena"
          minValue={priceMin}
          maxValue={priceMax}
          onMinChange={setPriceMin}
          onMaxChange={setPriceMax}
          unit="Kč"
        />
      </motion.div>

      {/* 6. Area */}
      <motion.div custom={5} variants={sectionVariants} initial="hidden" animate="visible">
        <PillRangeInput
          label="Plocha"
          minValue={areaMin}
          maxValue={areaMax}
          onMinChange={setAreaMin}
          onMaxChange={setAreaMax}
          unit="m²"
        />
      </motion.div>

      {/* 7. Stav */}
      <motion.div custom={6} variants={sectionVariants} initial="hidden" animate="visible">
        <FilterSection title="Stav">
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
      </motion.div>

      {/* 8. Konstrukce */}
      <motion.div custom={7} variants={sectionVariants} initial="hidden" animate="visible">
        <FilterSection title="Konstrukce">
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
      </motion.div>

      {/* 9. Vlastnictví */}
      <motion.div custom={8} variants={sectionVariants} initial="hidden" animate="visible">
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
      </motion.div>

      {/* 10. Vybavenost (amenities) */}
      <motion.div custom={9} variants={sectionVariants} initial="hidden" animate="visible">
        <FilterSection title="Vybavení">
          <div className="flex flex-wrap gap-2">
            {AMENITIES.map(({ value, label }) => (
              <PillToggle
                key={value}
                label={label}
                selected={amenities.includes(value)}
                onClick={() => setAmenities((s) => toggle(s, value))}
              />
            ))}
          </div>
        </FilterSection>
      </motion.div>

      {/* 11. Vybavení (furnishing) */}
      <motion.div custom={10} variants={sectionVariants} initial="hidden" animate="visible">
        <FilterSection title="Vybavenost">
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
      </motion.div>

      {/* 12. PENB */}
      <motion.div custom={11} variants={sectionVariants} initial="hidden" animate="visible">
        <FilterSection title="Energetická třída (PENB)">
          <div className="flex flex-wrap gap-2">
            {ENERGY_CLASSES.map(({ value, label, color }) => (
              <button
                key={value}
                type="button"
                onClick={() => setEnergyClasses((s) => toggle(s, value))}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition-all duration-200"
                style={
                  energyClasses.includes(value)
                    ? {
                        backgroundColor: color,
                        color: "#FFFFFF",
                        boxShadow: `0 0 0 2px ${color}, 0 2px 8px ${color}40`,
                      }
                    : {
                        backgroundColor: "hsl(var(--muted))",
                        color,
                      }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </FilterSection>
      </motion.div>

      {/* 13. Zdroj inzerátu */}
      <motion.div custom={12} variants={sectionVariants} initial="hidden" animate="visible">
        <FilterSection title="Zdroj inzerátu">
          <div className="flex flex-wrap gap-2">
            {SOURCES.map(({ value, label }) => (
              <PillToggle
                key={value}
                label={label}
                selected={sources.includes(value)}
                onClick={() => setSources((s) => toggle(s, value))}
              />
            ))}
          </div>
        </FilterSection>
      </motion.div>

      {/* Submit */}
      <motion.div
        className="pt-4"
        custom={13}
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
      >
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-terracotta px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-terracotta/25 transition-all duration-200 hover:bg-terracotta/90 hover:shadow-xl hover:shadow-terracotta/30 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md sm:mx-auto sm:w-auto sm:min-w-[280px]"
        >
          <Search className="h-5 w-5" />
          Zobrazit výsledky
        </button>
      </motion.div>
    </form>
  );
}
