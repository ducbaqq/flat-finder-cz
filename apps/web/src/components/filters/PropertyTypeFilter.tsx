"use client";

import { useFilterStore } from "@/store/filter-store";
import { useCallback } from "react";

const OPTIONS = [
  { value: "flat", label: "Byt (Flat)" },
  { value: "house", label: "D\u016fm (House)" },
  { value: "commercial", label: "Komer\u010dn\u00ed (Commercial)" },
  { value: "garage", label: "Gar\u00e1\u017e (Garage)" },
  { value: "residential_building", label: "\u010cin\u017eovn\u00ed d\u016fm" },
  { value: "land", label: "Pozemek (Land)" },
  { value: "cottage", label: "Chata (Cottage)" },
];

export default function PropertyTypeFilter() {
  const propertyType = useFilterStore((s) => s.filters.property_type);
  const setFilter = useFilterStore((s) => s.setFilter);

  const activeValues = propertyType ? propertyType.split(",") : [];

  const toggle = useCallback(
    (value: string) => {
      const current = propertyType ? propertyType.split(",").filter(Boolean) : [];
      const idx = current.indexOf(value);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(value);
      }
      setFilter("property_type", current.join(","));
    },
    [propertyType, setFilter]
  );

  return (
    <div className="filter-group">
      <label className="filter-label">Typ nemovitosti (Property)</label>
      <div className="btn-group multi">
        {OPTIONS.map((opt) => (
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
