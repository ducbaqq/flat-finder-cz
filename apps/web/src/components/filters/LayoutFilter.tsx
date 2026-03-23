"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface LayoutFilterProps {
  value: string;
  onChange: (value: string) => void;
}

const layouts = [
  "1+kk", "1+1", "2+kk", "2+1", "3+kk", "3+1",
  "4+kk", "4+1", "5+kk", "5+1", "6+",
];

export function LayoutFilter({ value, onChange }: LayoutFilterProps) {
  const selected = value ? value.split(",") : [];

  return (
    <ToggleGroup
      type="multiple"
      value={selected}
      onValueChange={(values) => onChange(values.join(","))}
      className="flex flex-wrap gap-1"
      data-testid="filter-layout"
    >
      {layouts.map((l) => (
        <ToggleGroupItem key={l} value={l} className="text-xs" size="sm" data-testid={`filter-layout-${l}`}>
          {l}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
