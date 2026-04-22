"use client";

import { useState } from "react";
import { MapPin, Ruler, LayoutGrid } from "lucide-react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import type { Listing, ListingCardData } from "@flat-finder/types";
import {
  formatPrice,
  relativeTime,
  amenityLabels,
} from "@/lib/utils";

interface PropertyCardProps {
  listing: Listing | ListingCardData;
  index?: number;
}

export function PropertyCard({ listing, index = 0 }: PropertyCardProps) {
  const router = useRouter();
  const [imgFailed, setImgFailed] = useState(!listing.thumbnail_url);

  // Push the real canonical URL so the @modal parallel-slot route can
  // intercept the navigation from /search and render the detail as an
  // overlay. Direct visitors hit the full page; AnalyticsListener fires
  // on the URL change for both paths. Meta-click / cmd-click falls
  // through to the <a> inside so the real anchor is the control — this
  // onClick is a shortcut for plain clicks.
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay: index < 20 ? index * 0.04 : 0,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="group cursor-pointer"
      onClick={() => router.push(`/listing/${listing.id}`)}
      data-testid="listing-card"
    >
      {/* Image */}
      <div
        className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted"
        data-testid="listing-card-image"
      >
        {imgFailed ? (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-sm text-muted-foreground">Bez fotky</span>
          </div>
        ) : (
          <img
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            src={listing.thumbnail_url!}
            alt={listing.title || ""}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        )}
      </div>

      {/* Body */}
      <div className="px-0.5 pt-3" data-testid="listing-card-body">
        <div className="flex items-start justify-between gap-2">
          <h3
            className="line-clamp-1 font-display text-[15px] font-semibold leading-snug text-foreground"
            data-testid="listing-card-title"
          >
            {listing.title || "\u2014"}
          </h3>
        </div>

        {(listing.address || listing.city) && (
          <p
            className="mt-1 flex items-center gap-1 text-[13px] text-muted-foreground"
            data-testid="listing-card-address"
          >
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="line-clamp-1">
              {listing.address || listing.city}
            </span>
          </p>
        )}

        <div
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground"
          data-testid="listing-card-specs"
        >
          {listing.size_m2 != null && (
            <span className="flex items-center gap-1" data-testid="listing-card-size">
              <Ruler className="h-3 w-3" />
              {listing.size_m2}&nbsp;m&sup2;
            </span>
          )}
          {listing.layout && (
            <span className="flex items-center gap-1" data-testid="listing-card-layout">
              <LayoutGrid className="h-3 w-3" />
              {listing.layout}
            </span>
          )}
        </div>

        {"amenities" in listing &&
          listing.amenities &&
          listing.amenities.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1" data-testid="listing-card-amenities">
              {listing.amenities.slice(0, 3).map((a) => (
                <span
                  key={a}
                  className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  data-testid="listing-card-amenity"
                >
                  {amenityLabels[a] || a}
                </span>
              ))}
            </div>
          )}

        <div className="mt-2.5 flex items-baseline justify-between" data-testid="listing-card-meta">
          <span data-testid="listing-card-price">
            {listing.price ? (
              <>
                <span className="font-display text-base font-semibold text-foreground">
                  {formatPrice(listing.price, listing.currency)}
                </span>
                {listing.transaction_type === "rent" && (
                  <span className="text-[13px] text-muted-foreground">/měs.</span>
                )}
              </>
            ) : (
              <span className="text-[13px] text-muted-foreground">Na dotaz</span>
            )}
          </span>
          {(() => {
            const time = relativeTime(listing.listed_at);
            return time && time !== "právě teď" ? (
              <span className="text-[11px] text-muted-foreground" data-testid="listing-card-date">
                {time}
              </span>
            ) : null;
          })()}
        </div>
      </div>
    </motion.article>
  );
}
