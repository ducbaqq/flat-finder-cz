"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface SourceFilterProps {
  value: string;
  onChange: (value: string) => void;
}

const sources = [
  { key: "sreality", label: "sreality.cz", color: "bg-sreality" },
  { key: "bezrealitky", label: "bezrealitky.cz", color: "bg-bezrealitky" },
  { key: "ulovdomov", label: "ulovdomov.cz", color: "bg-ulovdomov" },
  { key: "bazos", label: "bazos.cz", color: "bg-primary" },
  { key: "idnes", label: "idnes.cz", color: "bg-primary" },
  { key: "ceskereality", label: "ceskereality.cz", color: "bg-primary" },
  { key: "realitymix", label: "realitymix.cz", color: "bg-primary" },
  { key: "ereality", label: "ereality.cz", color: "bg-primary" },
  { key: "eurobydleni", label: "eurobydleni.cz", color: "bg-primary" },
  { key: "realingo", label: "realingo.cz", color: "bg-primary" },
];

export function SourceFilter({ value, onChange }: SourceFilterProps) {
  const selected = value ? value.split(",") : [];

  const toggle = (key: string) => {
    const next = selected.includes(key)
      ? selected.filter((s) => s !== key)
      : [...selected, key];
    onChange(next.join(","));
  };

  return (
    <div className="space-y-2">
      {sources.map(({ key, label, color }) => (
        <div key={key} className="flex items-center gap-2">
          <Checkbox
            id={`source-${key}`}
            checked={selected.includes(key)}
            onCheckedChange={() => toggle(key)}
          />
          <Label htmlFor={`source-${key}`} className="flex items-center gap-2 text-xs">
            <Badge className={`${color} text-[10px] text-white`}>{label}</Badge>
          </Label>
        </div>
      ))}
    </div>
  );
}
