"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
}

export function LocationAutocomplete({
  value,
  onChange,
}: LocationAutocompleteProps) {
  const [draft, setDraft] = useState(value);

  // Sync draft when the external value changes (e.g. filter chip removed)
  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <Input
      placeholder="Město nebo lokalita..."
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onChange(draft.trim());
        }
      }}
      onBlur={() => {
        if (draft.trim() !== value) {
          onChange(draft.trim());
        }
      }}
      className="w-full"
      data-testid="filter-location"
    />
  );
}
