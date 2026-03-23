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
      <div className="flex items-center justify-center gap-1 min-w-max px-2">
        {PROPERTY_TYPES.map((type) => {
          const count = byType[type.key] ?? 0;

          return (
            <Link
              key={type.key}
              href={`/filter?property_type=${type.key}`}
              className={cn(
                "group relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors",
                "text-[#626D82] hover:text-[#232B3A]"
              )}
              data-testid={`property-tab-${type.key}`}
              onMouseEnter={() => setHoveredTab(type.key)}
              onMouseLeave={() => setHoveredTab(null)}
            >
              <span className="whitespace-nowrap">{type.label}</span>
              {count > 0 && (
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                    "bg-gray-100 text-[#626D82]",
                    hoveredTab === type.key && "bg-red-50 text-[#CC0000]"
                  )}
                  data-testid={`property-tab-count-${type.key}`}
                >
                  {count.toLocaleString("cs-CZ")}
                </span>
              )}

              {/* Underline indicator on hover */}
              <span
                className={cn(
                  "absolute bottom-0 left-3 right-3 h-0.5 rounded-full transition-colors",
                  hoveredTab === type.key ? "bg-[#CC0000]" : "bg-transparent"
                )}
                aria-hidden="true"
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
