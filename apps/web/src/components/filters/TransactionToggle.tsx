"use client";

import { useFilterStore } from "@/store/filter-store";

const OPTIONS = [
  { value: "", label: "V\u0161e (All)" },
  { value: "rent", label: "Pron\u00e1jem (Rent)" },
  { value: "sale", label: "Prodej (Sale)" },
];

export default function TransactionToggle() {
  const transactionType = useFilterStore((s) => s.filters.transaction_type);
  const setFilter = useFilterStore((s) => s.setFilter);

  return (
    <div className="filter-group">
      <label className="filter-label">Typ nab\u00eddky (Transaction)</label>
      <div className="btn-group">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={`btn-toggle${transactionType === opt.value ? " active" : ""}`}
            onClick={() => setFilter("transaction_type", opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
