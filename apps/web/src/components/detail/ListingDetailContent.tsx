"use client";

import { useEffect } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import type { Listing, ClusterSibling } from "@flat-finder/types";
import { Separator } from "@/components/ui/separator";
import { trackEvent } from "@/lib/analytics";
import { formatPrice, buildSourceUrl } from "@/lib/utils";
import ImageGallery from "./ImageGallery";
import DetailSpecs from "./DetailSpecs";
import MiniMap from "./MiniMap";
import ClusterSiblings from "./ClusterSiblings";

interface Props {
  listing: Listing;
  /**
   * Optional pre-fetched cluster siblings. When supplied, the source-pills
   * strip shows one pill per sibling (multi-portal badge). When omitted,
   * <ClusterSiblings> still fetches on the client and we fall back to a
   * single pill pointing at this listing's source.
   */
  siblings?: ClusterSibling[];
}

/**
 * The shared visual body of a listing detail. Rendered as-is by the full
 * SSR page at /listing/[id], and wrapped inside a <Dialog> by the
 * intercepted-route modal at /@modal/(.)listing/[id].
 *
 * NOTE: this component must remain presentational — no Dialog, no page
 * chrome, no back/close buttons. Its parent decides the frame.
 */
export default function ListingDetailContent({ listing, siblings = [] }: Props) {
  // Fire the rich listing_view event on hydration, regardless of whether
  // we arrived via SSR or via the intercepted-route modal. AnalyticsListener
  // already covers page_view from the URL change; this adds event params
  // GA4 wouldn't otherwise see.
  useEffect(() => {
    trackEvent("listing_view", {
      listing_id: listing.id,
      source: listing.source,
      property_type: listing.property_type,
      transaction_type: listing.transaction_type,
      city: listing.city ?? undefined,
      price: listing.price ?? undefined,
      cluster_id: listing.cluster_id ?? undefined,
    });
  }, [listing.id, listing.source, listing.property_type, listing.transaction_type, listing.city, listing.price, listing.cluster_id]);

  return (
    <>
      <ImageGallery images={listing.image_urls || []} />

      <div className="space-y-5 p-5 sm:p-6">
        <SourcePills listing={listing} siblings={siblings} />

        {/* Title + Price */}
        <div>
          <h1
            className="font-display text-xl leading-tight sm:text-2xl"
            data-testid="listing-detail-title"
          >
            {listing.title || "\u2014"}
          </h1>
          <div
            className="mt-2 flex items-baseline gap-2"
            data-testid="listing-detail-price"
          >
            {listing.price == null ? (
              <span className="text-2xl font-bold sm:text-3xl">
                <span className="text-foreground">Cena </span>
                <span className="text-primary">Na dotaz</span>
              </span>
            ) : (
              <>
                <span className="text-2xl font-bold text-primary sm:text-3xl">
                  {formatPrice(listing.price, listing.currency)}
                </span>
                {listing.transaction_type === "rent" && (
                  <span className="text-muted-foreground">/měs.</span>
                )}
                {listing.price_note && (
                  <span className="text-sm text-muted-foreground">
                    {listing.price_note}
                  </span>
                )}
              </>
            )}
          </div>
          {(listing.address || listing.city) && (
            <div
              className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground"
              data-testid="listing-detail-address"
            >
              <MapPin className="h-3.5 w-3.5" />
              {[listing.address, listing.city].filter(Boolean).join(", ")}
            </div>
          )}
        </div>

        <Separator className="bg-divider" />

        <DetailSpecs listing={listing} />

        {listing.description && (
          <>
            <Separator className="bg-divider" />
            <div data-testid="listing-detail-description">
              <h2 className="mb-2 font-display text-sm font-semibold">Popis</h2>
              <p className="max-w-[72ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {listing.description.replace(/\n(\s*\n)+/g, "\n\n")}
              </p>
            </div>
          </>
        )}

        <ClusterSiblings listing={listing} />

        {listing.latitude != null && listing.longitude != null && (
          <MiniMap lat={listing.latitude} lng={listing.longitude} />
        )}
      </div>
    </>
  );
}

function SourcePills({
  listing,
  siblings,
}: {
  listing: Listing;
  siblings: ClusterSibling[];
}) {
  const sources =
    siblings.length > 1
      ? siblings.map((s) => ({ source: s.source, url: siblingUrl(s) }))
      : [{ source: listing.source, url: buildSourceUrl(listing) }];

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="listing-detail-sources">
      {sources.map(({ source, url }) =>
        url ? (
          <a
            key={source}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            data-testid={`listing-source-pill-${source}`}
          >
            {source}.cz
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span
            key={source}
            className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
            data-testid={`listing-source-pill-${source}`}
          >
            {source}.cz
          </span>
        ),
      )}
    </div>
  );
}

function siblingUrl(s: ClusterSibling): string | null {
  const asListing = {
    source: s.source,
    external_id: s.external_id,
    source_url: s.source_url,
    property_type: s.property_type,
    transaction_type: s.transaction_type,
    layout: s.layout,
  } as unknown as Listing;
  return buildSourceUrl(asListing);
}
