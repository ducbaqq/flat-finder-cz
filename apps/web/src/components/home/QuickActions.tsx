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
            "inline-flex items-center justify-center rounded-[100px] border border-[#CC0000] px-5 py-2.5 text-sm font-medium transition-colors",
            "text-[#CC0000] bg-white",
            "hover:bg-[#CC0000]/5 hover:text-[#AE0000]",
            "active:bg-[#CC0000]/10"
          )}
          data-testid="quick-action-sale"
        >
          Prodej
        </Link>
        <Link
          href="/filter?transaction_type=rent"
          className={cn(
            "inline-flex items-center justify-center rounded-[100px] border border-[#CC0000] px-5 py-2.5 text-sm font-medium transition-colors",
            "text-[#CC0000] bg-white",
            "hover:bg-[#CC0000]/5 hover:text-[#AE0000]",
            "active:bg-[#CC0000]/10"
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
            className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#626D82] pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={locationQuery}
            onChange={(e) => setLocationQuery(e.target.value)}
            placeholder="Zadejte adresu nebo lokalitu..."
            className={cn(
              "w-full rounded-[100px] border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm text-[#232B3A]",
              "placeholder:text-[#626D82]",
              "focus:outline-none focus:border-[#CC0000] focus:ring-2 focus:ring-[#CC0000]/20",
              "transition-[border-color,box-shadow]"
            )}
            aria-label="Hledat lokalitu"
            data-testid="location-search-input"
          />
        </div>
      </form>
    </div>
  );
}
