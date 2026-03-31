"use client";

import { Suspense, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Navbar } from "@/components/shared/Navbar";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { SearchHeader } from "@/components/search/SearchHeader";
import { ActiveFilterChips } from "@/components/search/ActiveFilterChips";
import { FilterSidebar } from "@/components/search/FilterSidebar";
import { ListingResults } from "@/components/search/ListingResults";
import DetailModal from "@/components/detail/DetailModal";
import WatchdogModal from "@/components/watchdog/WatchdogModal";
import { useSearchFilters } from "@/hooks/useSearchFilters";
import { useListings } from "@/hooks/useListings";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";

const MapView = dynamic(
  () =>
    import("@/components/search/MapView").then((m) => ({ default: m.MapView })),
  { ssr: false, loading: () => <MapSkeleton /> }
);

function MapSkeleton() {
  return (
    <div className="flex h-full items-center justify-center bg-muted" data-testid="map-skeleton">
      <span className="text-sm text-muted-foreground">Načítání mapy...</span>
    </div>
  );
}

function SearchPageContent() {
  const { filters, page, setPage, view, setView, setFilter, clearFilters } =
    useSearchFilters();

  const showMap = view === "map" || view === "hybrid";
  const showList = view === "list" || view === "hybrid";

  // Reset to page 1 when map viewport changes
  const mapBounds = useUiStore((s) => s.mapBounds);
  const prevBoundsRef = useRef(mapBounds);
  useEffect(() => {
    if (showMap && mapBounds && prevBoundsRef.current && mapBounds !== prevBoundsRef.current) {
      setPage(1);
    }
    prevBoundsRef.current = mapBounds;
  }, [mapBounds, showMap, setPage]);

  const { data, isLoading, isFetching, isError, refetch } = useListings({
    filters,
    page,
    boundToMap: showMap,
  });
  const total = data?.total ?? 0;

  return (
    <div className="flex min-h-screen flex-col" data-testid="search-page">
      <Navbar />

      <SearchHeader
        total={total}
        view={view}
        onViewChange={(v) => setView(v || "hybrid")}
        sort={filters.sort}
        onSortChange={(v) => setFilter("sort", v)}
        filters={filters}
        setFilter={setFilter}
      />

      <ActiveFilterChips
        filters={filters}
        setFilter={setFilter}
        clearFilters={clearFilters}
      />

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 border-r border-divider md:block sticky top-[128px] h-[calc(100vh-128px)] overflow-y-auto" data-testid="filters-panel">
          <FilterSidebar filters={filters} setFilter={setFilter} />
        </aside>

        {/* Main content area */}
        <div className="flex flex-1 flex-col lg:flex-row" data-testid="search-content">
          {/* Listings */}
          {showList && (
            <div
              className={cn(
                "flex-1 overflow-y-auto p-4",
                showMap && "lg:w-[25%] lg:min-w-[280px] lg:max-w-[25%] lg:flex-none"
              )}
              data-testid="listings-panel"
            >
              <ListingResults
                data={data}
                isLoading={isLoading}
                isFetching={isFetching}
                isError={isError}
                refetch={refetch}
                page={page}
                onPageChange={setPage}
                singleColumn={showMap}
              />
            </div>
          )}

          {/* Map */}
          {showMap && (
            <div
              className={cn(
                "sticky top-[128px] h-[calc(100vh-128px)]",
                showList ? "hidden lg:block lg:flex-1" : "flex-1"
              )}
              data-testid="map-container"
            >
              <Suspense fallback={<MapSkeleton />}>
                <MapView filters={filters} />
              </Suspense>
            </div>
          )}
        </div>
      </div>

      <MobileBottomNav />
      <DetailModal />
      <WatchdogModal />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageContent />
    </Suspense>
  );
}
