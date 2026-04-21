"use client";

import { useEffect, useState } from "react";
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
import { staggerContainer, fadeInUp } from "@/lib/animations";
import {
  getSearchPreferences,
  type SearchPreferences,
} from "@/hooks/useSearchPreferences";

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  flat: "Byty",
  house: "Domy",
  land: "Pozemky",
  commercial: "Komerční",
  other: "Ostatní",
};

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  sale: "Prodej",
  rent: "Pronájem",
};

function buildSubtitle(prefs: SearchPreferences): string {
  const parts: string[] = [];

  if (prefs.property_type) {
    const labels = prefs.property_type
      .split(",")
      .map((t) => PROPERTY_TYPE_LABELS[t] ?? t);
    parts.push(labels.join(", "));
  }
  if (prefs.transaction_type) {
    const labels = prefs.transaction_type
      .split(",")
      .map((t) => TRANSACTION_TYPE_LABELS[t] ?? t);
    parts.push(labels.join(", "));
  }
  if (prefs.location) {
    parts.push(prefs.location);
  }

  return parts.join(" · ");
}

export function LatestListings() {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.1 });

  // Read preferences after mount to avoid SSR/client hydration mismatch —
  // localStorage is only available on the client.
  const [preferences, setPreferences] = useState<SearchPreferences | null>(
    null,
  );
  useEffect(() => {
    setPreferences(getSearchPreferences());
  }, []);

  // Only treat the saved record as "preferences" for UI purposes when it
  // contains at least one filter field. A saved view alone shouldn't flip
  // the homepage copy to "Your last search".
  const hasPreferences =
    preferences !== null &&
    (!!preferences.property_type ||
      !!preferences.transaction_type ||
      !!preferences.location);

  const { data, isLoading } = useQuery<ListingsResponse>({
    queryKey: [
      "latest-listings",
      preferences?.property_type ?? null,
      preferences?.transaction_type ?? null,
      preferences?.location ?? null,
      preferences?.bbox ?? null,
    ],
    queryFn: () => {
      const params: Record<string, string | number> = {
        sort: "newest",
        per_page: 20,
        page: 1,
      };

      if (preferences?.property_type) {
        params.property_type = preferences.property_type;
      } else {
        params.property_type = "flat,house";
      }

      if (preferences?.transaction_type) {
        params.transaction_type = preferences.transaction_type;
      }

      if (preferences?.bbox) {
        const [sw_lng, sw_lat, ne_lng, ne_lat] = preferences.bbox;
        params.sw_lat = sw_lat;
        params.sw_lng = sw_lng;
        params.ne_lat = ne_lat;
        params.ne_lng = ne_lng;
      }

      return apiGet<ListingsResponse>("/listings", params);
    },
  });

  const title = hasPreferences
    ? "Doporučeno pro vás"
    : "Nejnovější nabídky";

  const subtitle = hasPreferences
    ? buildSubtitle(preferences)
    : "Nemovitosti, které by vás mohly zajímat";

  return (
    <section ref={ref} className="py-16 sm:py-20" data-testid="latest-listings-section">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <motion.div
          className="mb-8 flex items-end justify-between"
          variants={fadeInUp}
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
        >
          <div>
            <h2
              className="font-display font-normal text-foreground"
              style={{ fontSize: "var(--text-3xl)" }}
              data-testid="latest-listings-title"
            >
              {title}
            </h2>
            <p className="mt-1 text-muted-foreground" data-testid="latest-listings-subtitle">
              {subtitle}
            </p>
          </div>
          <Button variant="ghost" asChild className="hidden sm:flex" data-testid="latest-listings-view-all">
            <Link href="/search">
              Zobrazit vše
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </motion.div>

        {!isLoading && hasPreferences && data?.listings.length === 0 ? (
          <motion.div
            className="py-16 text-center"
            variants={fadeInUp}
            initial="hidden"
            animate={inView ? "visible" : "hidden"}
          >
            <p className="text-lg text-muted-foreground">
              Pro vaše hledání jsme nenašli žádné nabídky
            </p>
            <Button variant="outline" asChild className="mt-4">
              <Link href="/filter">
                Zkusit jiné filtry
              </Link>
            </Button>
          </motion.div>
        ) : (
          <motion.div
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            variants={staggerContainer}
            initial="hidden"
            animate={inView ? "visible" : "hidden"}
            data-testid="latest-listings-grid"
          >
            {isLoading
              ? Array.from({ length: 20 }).map((_, i) => (
                  <PropertyCardSkeleton key={i} />
                ))
              : data?.listings.map((listing, i) => (
                  <PropertyCard key={listing.id} listing={listing} index={i} />
                ))}
          </motion.div>
        )}

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
