"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { Navbar } from "@/components/shared/Navbar";
import { MobileBottomNav } from "@/components/shared/MobileBottomNav";
import { SearchHeader } from "@/components/search/SearchHeader";
import { ActiveFilterChips } from "@/components/search/ActiveFilterChips";
import { FilterSidebar } from "@/components/search/FilterSidebar";
import { ListingResults } from "@/components/search/ListingResults";
import { SortSelect } from "@/components/filters/SortSelect";
import { useSearchFilters } from "@/hooks/useSearchFilters";
import { useListings } from "@/hooks/useListings";
import { cn } from "@/lib/cn";

// SSR-safe: useLayoutEffect on the client (runs before paint), useEffect on
// the server (no-op, avoids the React "useLayoutEffect does nothing on the
// server" warning).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
  const listingsScrollRef = useRef<HTMLDivElement>(null);

  const clampListingsWidth = useCallback((raw: number) => {
    const rowWidth = contentRef.current?.getBoundingClientRect().width ?? 0;
    const mapMin = window.innerWidth * 0.25;
    const maxW = Math.max(340, rowWidth - mapMin);
    return Math.max(340, Math.min(maxW, raw));
  }, []);

  // Resolve viewport-dependent state synchronously before first paint so the
  // grid doesn't flash from 1 → 2 columns on initial load.
  useIsomorphicLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mq.matches);
    setListingsWidth((prev) =>
      prev === 560
        ? clampListingsWidth(Math.round(window.innerWidth * 0.4))
        : prev,
    );
    const sync = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [clampListingsWidth]);

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
                showMap &&
                  "lg:sticky lg:top-[100px] lg:h-[calc(100vh-100px)] lg:min-w-[340px] lg:flex-none"
              )}
              style={
                showMap && isDesktop ? { width: listingsWidth } : undefined
              }
              data-testid="listings-panel"
            >
              <div className="flex items-center justify-end px-4 pt-3 pb-1">
                <SortSelect
                  value={filters.sort}
                  onChange={(v) => setFilter("sort", v)}
                />
              </div>
              <div
                ref={listingsScrollRef}
                className="@container flex-1 overflow-y-auto px-4 pb-4 pt-2"
              >
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
                  scrollRootRef={showMap ? listingsScrollRef : undefined}
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
      {/* WatchdogModal + ReportProblemModal + the @modal parallel slot
          (intercepted listing detail) are all mounted in app/layout.tsx. */}
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
