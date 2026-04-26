"use client";

import { List, Map, LayoutGrid } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FilterSheet } from "./FilterSheet";

interface SearchHeaderProps {
  total: number;
  view: string;
  onViewChange: (v: string) => void;
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
}

export function SearchHeader({
  total,
  view,
  onViewChange,
  filters,
  setFilter,
}: SearchHeaderProps) {
  return (
    <div
      className="sticky top-14 z-30 border-b border-divider bg-background/80 backdrop-blur-xl"
      data-testid="search-header"
    >
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">
          <span
            className="text-sm text-muted-foreground"
            data-testid="search-results-count"
          >
            {total === 0 ? (
              "Žádné nabídky"
            ) : (
              <>
                <strong className="font-semibold text-foreground tabular-nums">
                  {total >= 10000 ? "10 000 a více" : total.toLocaleString("cs-CZ")}
                </strong>{" "}
                {total === 1 ? "nabídka" : total >= 5 ? "nabídek" : "nabídky"}
              </>
            )}
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
            <ToggleGroupItem
              value="list"
              size="sm"
              title="Seznam"
              data-testid="view-toggle-list"
            >
              <List className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="hybrid"
              size="sm"
              title="Seznam a mapa"
              data-testid="view-toggle-hybrid"
            >
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="map"
              size="sm"
              title="Mapa"
              data-testid="view-toggle-map"
            >
              <Map className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </div>
  );
}
