"use client";

import { useFilterStore } from "@/store/filter-store";

const OPTIONS = [
  { value: "newest", label: "Nejnov\u011bj\u0161\u00ed (Newest)" },
  { value: "price_asc", label: "Cena \u2191 (Price low\u2192high)" },
  { value: "price_desc", label: "Cena \u2193 (Price high\u2192low)" },
  { value: "size_asc", label: "Plocha \u2191 (Size small\u2192large)" },
  { value: "size_desc", label: "Plocha \u2193 (Size large\u2192small)" },
];

export default function SortSelect() {
  const sort = useFilterStore((s) => s.filters.sort);
  const setFilter = useFilterStore((s) => s.setFilter);

  return (
    <div className="filter-group">
      <label className="filter-label">\u0158adit (Sort by)</label>
      <select
        className="filter-select"
        value={sort}
        onChange={(e) => setFilter("sort", e.target.value)}
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
