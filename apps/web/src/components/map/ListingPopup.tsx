"use client";

import type { MarkerListing } from "@flat-finder/types";
import { formatPrice } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";

interface ListingPopupProps {
  listing: MarkerListing;
}

export default function ListingPopup({ listing }: ListingPopupProps) {
  const openDetail = useFilterStore((s) => s.openDetail);

  return (
    <>
      <img
        className="popup-img"
        src={
          listing.thumbnail_url ||
          `https://picsum.photos/seed/p${listing.id}/300/200`
        }
        alt=""
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).src =
            "https://picsum.photos/seed/fallback/300/200";
        }}
      />
      <div className="popup-content">
        <div className="popup-title">
          {listing.title || "\u2014"}
        </div>
        <div className="popup-price">
          {formatPrice(listing.price, "K\u010d")}
          {listing.transaction_type === "rent" ? "/m\u011bs." : ""}
        </div>
        <div className="popup-address">
          {listing.city || ""} {"\u00b7"}{" "}
          {listing.size_m2 ? listing.size_m2 + " m\u00b2" : ""}
        </div>
        <a
          className="popup-link"
          onClick={(e) => {
            e.preventDefault();
            openDetail(listing.id);
          }}
          href="#"
        >
          Zobrazit detail {"\u2192"}
        </a>
      </div>
    </>
  );
}
