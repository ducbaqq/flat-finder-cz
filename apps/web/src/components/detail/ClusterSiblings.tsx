"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { ClusterSibling, ClusterSiblingsResponse, Listing } from "@flat-finder/types";
import { apiGet } from "@/lib/api-client";
import { buildSourceUrl, formatPrice } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

interface Props {
  listingId: number;
  /** The listing currently displayed — used to visually mark "you are here". */
  currentSource: string;
}

export default function ClusterSiblings({ listingId, currentSource }: Props) {
  const [siblings, setSiblings] = useState<ClusterSibling[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<ClusterSiblingsResponse>(`/listings/${listingId}/cluster-siblings`)
      .then((data) => {
        if (!cancelled) setSiblings(data.siblings);
      })
      .catch(() => {
        if (!cancelled) setSiblings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  // Nothing rendered until we have real data — and we only render when this
  // listing has actual cross-source siblings (>1 member in the cluster).
  if (!siblings || siblings.length <= 1) return null;

  // Only highlight "nejlevnější" when prices actually vary across portals.
  // When all siblings share the same price (e.g. a cluster of identical
  // parking spots all at 1 890 CZK), highlighting every row is visual noise.
  const definedPrices = siblings
    .map((s) => s.price)
    .filter((p): p is number => p != null);
  const priceMin = definedPrices.length > 0 ? Math.min(...definedPrices) : null;
  const priceMax = definedPrices.length > 0 ? Math.max(...definedPrices) : null;
  const pricesVary = priceMin != null && priceMax != null && priceMin !== priceMax;

  return (
    <>
      <Separator className="bg-divider" />
      <div data-testid="cluster-siblings">
        <h3 className="mb-2 text-sm font-semibold">
          Dostupné na {siblings.length} portálech
        </h3>
        <ul className="space-y-1.5">
          {siblings.map((s) => {
            const url = urlFor(s);
            const isCheapest =
              pricesVary && s.price != null && s.price === priceMin;
            const isCurrent = s.source === currentSource;
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-md border border-divider bg-muted/40 px-3 py-2"
                data-testid={`cluster-sibling-${s.source}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{s.source}.cz</span>
                  {isCheapest && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      nejlevnější
                    </span>
                  )}
                  {isCurrent && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      zobrazeno
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">
                    {formatPrice(s.price, s.currency ?? undefined)}
                  </span>
                  {url && !isCurrent && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary"
                      aria-label={`Otevřít na ${s.source}.cz`}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/**
 * buildSourceUrl reads a narrow subset of Listing fields. We cast a minimal
 * sibling shape through Listing so we can reuse the source-specific URL logic
 * without duplicating it here.
 */
function urlFor(s: ClusterSibling): string | null {
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
