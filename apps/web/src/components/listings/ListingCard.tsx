"use client";

import type { Listing } from "@flat-finder/types";
import { useFilterStore } from "@/store/filter-store";
import {
  formatPrice,
  relativeTime,
  propertyTypeLabels,
  amenityLabels,
} from "@/lib/utils";

interface ListingCardProps {
  listing: Listing;
  index: number;
}

export default function ListingCard({ listing, index }: ListingCardProps) {
  const openDetail = useFilterStore((s) => s.openDetail);

  return (
    <article
      className="listing-card"
      onClick={() => openDetail(listing.id)}
      style={{
        animation: `fadeIn 300ms ${index * 40}ms both ease-out`,
      }}
    >
      <div className="card-image-wrap">
        <img
          className="card-image"
          src={
            listing.thumbnail_url ||
            `https://picsum.photos/seed/placeholder/400/300`
          }
          alt={listing.title || ""}
          loading="lazy"
          width={400}
          height={300}
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://picsum.photos/seed/fallback${listing.id}/400/300`;
          }}
        />
        <div className="card-badges">
          <span className={`badge badge-source ${listing.source}`}>
            {listing.source}.cz
          </span>
          <span className="badge badge-type">
            {propertyTypeLabels[listing.property_type] ||
              listing.property_type}
          </span>
        </div>
      </div>
      <div className="card-body">
        <div className="card-title">{listing.title || "\u2014"}</div>
        <div className="card-address">
          {listing.address || listing.city || "\u2014"}
        </div>
        <div className="card-price">
          {formatPrice(listing.price, listing.currency)}
          {listing.transaction_type === "rent" ? "/m\u011bs." : ""}
          {listing.price_note && (
            <span className="card-price-note">{listing.price_note}</span>
          )}
        </div>
        <div className="card-meta">
          {listing.size_m2 && (
            <span className="card-meta-item">{listing.size_m2} m\u00b2</span>
          )}
          {listing.layout && (
            <span className="card-meta-item">{listing.layout}</span>
          )}
          {listing.floor !== null && listing.floor !== undefined && (
            <span className="card-meta-item">{listing.floor}. patro</span>
          )}
        </div>
        {listing.amenities && listing.amenities.length > 0 && (
          <div className="card-tags">
            {listing.amenities.slice(0, 4).map((a) => (
              <span key={a} className="card-tag">
                {amenityLabels[a] || a}
              </span>
            ))}
          </div>
        )}
        <div className="card-footer">
          <span className="card-date">{relativeTime(listing.listed_at)}</span>
        </div>
      </div>
    </article>
  );
}
