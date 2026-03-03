"use client";

import { SearchX } from "lucide-react";
import { motion } from "framer-motion";
import type { ListingsResponse } from "@flat-finder/types";
import { PropertyCard } from "@/components/shared/PropertyCard";
import { PropertyCardSkeleton } from "@/components/shared/PropertyCardSkeleton";
import { Button } from "@/components/ui/button";
import { staggerContainer } from "@/lib/animations";

interface ListingResultsProps {
  data: ListingsResponse | undefined;
  isLoading: boolean;
  page: number;
  onPageChange: (page: number) => void;
  singleColumn?: boolean;
}

export function ListingResults({
  data,
  isLoading,
  page,
  onPageChange,
  singleColumn,
}: ListingResultsProps) {
  if (isLoading) {
    return (
      <div
        className={`grid gap-4 ${
          singleColumn ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
        }`}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <PropertyCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!data || data.listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <SearchX className="mb-4 h-12 w-12 text-muted-foreground/50" />
        <h3 className="text-lg font-semibold">Žádné výsledky</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Zkuste upravit filtry nebo rozšířit vyhledávání pro více výsledků.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <motion.div
        className={`grid gap-4 ${
          singleColumn ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"
        }`}
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {data.listings.map((listing, i) => (
          <PropertyCard key={listing.id} listing={listing} index={i} />
        ))}
      </motion.div>

      {data.total_pages > 1 && (
        <div className="flex items-center justify-center gap-2 py-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Předchozí
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {data.total_pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.total_pages}
            onClick={() => onPageChange(page + 1)}
          >
            Další
          </Button>
        </div>
      )}
    </div>
  );
}
