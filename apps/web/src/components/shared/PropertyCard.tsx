"use client";

import { MapPin, Ruler, LayoutGrid, Building } from "lucide-react";
import { motion } from "framer-motion";
import type { Listing } from "@flat-finder/types";
import { Badge } from "@/components/ui/badge";
import {
  formatPrice,
  relativeTime,
  propertyTypeLabels,
  amenityLabels,
} from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";

interface PropertyCardProps {
  listing: Listing;
  index?: number;
}

const sourceColors: Record<string, string> = {
  sreality: "bg-sreality text-white",
  bezrealitky: "bg-bezrealitky text-white",
  ulovdomov: "bg-ulovdomov text-white",
};

export function PropertyCard({ listing, index = 0 }: PropertyCardProps) {
  const openDetail = useUiStore((s) => s.openDetail);

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      whileHover={{ y: -4, scale: 1.01 }}
      className="group cursor-pointer overflow-hidden rounded-xl border border-divider bg-card shadow-sm transition-shadow hover:shadow-lg"
      onClick={() => openDetail(listing.id)}
      data-testid="listing-card"
    >
      {/* Image */}
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-muted to-surface-offset" data-testid="listing-card-image">
        <img
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          src={
            listing.thumbnail_url ||
            `https://picsum.photos/seed/ph${listing.id}/400/250`
          }
          alt={listing.title || ""}
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://picsum.photos/seed/fb${listing.id}/400/250`;
          }}
        />

        {/* Source badge - top left */}
        <div className="absolute left-2 top-2 flex gap-1.5">
          <Badge
            className={cn(
              "text-[10px] font-semibold rounded-md",
              sourceColors[listing.source] || "bg-primary text-primary-foreground"
            )}
            data-testid="listing-card-source"
          >
            {listing.source}.cz
          </Badge>
        </div>


        {/* Price badge - bottom right */}
        <div className="absolute bottom-2 right-2 rounded-lg bg-card/90 px-3 py-1.5 shadow-sm backdrop-blur-sm" data-testid="listing-card-price">
          <span className="text-sm font-bold text-primary">
            {formatPrice(listing.price, listing.currency)}
          </span>
          {listing.transaction_type === "rent" && (
            <span className="text-xs text-muted-foreground">/měs.</span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4" data-testid="listing-card-body">
        <h3 className="line-clamp-1 font-display text-[15px] font-normal leading-tight" data-testid="listing-card-title">
          {listing.title || "\u2014"}
        </h3>

        {(listing.address || listing.city) && (
          <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground" data-testid="listing-card-address">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="line-clamp-1">
              {listing.address || listing.city}
            </span>
          </div>
        )}

        {/* Specs row */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="listing-card-specs">
          {listing.size_m2 != null && (
            <span className="flex items-center gap-1" data-testid="listing-card-size">
              <Ruler className="h-3 w-3" />
              {listing.size_m2} m&sup2;
            </span>
          )}
          {listing.layout && (
            <span className="flex items-center gap-1" data-testid="listing-card-layout">
              <LayoutGrid className="h-3 w-3" />
              {listing.layout}
            </span>
          )}
          {listing.floor != null && (
            <span className="flex items-center gap-1" data-testid="listing-card-floor">
              <Building className="h-3 w-3" />
              {listing.floor}. patro
            </span>
          )}
        </div>

        {listing.amenities && listing.amenities.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1" data-testid="listing-card-amenities">
            {listing.amenities.slice(0, 3).map((a) => (
              <span
                key={a}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                data-testid="listing-card-amenity"
              >
                {amenityLabels[a] || a}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground" data-testid="listing-card-meta">
          <span data-testid="listing-card-date">{relativeTime(listing.listed_at)}</span>
          <span data-testid="listing-card-type">
            {propertyTypeLabels[listing.property_type] || listing.property_type}
          </span>
        </div>
      </div>
    </motion.article>
  );
}
