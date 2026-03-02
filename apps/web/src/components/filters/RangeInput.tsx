"use client";

import { useFilterStore, type FilterValues } from "@/store/filter-store";
import { useDebounce } from "@/hooks/useDebounce";
import { useState, useEffect } from "react";

interface RangeInputProps {
  label: string;
  minKey: keyof FilterValues;
  maxKey: keyof FilterValues;
  placeholderMin: string;
  placeholderMax: string;
}

export default function RangeInput({
  label,
  minKey,
  maxKey,
  placeholderMin,
  placeholderMax,
}: RangeInputProps) {
  const minValue = useFilterStore((s) => s.filters[minKey]);
  const maxValue = useFilterStore((s) => s.filters[maxKey]);
  const setFilter = useFilterStore((s) => s.setFilter);

  const [localMin, setLocalMin] = useState(minValue);
  const [localMax, setLocalMax] = useState(maxValue);

  const debouncedMin = useDebounce(localMin, 300);
  const debouncedMax = useDebounce(localMax, 300);

  useEffect(() => {
    if (debouncedMin !== minValue) {
      setFilter(minKey, debouncedMin);
    }
  }, [debouncedMin, minValue, minKey, setFilter]);

  useEffect(() => {
    if (debouncedMax !== maxValue) {
      setFilter(maxKey, debouncedMax);
    }
  }, [debouncedMax, maxValue, maxKey, setFilter]);

  useEffect(() => {
    setLocalMin(minValue);
  }, [minValue]);

  useEffect(() => {
    setLocalMax(maxValue);
  }, [maxValue]);

  return (
    <div className="filter-group">
      <label className="filter-label">{label}</label>
      <div className="range-inputs">
        <input
          type="number"
          className="filter-input"
          placeholder={placeholderMin}
          value={localMin}
          onChange={(e) => setLocalMin(e.target.value)}
        />
        <span className="range-separator">&mdash;</span>
        <input
          type="number"
          className="filter-input"
          placeholder={placeholderMax}
          value={localMax}
          onChange={(e) => setLocalMax(e.target.value)}
        />
      </div>
    </div>
  );
}
