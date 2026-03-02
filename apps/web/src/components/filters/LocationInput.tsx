"use client";

import { useFilterStore } from "@/store/filter-store";
import { useDebounce } from "@/hooks/useDebounce";
import { useState, useEffect } from "react";

export default function LocationInput() {
  const location = useFilterStore((s) => s.filters.location);
  const setFilter = useFilterStore((s) => s.setFilter);
  const [localValue, setLocalValue] = useState(location);
  const debouncedValue = useDebounce(localValue, 300);

  useEffect(() => {
    if (debouncedValue !== location) {
      setFilter("location", debouncedValue);
    }
  }, [debouncedValue, location, setFilter]);

  useEffect(() => {
    setLocalValue(location);
  }, [location]);

  return (
    <div className="filter-group">
      <label className="filter-label">Lokalita (Location)</label>
      <div className="input-wrapper">
        <svg
          className="input-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="filter-input"
          placeholder="Praha, Brno, Ostrava..."
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
        />
      </div>
    </div>
  );
}
