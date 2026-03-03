"use client";

import { useEffect, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Listing } from "@flat-finder/types";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUiStore } from "@/store/ui-store";
import { apiGet } from "@/lib/api-client";
import {
  formatPrice,
  buildSourceUrl,
  propertyTypeLabels,
} from "@/lib/utils";
import ImageGallery from "./ImageGallery";
import DetailSpecs from "./DetailSpecs";
import MiniMap from "./MiniMap";

const sourceColors: Record<string, string> = {
  sreality: "bg-sreality text-white",
  bezrealitky: "bg-bezrealitky text-white",
  ulovdomov: "bg-ulovdomov text-white",
};

export default function DetailModal() {
  const detailModalOpen = useUiStore((s) => s.detailModalOpen);
  const selectedListingId = useUiStore((s) => s.selectedListingId);
  const closeDetail = useUiStore((s) => s.closeDetail);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!selectedListingId) return;
    setLoading(true);
    setError(false);
    setListing(null);

    apiGet<Listing>(`/listings/${selectedListingId}`)
      .then((data) => {
        setListing(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [selectedListingId]);

  const sourceUrl = listing ? buildSourceUrl(listing) : null;

  return (
    <Dialog open={detailModalOpen} onOpenChange={(open) => !open && closeDetail()}>
      <DialogContent className="max-w-4xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">
          {listing?.title || "Detail nabídky"}
        </DialogTitle>
        <ScrollArea className="max-h-[90vh]">
          <AnimatePresence mode="wait">
            {loading && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4 p-6"
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
              >
                <p className="text-destructive">
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

                <div className="space-y-4 p-5 sm:p-6">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge
                      className={
                        sourceColors[listing.source] ||
                        "bg-primary text-primary-foreground"
                      }
                    >
                      {listing.source}.cz
                    </Badge>
                    <Badge variant="secondary">
                      {propertyTypeLabels[listing.property_type] ||
                        listing.property_type}
                    </Badge>
                    {listing.source === "bezrealitky" && (
                      <Badge className="bg-emerald-600 text-white">
                        Bez provize
                      </Badge>
                    )}
                  </div>

                  <div>
                    <h2 className="text-xl font-bold leading-tight sm:text-2xl">
                      {listing.title || "—"}
                    </h2>
                    <div className="mt-2 flex items-baseline gap-2">
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
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" />
                        {[listing.address, listing.city]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    )}
                  </div>

                  <Separator />

                  <DetailSpecs listing={listing} />

                  {listing.description && (
                    <>
                      <Separator />
                      <div>
                        <h3 className="mb-2 text-sm font-semibold">Popis</h3>
                        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                          {listing.description}
                        </p>
                      </div>
                    </>
                  )}

                  {sourceUrl && (
                    <>
                      <Separator />
                      <Button
                        className="w-full bg-terracotta text-white hover:bg-terracotta/90"
                        size="lg"
                        asChild
                      >
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Zobrazit na {listing.source}.cz
                        </a>
                      </Button>
                    </>
                  )}

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
