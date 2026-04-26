"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/cn";

interface TransactionToggleProps {
  value: string;
  onChange: (value: string) => void;
}

// Segmented track: the outer wrapper reads as the button surface, with an
// inner "pill" sliding to the active option. Resting items are muted but
// still sit on a visible control — so the whole thing is recognizable as a
// tappable control, not free-floating text.
const itemClass = cn(
  "flex-1 rounded-full px-3 text-xs font-medium tracking-[0.01em]",
  "h-8 min-w-0 border-0 bg-transparent",
  "text-muted-foreground transition-[color,background-color,box-shadow] duration-200 ease-out",
  "hover:bg-background/40 hover:text-foreground",
  "data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
  "data-[state=on]:shadow-[0_1px_2px_hsl(var(--foreground)/0.12),0_1px_0_hsl(var(--accent)/0.4)]",
  "data-[state=on]:hover:bg-accent data-[state=on]:hover:text-accent-foreground",
  "focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0",
);

export function TransactionToggle({ value, onChange }: TransactionToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => onChange(v || "")}
      spacing={2}
      className={cn(
        "w-full rounded-full p-0.5",
        "bg-secondary/70 ring-1 ring-inset ring-border/60",
        "shadow-[inset_0_1px_2px_hsl(var(--foreground)/0.04)]",
      )}
      data-testid="filter-transaction-type"
    >
      <ToggleGroupItem value="rent" className={itemClass} data-testid="filter-transaction-rent">
        Pronájem
      </ToggleGroupItem>
      <ToggleGroupItem value="sale" className={itemClass} data-testid="filter-transaction-sale">
        Prodej
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
