"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface TransactionToggleProps {
  value: string;
  onChange: (value: string) => void;
}

export function TransactionToggle({ value, onChange }: TransactionToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => onChange(v || "")}
      className="w-full"
      data-testid="filter-transaction-type"
    >
      <ToggleGroupItem value="rent" className="flex-1 text-xs" data-testid="filter-transaction-rent">
        Pronájem
      </ToggleGroupItem>
      <ToggleGroupItem value="sale" className="flex-1 text-xs" data-testid="filter-transaction-sale">
        Prodej
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
