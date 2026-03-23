"use client";

import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getFilterSummaryTags } from "@/lib/utils";

interface ActiveFilterChipsProps {
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  clearFilters: () => void;
}

const filterKeyMap: Record<string, string> = {
  "Typ": "transaction_type",
  "Nemovitost": "property_type",
  "Lokalita": "location",
  "Cena": "",
  "Plocha": "",
  "Dispozice": "layout",
  "Stav": "condition",
  "Konstrukce": "construction",
  "Vlastnictví": "ownership",
  "Vybavenost": "furnishing",
  "PENB": "energy_rating",
  "Vybavení": "amenities",
  "Zdroj": "source",
};

export function ActiveFilterChips({
  filters,
  setFilter,
  clearFilters,
}: ActiveFilterChipsProps) {
  const tags = getFilterSummaryTags(filters);

  if (tags.length === 0) return null;

  const handleRemove = (label: string) => {
    const key = filterKeyMap[label];
    if (key) {
      setFilter(key, "");
    } else if (label === "Cena") {
      setFilter("price_min", "");
      setFilter("price_max", "");
    } else if (label === "Plocha") {
      setFilter("size_min", "");
      setFilter("size_max", "");
    }
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto px-4 py-2" data-testid="active-filter-chips">
      <AnimatePresence>
        {tags.map((tag) => (
          <motion.div
            key={tag.label}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
          >
            <Badge
              variant="secondary"
              className="flex shrink-0 items-center gap-1 text-xs"
              data-testid="active-filter-chip"
            >
              <span className="font-medium">{tag.label}:</span> {tag.value}
              <button
                onClick={() => handleRemove(tag.label)}
                className="ml-0.5 rounded-full hover:bg-muted"
                data-testid="active-filter-chip-remove"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </motion.div>
        ))}
      </AnimatePresence>
      <Button
        variant="ghost"
        size="sm"
        onClick={clearFilters}
        className="shrink-0 text-xs text-muted-foreground"
        data-testid="clear-all-filters"
      >
        Vymazat vše
      </Button>
    </div>
  );
}
