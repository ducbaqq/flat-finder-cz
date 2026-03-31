"use client";

import { SearchX, AlertTriangle, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import type { ListingsResponse, ListingCardResponse } from "@flat-finder/types";
import { PropertyCard } from "@/components/shared/PropertyCard";
import { PropertyCardSkeleton } from "@/components/shared/PropertyCardSkeleton";
import { Button } from "@/components/ui/button";
import { staggerContainer } from "@/lib/animations";

interface ListingResultsProps {
  data: ListingsResponse | ListingCardResponse | undefined;
  isLoading: boolean;
  isFetching?: boolean;
  isError?: boolean;
  refetch?: () => void;
  page: number;
  onPageChange: (page: number) => void;
  singleColumn?: boolean;
}

export function ListingResults({
  data,
  isLoading,
  isFetching,
  isError,
  refetch,
  page,
  onPageChange,
  singleColumn,
}: ListingResultsProps) {
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="listings-error">
        <AlertTriangle className="mb-4 h-12 w-12 text-destructive/60" />
        <h3 className="text-lg font-semibold font-display" data-testid="listings-error-title">
          Nepodařilo se načíst nabídky
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground" data-testid="listings-error-message">
          Zkontrolujte připojení k internetu a zkuste to znovu.
        </p>
        {refetch && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4 rounded-lg"
            onClick={() => refetch()}
            data-testid="listings-error-retry"
          >
            Zkusit znovu
          </Button>
        )}
      </div>
    );
  }

  if (isLoading || (isFetching && (!data || data.listings.length === 0))) {
    return (
      <div
        className={`grid gap-4 ${
          singleColumn ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
        }`}
        data-testid="listings-loading"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <PropertyCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!data || data.listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="listings-empty">
        <SearchX className="mb-4 h-12 w-12 text-muted-foreground/50" />
        <h3 className="text-lg font-semibold font-display" data-testid="listings-empty-title">
          Žádné výsledky
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground" data-testid="listings-empty-message">
          Zkuste upravit filtry nebo rozšířit vyhledávání pro více výsledků.
        </p>
      </div>
    );
  }

  const showStaleOverlay = isFetching && !isLoading && data && data.listings.length > 0;

  return (
    <div className="relative space-y-4" data-testid="listings-results">
      {showStaleOverlay && (
        <div className="absolute inset-0 z-10 flex items-start justify-center pt-32">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      <div className={showStaleOverlay ? "opacity-40 pointer-events-none transition-opacity" : "transition-opacity"}>
        <motion.div
          className={`grid gap-4 ${
            singleColumn ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
          }`}
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          data-testid="listings-grid"
        >
          {data.listings.map((listing, i) => (
            <PropertyCard key={listing.id} listing={listing} index={i} />
          ))}
        </motion.div>

        {data.total_pages > 1 && (
          <div className="flex items-center justify-center gap-2 py-4" data-testid="pagination">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="rounded-lg"
              data-testid="pagination-prev"
            >
              Předchozí
            </Button>
            <span className="text-sm text-muted-foreground" data-testid="pagination-info">
              {page} / {data.total_pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.total_pages}
              onClick={() => onPageChange(page + 1)}
              className="rounded-lg"
              data-testid="pagination-next"
            >
              Další
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
