"use client";

import { useFilterStore } from "@/store/filter-store";
import TransactionToggle from "@/components/filters/TransactionToggle";
import PropertyTypeFilter from "@/components/filters/PropertyTypeFilter";
import LocationInput from "@/components/filters/LocationInput";
import RangeInput from "@/components/filters/RangeInput";
import LayoutFilter from "@/components/filters/LayoutFilter";
import AdvancedFilters from "@/components/filters/AdvancedFilters";
import SortSelect from "@/components/filters/SortSelect";

export default function Sidebar() {
  const sidebarOpen = useFilterStore((s) => s.sidebarOpen);
  const closeSidebar = useFilterStore((s) => s.closeSidebar);
  const clearFilters = useFilterStore((s) => s.clearFilters);

  return (
    <>
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="sidebar-inner">
          <div className="sidebar-header">
            <h2 className="sidebar-title">Filtry (Filters)</h2>
            <button className="clear-filters-btn" onClick={clearFilters}>
              Vymazat (Clear)
            </button>
          </div>

          <TransactionToggle />
          <PropertyTypeFilter />
          <LocationInput />

          <RangeInput
            label="Cena (Price) \u2014 CZK"
            minKey="price_min"
            maxKey="price_max"
            placeholderMin="Od (From)"
            placeholderMax="Do (To)"
          />

          <RangeInput
            label="Plocha (Size) \u2014 m\u00b2"
            minKey="size_min"
            maxKey="size_max"
            placeholderMin="Od (From)"
            placeholderMax="Do (To)"
          />

          <LayoutFilter />
          <AdvancedFilters />
          <SortSelect />

          <button
            className="btn-search"
            onClick={closeSidebar}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Hledat (Search)
          </button>
        </div>
      </aside>
      <div
        className={`sidebar-overlay${sidebarOpen ? " active" : ""}`}
        onClick={closeSidebar}
      />
    </>
  );
}
