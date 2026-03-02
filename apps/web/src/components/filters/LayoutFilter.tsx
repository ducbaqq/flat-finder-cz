"use client";

import { useFilterStore } from "@/store/filter-store";
import { useCallback } from "react";

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
];

export default function LayoutFilter() {
  const layout = useFilterStore((s) => s.filters.layout);
  const setFilter = useFilterStore((s) => s.setFilter);

  const activeValues = layout ? layout.split(",") : [];

  const toggle = useCallback(
    (value: string) => {
      const current = layout ? layout.split(",").filter(Boolean) : [];
      const idx = current.indexOf(value);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(value);
      }
      setFilter("layout", current.join(","));
    },
    [layout, setFilter]
  );

  return (
    <div className="filter-group">
      <label className="filter-label">Dispozice (Layout)</label>
      <div className="btn-group multi compact">
        {LAYOUTS.map((l) => (
          <button
            key={l}
            className={`btn-toggle${activeValues.includes(l) ? " active" : ""}`}
            onClick={() => toggle(l)}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
