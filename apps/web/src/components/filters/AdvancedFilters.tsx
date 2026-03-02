"use client";

import { useFilterStore } from "@/store/filter-store";
import { useCallback } from "react";

interface CheckboxGroupProps {
  label: string;
  filterKey: "condition" | "construction" | "ownership" | "amenities" | "source";
  options: { value: string; label: string }[];
}

function CheckboxGroup({ label, filterKey, options }: CheckboxGroupProps) {
  const value = useFilterStore((s) => s.filters[filterKey]);
  const setFilter = useFilterStore((s) => s.setFilter);

  const activeValues = value ? value.split(",") : [];

  const toggle = useCallback(
    (val: string) => {
      const current = value ? value.split(",").filter(Boolean) : [];
      const idx = current.indexOf(val);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(val);
      }
      setFilter(filterKey, current.join(","));
    },
    [value, filterKey, setFilter]
  );

  return (
    <div className="filter-group">
      <label className="filter-label">{label}</label>
      <div className="checkbox-grid">
        {options.map((opt) => (
          <label key={opt.value} className="checkbox-item">
            <input
              type="checkbox"
              checked={activeValues.includes(opt.value)}
              onChange={() => toggle(opt.value)}
              value={opt.value}
            />
            <span className={filterKey === "source" ? `source-label ${opt.value}` : undefined}>
              {opt.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

interface MultiToggleGroupProps {
  label: string;
  filterKey: "energy_rating";
  options: { value: string; label: string }[];
  compact?: boolean;
}

function MultiToggleGroup({
  label,
  filterKey,
  options,
  compact,
}: MultiToggleGroupProps) {
  const value = useFilterStore((s) => s.filters[filterKey]);
  const setFilter = useFilterStore((s) => s.setFilter);

  const activeValues = value ? value.split(",") : [];

  const toggle = useCallback(
    (val: string) => {
      const current = value ? value.split(",").filter(Boolean) : [];
      const idx = current.indexOf(val);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(val);
      }
      setFilter(filterKey, current.join(","));
    },
    [value, filterKey, setFilter]
  );

  return (
    <div className="filter-group">
      <label className="filter-label">{label}</label>
      <div className={`btn-group multi${compact ? " compact" : ""}`}>
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`btn-toggle${activeValues.includes(opt.value) ? " active" : ""}`}
            onClick={() => toggle(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FurnishingFilter() {
  const furnishing = useFilterStore((s) => s.filters.furnishing);
  const setFilter = useFilterStore((s) => s.setFilter);

  const options = [
    { value: "furnished", label: "Za\u0159\u00edzen\u00e9 (Furnished)" },
    { value: "partially", label: "\u010c\u00e1ste\u010dn\u011b (Partial)" },
    { value: "unfurnished", label: "Neza\u0159\u00edzen\u00e9 (Unfurnished)" },
  ];

  return (
    <div className="filter-group">
      <label className="filter-label">Vybavenost (Furnishing)</label>
      <div className="btn-group">
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`btn-toggle${furnishing === opt.value ? " active" : ""}`}
            onClick={() =>
              setFilter(
                "furnishing",
                furnishing === opt.value ? "" : opt.value
              )
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AdvancedFilters() {
  return (
    <details className="advanced-filters">
      <summary className="advanced-toggle">
        <span>Další filtry (More Filters)</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>

      <CheckboxGroup
        label="Stav (Condition)"
        filterKey="condition"
        options={[
          { value: "new_build", label: "Novostavba (New)" },
          { value: "very_good", label: "Velmi dobr\u00fd (Very good)" },
          { value: "good", label: "Dobr\u00fd (Good)" },
          { value: "after_renovation", label: "Po rekonstrukci (Renovated)" },
          {
            value: "before_renovation",
            label: "P\u0159ed rekonstrukc\u00ed (Before reno)",
          },
          {
            value: "under_construction",
            label: "Ve v\u00fdstavb\u011b (Under construction)",
          },
        ]}
      />

      <CheckboxGroup
        label="Konstrukce (Construction)"
        filterKey="construction"
        options={[
          { value: "brick", label: "Cihlov\u00e1 (Brick)" },
          { value: "panel", label: "Panelov\u00e1 (Panel)" },
          { value: "wooden", label: "D\u0159ev\u011bn\u00e1 (Wood)" },
          { value: "mixed", label: "Sm\u00ed\u0161en\u00e1 (Mixed)" },
          { value: "prefab", label: "Montovan\u00e1 (Prefab)" },
        ]}
      />

      <CheckboxGroup
        label="Vlastnictv\u00ed (Ownership)"
        filterKey="ownership"
        options={[
          { value: "private", label: "Osobn\u00ed (Private)" },
          { value: "cooperative", label: "Dru\u017estevn\u00ed (Cooperative)" },
          { value: "municipal", label: "Obecn\u00ed (Municipal)" },
        ]}
      />

      <FurnishingFilter />

      <MultiToggleGroup
        label="PENB (Energy Rating)"
        filterKey="energy_rating"
        options={["A", "B", "C", "D", "E", "F", "G"].map((v) => ({
          value: v,
          label: v,
        }))}
        compact
      />

      <CheckboxGroup
        label="Vybaven\u00ed (Amenities)"
        filterKey="amenities"
        options={[
          { value: "balcony", label: "Balk\u00f3n (Balcony)" },
          { value: "terrace", label: "Terasa (Terrace)" },
          { value: "loggia", label: "Lod\u017eie (Loggia)" },
          { value: "cellar", label: "Sklep (Cellar)" },
          { value: "elevator", label: "V\u00fdtah (Elevator)" },
          { value: "garage", label: "Gar\u00e1\u017e (Garage)" },
          { value: "parking", label: "Parkov\u00e1n\u00ed (Parking)" },
          { value: "garden", label: "Zahrada (Garden)" },
        ]}
      />

      <CheckboxGroup
        label="Zdroj (Source)"
        filterKey="source"
        options={[
          { value: "sreality", label: "sreality.cz" },
          { value: "bezrealitky", label: "bezrealitky.cz" },
          { value: "ulovdomov", label: "ulovdomov.cz" },
        ]}
      />
    </details>
  );
}
