"use client";

import type { Listing } from "@flat-finder/types";
import ListingCard from "./ListingCard";
import SkeletonCard from "./SkeletonCard";

interface ListingGridProps {
  listings: Listing[];
  isLoading: boolean;
}

export default function ListingGrid({ listings, isLoading }: ListingGridProps) {
  if (isLoading) {
    return (
      <div className="listing-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!listings.length) {
    return (
      <div className="empty-state">
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-text-faint)"
          strokeWidth="1.5"
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <h3>{"\u017d\u00e1dn\u00e9 nemovitosti nenalezeny"}</h3>
        <p>No listings found. Try adjusting your filters.</p>
      </div>
    );
  }

  return (
    <div className="listing-grid">
      {listings.map((listing, idx) => (
        <ListingCard key={listing.id} listing={listing} index={idx} />
      ))}
    </div>
  );
}
