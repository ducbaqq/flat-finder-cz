"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";

export function QuickActions() {
  const router = useRouter();
  const [locationQuery, setLocationQuery] = useState("");

  const handleLocationSearch = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = locationQuery.trim();
      if (trimmed) {
        router.push(`/search?location=${encodeURIComponent(trimmed)}`);
      }
    },
    [locationQuery, router]
  );

  return (
    <div
      className="mt-5 flex flex-col sm:flex-row items-center gap-3 w-full"
      data-testid="quick-actions"
    >
      {/* Transaction type pills */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/filter?transaction_type=sale"
          className={cn(
            "inline-flex items-center justify-center rounded-full border border-primary px-5 py-2.5 text-sm font-medium transition-all duration-200",
            "text-primary bg-card",
            "hover:bg-primary/5 hover:shadow-sm",
            "active:bg-primary/10"
          )}
          data-testid="quick-action-sale"
        >
          Prodej
        </Link>
        <Link
          href="/filter?transaction_type=rent"
          className={cn(
            "inline-flex items-center justify-center rounded-full border border-primary px-5 py-2.5 text-sm font-medium transition-all duration-200",
            "text-primary bg-card",
            "hover:bg-primary/5 hover:shadow-sm",
            "active:bg-primary/10"
          )}
          data-testid="quick-action-rent"
        >
          Pronájem
        </Link>
      </div>

      {/* Location search input */}
      <form
        onSubmit={handleLocationSearch}
        className="flex-1 w-full sm:w-auto"
        data-testid="location-search-form"
      >
        <div className="relative">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={locationQuery}
            onChange={(e) => setLocationQuery(e.target.value)}
            placeholder="Zadejte adresu nebo lokalitu..."
            className={cn(
              "w-full rounded-full border border-border bg-card py-2.5 pl-10 pr-4 text-sm text-foreground",
              "placeholder:text-muted-foreground",
              "focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20",
              "transition-all duration-200"
            )}
            aria-label="Hledat lokalitu"
            data-testid="location-search-input"
          />
        </div>
      </form>
    </div>
  );
}
