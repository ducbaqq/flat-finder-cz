"use client";

import { SearchX, AlertTriangle, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import type { ListingsResponse, ListingCardResponse } from "@flat-finder/types";
import { PropertyCard } from "@/components/shared/PropertyCard";
import { PropertyCardSkeleton } from "@/components/shared/PropertyCardSkeleton";
import { Button } from "@/components/ui/button";

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

  if (isLoading || (isFetching && (!data || data.listings.length === 0))) {
    return (
      <div
        className={`grid gap-5 ${
          singleColumn
            ? "grid-cols-1"
            : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
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

  const showStaleOverlay =
    isFetching && !isLoading && data && data.listings.length > 0;

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
          className={`grid gap-5 ${
            singleColumn
              ? "grid-cols-1"
              : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
          }`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          data-testid="listings-grid"
        >
          {data.listings.map((listing, i) => (
            <PropertyCard key={listing.id} listing={listing} index={i} />
          ))}
        </motion.div>

        {data.total_pages > 1 && (
          <div
            className="flex items-center justify-center gap-3 py-6"
            data-testid="pagination"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="rounded-full"
              data-testid="pagination-prev"
            >
              Předchozí
            </Button>
            <span
              className="text-sm tabular-nums text-muted-foreground"
              data-testid="pagination-info"
            >
              {page} / {data.total_pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.total_pages}
              onClick={() => onPageChange(page + 1)}
              className="rounded-full"
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
