"use client";

import { useRef } from "react";
import MapSection from "@/components/map/MapSection";
import ListingGrid from "@/components/listings/ListingGrid";
import Pagination from "@/components/listings/Pagination";
import { useListings } from "@/hooks/useListings";
import { useFilterStore } from "@/store/filter-store";

export default function MainContent() {
  const mainRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, isError } = useListings();
  const total = useFilterStore((s) => s.total);

  const listings = data?.listings ?? [];

  return (
    <main className="main-content" id="main-content" ref={mainRef}>
      <MapSection />

      <div className="listings-section">
        <div className="results-header">
          <span className="results-count">
            {isLoading
              ? "Na\u010d\u00edt\u00e1n\u00ed..."
              : `${total} nemovitost\u00ed nalezeno (${total} listings)`}
          </span>
        </div>

        {isError ? (
          <p
            style={{
              color: "var(--color-error)",
              padding: "var(--space-4)",
            }}
          >
            Error loading listings.
          </p>
        ) : (
          <ListingGrid listings={listings} isLoading={isLoading} />
        )}

        <Pagination scrollTargetRef={mainRef} />
      </div>
    </main>
  );
}
