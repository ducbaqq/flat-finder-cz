"use client";

import Link from "next/link";
import { motion } from "framer-motion";
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

const tabVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.07,
      duration: 0.35,
      ease: [0, 0, 0.58, 1] as const,
    },
  }),
};

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
        {PROPERTY_TYPES.map((type, i) => {
          const count = byType[type.key] ?? 0;

          return (
            <motion.div
              key={type.key}
              custom={i}
              variants={tabVariants}
              initial="hidden"
              animate="visible"
            >
              <Link
                href={`/filter?property_type=${type.key}`}
                className={cn(
                  "group relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors",
                  "text-muted-foreground hover:text-foreground"
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
                      "bg-muted text-muted-foreground",
                      hoveredTab === type.key &&
                        "bg-primary/10 text-primary"
                    )}
                    data-testid={`property-tab-count-${type.key}`}
                  >
                    {count.toLocaleString("cs-CZ")}
                  </span>
                )}

                {/* Underline indicator on hover */}
                <span
                  className={cn(
                    "absolute bottom-0 left-3 right-3 h-0.5 rounded-full transition-all duration-200",
                    hoveredTab === type.key
                      ? "bg-primary scale-x-100"
                      : "bg-transparent scale-x-0"
                  )}
                  aria-hidden="true"
                />
              </Link>
            </motion.div>
          );
        })}
      </div>
    </nav>
  );
}
