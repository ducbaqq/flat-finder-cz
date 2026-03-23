"use client";

import { Home, Building2, TreePine, Landmark, Car } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { LucideIcon } from "lucide-react";

interface PropertyTypeFilterProps {
  value: string;
  onChange: (value: string) => void;
}

const types: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "flat", label: "Byt", icon: Building2 },
  { value: "house", label: "Dům", icon: Home },
  { value: "land", label: "Pozemek", icon: TreePine },
  { value: "commercial", label: "Komerční", icon: Landmark },
  { value: "cottage", label: "Chata", icon: Home },
  { value: "garage", label: "Garáž", icon: Car },
];

export function PropertyTypeFilter({ value, onChange }: PropertyTypeFilterProps) {
  const selected = value ? value.split(",") : [];

  return (
    <ToggleGroup
      type="multiple"
      value={selected}
      onValueChange={(values) => onChange(values.join(","))}
      className="flex flex-wrap gap-1"
      data-testid="filter-property-type"
    >
      {types.map(({ value: v, label, icon: Icon }) => (
        <ToggleGroupItem
          key={v}
          value={v}
          className="flex items-center gap-1 text-xs"
          size="sm"
          data-testid={`filter-property-type-${v}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
