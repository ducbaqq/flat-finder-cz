"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useInView } from "react-intersection-observer";
import { useQuery } from "@tanstack/react-query";
import type { ListingsResponse } from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PropertyCard } from "@/components/shared/PropertyCard";
import { PropertyCardSkeleton } from "@/components/shared/PropertyCardSkeleton";
import { staggerContainer } from "@/lib/animations";

export function LatestListings() {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.1 });

  const { data, isLoading } = useQuery<ListingsResponse>({
    queryKey: ["latest-listings"],
    queryFn: () =>
      apiGet<ListingsResponse>("/listings", {
        sort: "newest",
        per_page: 8,
        page: 1,
      }),
  });

  return (
    <section ref={ref} className="py-16 sm:py-20" data-testid="latest-listings-section">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h2
              className="font-display font-normal"
              style={{ fontSize: "var(--text-3xl)" }}
              data-testid="latest-listings-title"
            >
              Doporučené pro Vás
            </h2>
            <p className="mt-1 text-muted-foreground" data-testid="latest-listings-subtitle">
              Nemovitosti, které by vás mohly zajímat
            </p>
          </div>
          <Button variant="ghost" asChild className="hidden sm:flex" data-testid="latest-listings-view-all">
            <Link href="/search">
              Zobrazit vše
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <motion.div
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          variants={staggerContainer}
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          data-testid="latest-listings-grid"
        >
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <PropertyCardSkeleton key={i} />
              ))
            : data?.listings.map((listing, i) => (
                <PropertyCard key={listing.id} listing={listing} index={i} />
              ))}
        </motion.div>

        <div className="mt-8 text-center sm:hidden" data-testid="latest-listings-view-all-mobile">
          <Button variant="outline" asChild>
            <Link href="/search">
              Zobrazit vše
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
