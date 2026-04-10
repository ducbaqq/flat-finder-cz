"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { LocationAutocomplete } from "@/components/filters/LocationAutocomplete";

export function QuickActions() {
  const router = useRouter();
  const [locationQuery, setLocationQuery] = useState("");

  return (
    <div
      className="mt-4 flex flex-col items-center gap-3 sm:flex-row"
      data-testid="quick-actions"
    >
      {/* Transaction type pills */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/filter?transaction_type=sale"
          className={cn(
            "inline-flex items-center rounded-full px-4 py-2.5 text-sm font-medium transition-all",
            "bg-foreground text-background",
            "hover:opacity-90"
          )}
          data-testid="quick-action-sale"
        >
          Prodej
        </Link>
        <Link
          href="/filter?transaction_type=rent"
          className={cn(
            "inline-flex items-center rounded-full px-4 py-2.5 text-sm font-medium transition-all",
            "bg-transparent text-foreground ring-1 ring-border",
            "hover:bg-foreground/5"
          )}
          data-testid="quick-action-rent"
        >
          Pronájem
        </Link>
      </div>

      {/* Location search */}
      <div className="flex-1 w-full sm:w-auto" data-testid="location-search-form">
        <LocationAutocomplete
          value={locationQuery}
          onChange={(val) => {
            setLocationQuery(val);
            if (val.trim()) {
              router.push(`/search?location=${encodeURIComponent(val.trim())}`);
            }
          }}
        />
      </div>
    </div>
  );
}
