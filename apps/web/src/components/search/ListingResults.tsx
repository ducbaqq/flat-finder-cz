"use client";

import { useEffect, useRef } from "react";
import { SearchX, AlertTriangle, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import type { Listing, ListingCardData } from "@flat-finder/types";
import { PropertyCard } from "@/components/shared/PropertyCard";
import { PropertyCardSkeleton } from "@/components/shared/PropertyCardSkeleton";
import { Button } from "@/components/ui/button";

interface ListingResultsProps {
  listings: (Listing | ListingCardData)[];
  isLoading: boolean;
  isFetching?: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
  isError?: boolean;
  refetch?: () => void;
  singleColumn?: boolean;
}

export function ListingResults({
  listings,
  isLoading,
  isFetching,
  isFetchingNextPage,
  hasNextPage,
  fetchNextPage,
  isError,
  refetch,
  singleColumn,
}: ListingResultsProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasNextPage || !fetchNextPage) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage, isFetchingNextPage]);

  if (isError) {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 text-center"
        data-testid="listings-error"
      >
        <AlertTriangle className="mb-4 h-10 w-10 text-destructive/50" />
        <h3
          className="font-display text-lg font-semibold"
          data-testid="listings-error-title"
        >
          Nepodařilo se načíst nabídky
        </h3>
        <p
          className="mt-1.5 max-w-xs text-sm text-muted-foreground"
          data-testid="listings-error-message"
        >
          Zkontrolujte připojení k internetu a zkuste to znovu.
        </p>
        {refetch && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4 rounded-full"
            onClick={() => refetch()}
            data-testid="listings-error-retry"
          >
            Zkusit znovu
          </Button>
        )}
      </div>
    );
  }

  if (isLoading || (isFetching && listings.length === 0)) {
    return (
      <div
        className={
          singleColumn
            ? "grid grid-cols-1 gap-3 @[500px]:grid-cols-2 @[760px]:grid-cols-3"
            : "grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
        }
        data-testid="listings-loading"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <PropertyCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 text-center"
        data-testid="listings-empty"
      >
        <SearchX className="mb-4 h-10 w-10 text-muted-foreground/40" />
        <h3
          className="font-display text-lg font-semibold"
          data-testid="listings-empty-title"
        >
          Žádné výsledky
        </h3>
        <p
          className="mt-1.5 max-w-xs text-sm text-muted-foreground"
          data-testid="listings-empty-message"
        >
          Zkuste upravit filtry nebo rozšířit oblast hledání.
        </p>
      </div>
    );
  }

  const showStaleOverlay = isFetching && !isLoading && !isFetchingNextPage;

  return (
    <div className="relative space-y-5" data-testid="listings-results">
      {showStaleOverlay && (
        <div className="absolute inset-0 z-10 flex items-start justify-center pt-32">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}
      <div
        className={
          showStaleOverlay
            ? "pointer-events-none opacity-40 transition-opacity"
            : "transition-opacity"
        }
      >
        <motion.div
          className={
            singleColumn
              ? "grid grid-cols-1 gap-3 @[500px]:grid-cols-2 @[760px]:grid-cols-3"
              : "grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
          }
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          data-testid="listings-grid"
        >
          {listings.map((listing, i) => (
            <PropertyCard key={listing.id} listing={listing} index={i} />
          ))}
        </motion.div>

        {hasNextPage && (
          <div
            ref={sentinelRef}
            aria-hidden="true"
            data-testid="listings-sentinel"
          />
        )}

        {isFetchingNextPage && (
          <div
            className={
              singleColumn
                ? "mt-3 grid grid-cols-1 gap-3 @[500px]:grid-cols-2 @[760px]:grid-cols-3"
                : "mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
            }
            data-testid="listings-next-skeletons"
          >
            <PropertyCardSkeleton />
            <PropertyCardSkeleton
              className={
                singleColumn
                  ? "hidden @[500px]:block"
                  : "hidden md:block"
              }
            />
            <PropertyCardSkeleton
              className={
                singleColumn
                  ? "hidden @[760px]:block"
                  : "hidden xl:block"
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
