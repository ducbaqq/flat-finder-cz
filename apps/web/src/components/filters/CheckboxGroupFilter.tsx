"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface CheckboxGroupFilterProps {
  options: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
}

export function CheckboxGroupFilter({
  options,
  value,
  onChange,
}: CheckboxGroupFilterProps) {
  const selected = value ? value.split(",") : [];

  const toggle = (key: string) => {
    const next = selected.includes(key)
      ? selected.filter((s) => s !== key)
      : [...selected, key];
    onChange(next.join(","));
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(options).map(([key, label]) => (
        <div key={key} className="flex items-center gap-2">
          <Checkbox
            id={`filter-${key}`}
            checked={selected.includes(key)}
            onCheckedChange={() => toggle(key)}
          />
          <Label htmlFor={`filter-${key}`} className="text-xs">
            {label}
          </Label>
        </div>
      ))}
    </div>
  );
}
