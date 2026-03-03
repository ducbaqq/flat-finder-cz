"use client";

import { Input } from "@/components/ui/input";

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
}

export function LocationAutocomplete({
  value,
  onChange,
}: LocationAutocompleteProps) {
  return (
    <Input
      placeholder="Město nebo lokalita..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full"
    />
  );
}
