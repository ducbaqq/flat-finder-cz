"use client";

import type { MarkerListing } from "@flat-finder/types";
import { formatPrice } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";

interface ListingPopupProps {
  listing: MarkerListing;
}

export function ListingPopup({ listing }: ListingPopupProps) {
  const openDetail = useUiStore((s) => s.openDetail);

  return (
    <div className="w-[260px]">
      {listing.thumbnail_url && (
        <img
          className="h-32 w-full object-cover"
          src={listing.thumbnail_url}
          alt=""
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="p-3">
        <p className="line-clamp-1 text-sm font-semibold">
          {listing.title || "—"}
        </p>
        <p className="mt-0.5 text-sm font-bold text-primary">
          {formatPrice(listing.price, "Kč")}
          {listing.transaction_type === "rent" ? "/měs." : ""}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {listing.city || ""} · {listing.size_m2 ? `${listing.size_m2} m²` : ""}
        </p>
        <button
          className="mt-2 text-xs font-medium text-primary hover:underline"
          onClick={(e) => {
            e.preventDefault();
            openDetail(listing.id);
          }}
        >
          Zobrazit detail →
        </button>
      </div>
    </div>
  );
}
