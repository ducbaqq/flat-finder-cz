"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { layoutOptions } from "@/lib/utils";

interface LayoutFilterProps {
  value: string;
  onChange: (value: string) => void;
}

export function LayoutFilter({ value, onChange }: LayoutFilterProps) {
  const selected = new Set(value ? value.split(",").filter(Boolean) : []);
  const activeLabels = layoutOptions
    .filter((opt) => opt.values.every((v) => selected.has(v)))
    .map((opt) => opt.label);

  const labelToValues = new Map(layoutOptions.map((opt) => [opt.label, opt.values]));

  const handleChange = (newLabels: string[]) => {
    const next = new Set<string>();
    for (const label of newLabels) {
      const vals = labelToValues.get(label);
      if (vals) for (const v of vals) next.add(v);
    }
    onChange([...next].join(","));
  };

  return (
    <ToggleGroup
      type="multiple"
      value={activeLabels}
      onValueChange={handleChange}
      className="flex flex-wrap gap-1"
      data-testid="filter-layout"
    >
      {layoutOptions.map((opt) => (
        <ToggleGroupItem
          key={opt.label}
          value={opt.label}
          className="text-xs"
          size="sm"
          data-testid={`filter-layout-${opt.label}`}
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
