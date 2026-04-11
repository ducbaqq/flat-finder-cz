"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
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
  const { filters, view, setView, setFilter, clearFilters } =
    useSearchFilters();

  const showMap = view === "map" || view === "hybrid";
  const showList = view === "list" || view === "hybrid";

  const {
    listings,
    total,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    isError,
    refetch,
    fetchNextPage,
  } = useListings({
    filters,
    boundToMap: showMap,
  });

  // Resizable listings panel (desktop, hybrid only). Min: 340px.
  // Max: leaves at least 25% of the viewport horizontally for the map.
  const [isDesktop, setIsDesktop] = useState(false);
  const [listingsWidth, setListingsWidth] = useState(560);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    setListingsWidth((prev) =>
      prev === 560 ? Math.round(window.innerWidth * 0.4) : prev,
    );
  }, []);

  const clampListingsWidth = useCallback((raw: number) => {
    const rowWidth = contentRef.current?.getBoundingClientRect().width ?? 0;
    const mapMin = window.innerWidth * 0.25;
    const maxW = Math.max(340, rowWidth - mapMin);
    return Math.max(340, Math.min(maxW, raw));
  }, []);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = listingsWidth;
      const onMove = (ev: MouseEvent) => {
        setListingsWidth(clampListingsWidth(startWidth + ev.clientX - startX));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [listingsWidth, clampListingsWidth],
  );

  // Re-clamp on viewport resize so the map never drops below 25vw.
  useEffect(() => {
    const onResize = () => setListingsWidth((w) => clampListingsWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampListingsWidth]);

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
        <aside className="hidden w-72 shrink-0 border-r border-divider md:block sticky top-[100px] h-[calc(100vh-100px)] overflow-hidden" data-testid="filters-panel">
          <FilterSidebar filters={filters} setFilter={setFilter} />
        </aside>

        {/* Main content area */}
        <div
          ref={contentRef}
          className="flex flex-1 flex-col lg:flex-row"
          data-testid="search-content"
        >
          {/* Listings */}
          {showList && (
            <div
              className={cn(
                "relative flex flex-1 flex-col",
                showMap && "lg:min-w-[340px] lg:flex-none"
              )}
              style={
                showMap && isDesktop ? { width: listingsWidth } : undefined
              }
              data-testid="listings-panel"
            >
              <div className="@container flex-1 overflow-y-auto p-4">
                <ListingResults
                  listings={listings}
                  isLoading={isLoading}
                  isFetching={isFetching}
                  isFetchingNextPage={isFetchingNextPage}
                  hasNextPage={hasNextPage}
                  fetchNextPage={fetchNextPage}
                  isError={isError}
                  refetch={refetch}
                  singleColumn={showMap}
                />
              </div>
              {showMap && (
                <div
                  onMouseDown={handleResizeStart}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Změnit velikost panelu výsledků"
                  className="absolute inset-y-0 right-0 z-10 hidden w-1.5 cursor-col-resize bg-divider/40 transition-colors hover:bg-primary/50 lg:block"
                  data-testid="listings-panel-resizer"
                />
              )}
            </div>
          )}

          {/* Map */}
          {showMap && (
            <div
              className={cn(
                "sticky top-[100px] h-[calc(100vh-100px)]",
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
