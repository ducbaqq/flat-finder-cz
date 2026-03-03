"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SortSelectProps {
  value: string;
  onChange: (value: string) => void;
}

const sortOptions = [
  { value: "newest", label: "Nejnovější" },
  { value: "price_asc", label: "Cena ↑" },
  { value: "price_desc", label: "Cena ↓" },
  { value: "size_asc", label: "Plocha ↑" },
  { value: "size_desc", label: "Plocha ↓" },
];

export function SortSelect({ value, onChange }: SortSelectProps) {
  return (
    <Select value={value || "newest"} onValueChange={onChange}>
      <SelectTrigger className="w-[140px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sortOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
