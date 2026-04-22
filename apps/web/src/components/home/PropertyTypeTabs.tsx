"use client";

import Link from "next/link";
import { useStats } from "@/hooks/useStats";
import { cn } from "@/lib/cn";
import { useState } from "react";

const PROPERTY_TYPES = [
  { key: "flat", label: "Byty" },
  { key: "house", label: "Domy" },
  { key: "land", label: "Pozemky" },
  { key: "commercial", label: "Komerční" },
  { key: "other", label: "Ostatní" },
] as const;

export function PropertyTypeTabs() {
  const { data } = useStats();
  const byType = data?.by_type ?? {};
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  return (
    <nav
      className="w-full overflow-x-auto scrollbar-none"
      aria-label="Typ nemovitosti"
      data-testid="property-type-tabs"
    >
      <div className="flex items-center justify-center gap-1 min-w-max">
        {PROPERTY_TYPES.map((type) => {
          const count = byType[type.key] ?? 0;

          return (
            <Link
              key={type.key}
              href={`/search?property_type=${type.key}`}
              className={cn(
                "relative flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                hoveredTab === type.key
                  ? "bg-primary/8 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`property-tab-${type.key}`}
              onMouseEnter={() => setHoveredTab(type.key)}
              onMouseLeave={() => setHoveredTab(null)}
            >
              <span>{type.label}</span>
              {count > 0 && (
                <span
                  className="text-xs tabular-nums opacity-60"
                  data-testid={`property-tab-count-${type.key}`}
                >
                  {count.toLocaleString("cs-CZ")}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
