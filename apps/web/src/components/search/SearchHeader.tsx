"use client";

import { List, Map, LayoutGrid } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SortSelect } from "@/components/filters/SortSelect";
import { FilterSheet } from "./FilterSheet";
import { cn } from "@/lib/cn";

interface SearchHeaderProps {
  total: number;
  view: string;
  onViewChange: (v: string) => void;
  sort: string;
  onSortChange: (v: string) => void;
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
}

const quickFilters = [
  { label: "Vše", value: "" },
  { label: "Byty", value: "flat" },
  { label: "Domy", value: "house" },
];

export function SearchHeader({
  total,
  view,
  onViewChange,
  sort,
  onSortChange,
  filters,
  setFilter,
}: SearchHeaderProps) {
  const activePropertyType = filters.property_type || "";

  return (
    <div className="sticky top-16 z-30 border-b border-divider bg-background/95 backdrop-blur-md" data-testid="search-header">
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* Quick filter chips */}
          <div className="hidden items-center gap-1.5 sm:flex" data-testid="quick-filters">
            {quickFilters.map(({ label, value }) => (
              <button
                key={label}
                onClick={() => setFilter("property_type", value)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                  activePropertyType === value
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                )}
                data-testid={`quick-filter-${value || "all"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="text-sm text-muted-foreground" data-testid="search-results-count">
            <strong className="text-foreground">
              {total.toLocaleString("cs-CZ")}
            </strong>{" "}
            nabídek
          </span>

          <FilterSheet filters={filters} setFilter={setFilter} />
        </div>

        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && onViewChange(v)}
            className="hidden sm:flex"
            data-testid="view-toggle"
          >
            <ToggleGroupItem value="list" size="sm" data-testid="view-toggle-list">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="hybrid" size="sm" data-testid="view-toggle-hybrid">
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="map" size="sm" data-testid="view-toggle-map">
              <Map className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>

          <SortSelect value={sort} onChange={onSortChange} />
        </div>
      </div>
    </div>
  );
}
