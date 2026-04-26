"use client";

import { useStats } from "@/hooks/useStats";
import { cn } from "@/lib/cn";

const PROPERTY_TYPES = [
  { key: "flat", label: "Byty" },
  { key: "house", label: "Domy" },
  { key: "land", label: "Pozemky" },
  { key: "commercial", label: "Komerční" },
] as const;

interface PropertyTypeTabsProps {
  selected: string[];
  onToggle: (key: string) => void;
}

export function PropertyTypeTabs({ selected, onToggle }: PropertyTypeTabsProps) {
  const { data } = useStats();
  const byType = data?.by_type ?? {};

  return (
    <nav
      className="w-full overflow-x-auto scrollbar-none"
      aria-label="Typ nemovitosti"
      data-testid="property-type-tabs"
    >
      <div
        className="flex items-center justify-center gap-1.5 min-w-max"
        role="group"
        aria-label="Vyberte typ nemovitosti"
      >
        {PROPERTY_TYPES.map((type) => {
          const count = byType[type.key] ?? 0;
          const isActive = selected.includes(type.key);

          return (
            <button
              key={type.key}
              type="button"
              role="checkbox"
              aria-checked={isActive}
              onClick={() => onToggle(type.key)}
              className={cn(
                "group relative inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium",
                "transition-[background-color,color,box-shadow] duration-200 ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isActive
                  ? "bg-primary/8 text-foreground ring-2 ring-inset ring-foreground"
                  : "text-muted-foreground hover:bg-primary/8 hover:text-foreground"
              )}
              data-testid={`property-tab-${type.key}`}
              data-active={isActive}
            >
              <span>{type.label}</span>
              {count > 0 && (
                <span
                  className={cn(
                    "text-xs tabular-nums transition-opacity",
                    isActive ? "opacity-80" : "opacity-60"
                  )}
                  data-testid={`property-tab-count-${type.key}`}
                >
                  {count.toLocaleString("cs-CZ")}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
