"use client";

import { useEffect, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Listing, ClusterSibling, ClusterSiblingsResponse } from "@flat-finder/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUiStore } from "@/store/ui-store";
import { apiGet } from "@/lib/api-client";
import { formatPrice, buildSourceUrl } from "@/lib/utils";
import ImageGallery from "./ImageGallery";
import DetailSpecs from "./DetailSpecs";
import MiniMap from "./MiniMap";
import ClusterSiblings from "./ClusterSiblings";

export default function DetailModal() {
  const detailModalOpen = useUiStore((s) => s.detailModalOpen);
  const selectedListingId = useUiStore((s) => s.selectedListingId);
  const openDetail = useUiStore((s) => s.openDetail);
  const closeDetail = useUiStore((s) => s.closeDetail);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [siblings, setSiblings] = useState<ClusterSibling[]>([]);

  // Open modal if ?listing=ID is in the URL on mount
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("listing");
    if (id && !detailModalOpen) {
      openDetail(Number(id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedListingId) return;
    setLoading(true);
    setError(false);
    setListing(null);
    setSiblings([]);

    apiGet<Listing>(`/listings/${selectedListingId}`)
      .then((data) => {
        setListing(data);
        setLoading(false);
        if (data.cluster_id) {
          apiGet<ClusterSiblingsResponse>(
            `/listings/${selectedListingId}/cluster-siblings`,
          )
            .then((r) => setSiblings(r.siblings))
            .catch(() => {});
        }
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [selectedListingId]);

  return (
    <Dialog open={detailModalOpen} onOpenChange={(open) => !open && closeDetail()}>
      <DialogContent className="max-w-4xl gap-0 overflow-hidden rounded-xl border-divider p-0" data-testid="listing-detail-modal">
        <DialogTitle className="sr-only">
          {listing?.title || "Detail nabídky"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Detail nemovitosti{listing?.title ? ` - ${listing.title}` : ""}
        </DialogDescription>
        <ScrollArea className="max-h-[90vh]">
          <AnimatePresence mode="wait">
            {loading && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4 p-6"
                data-testid="listing-detail-loading"
              >
                <Skeleton className="aspect-[16/9] w-full rounded-lg" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-4 w-1/2" />
              </motion.div>
            )}

            {error && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-8 text-center"
                data-testid="listing-detail-error"
              >
                <p className="text-destructive" data-testid="listing-detail-error-message">
                  Nepodařilo se načíst detail nabídky.
                </p>
              </motion.div>
            )}

            {listing && (
              <motion.div
                key="content"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25 }}
              >
                <ImageGallery images={listing.image_urls || []} />

                <div className="space-y-5 p-5 sm:p-6">
                  {/* Source pills */}
                  <SourcePills listing={listing} siblings={siblings} />

                  {/* Title + Price */}
                  <div>
                    <h2 className="font-display text-xl leading-tight sm:text-2xl" data-testid="listing-detail-title">
                      {listing.title || "\u2014"}
                    </h2>
                    <div className="mt-2 flex items-baseline gap-2" data-testid="listing-detail-price">
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
                    </div>
                    {(listing.address || listing.city) && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="listing-detail-address">
                        <MapPin className="h-3.5 w-3.5" />
                        {[listing.address, listing.city]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    )}
                  </div>

                  <Separator className="bg-divider" />

                  {/* Specs */}
                  <DetailSpecs listing={listing} />

                  {/* Description */}
                  {listing.description && (
                    <>
                      <Separator className="bg-divider" />
                      <div data-testid="listing-detail-description">
                        <h3 className="mb-2 text-sm font-semibold">Popis</h3>
                        <p className="max-w-[72ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                          {listing.description.replace(/\n(\s*\n)+/g, "\n\n")}
                        </p>
                      </div>
                    </>
                  )}

                  {/* Cross-source cluster siblings — only renders if >1 portal has this listing */}
                  {listing.cluster_id && (
                    <ClusterSiblings listingId={listing.id} />
                  )}

                  {/* Mini map */}
                  {listing.latitude != null && listing.longitude != null && (
                    <MiniMap lat={listing.latitude} lng={listing.longitude} />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function SourcePills({
  listing,
  siblings,
}: {
  listing: Listing;
  siblings: ClusterSibling[];
}) {
  // Build list of sources to show. If siblings loaded and contain >1 entry,
  // use them (each has its own source_url). Otherwise fall back to just the
  // current listing as the sole source.
  const sources =
    siblings.length > 1
      ? siblings.map((s) => ({
          source: s.source,
          url: siblingUrl(s),
        }))
      : [{ source: listing.source, url: buildSourceUrl(listing) }];

  return (
    <div
      className="flex flex-wrap gap-1.5"
      data-testid="listing-detail-sources"
    >
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
