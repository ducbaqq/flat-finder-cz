"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function SearchTabs() {
  const router = useRouter();
  const [transactionType, setTransactionType] = useState("rent");
  const [location, setLocation] = useState("");

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (transactionType) params.set("transaction_type", transactionType);
    if (location.trim()) params.set("location", location.trim());
    router.push(`/search?${params.toString()}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-divider bg-card/95 shadow-lg backdrop-blur-md">
      {/* Transaction type tabs */}
      <div className="flex border-b border-divider">
        <button
          onClick={() => setTransactionType("sale")}
          className={cn(
            "flex-1 px-6 py-3 text-sm font-semibold transition-colors",
            transactionType === "sale"
              ? "bg-primary text-white"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          Koupit
        </button>
        <button
          onClick={() => setTransactionType("rent")}
          className={cn(
            "flex-1 px-6 py-3 text-sm font-semibold transition-colors",
            transactionType === "rent"
              ? "bg-primary text-white"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          Pronajmout
        </button>
      </div>

      {/* Search fields */}
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-0 sm:divide-x sm:divide-divider sm:p-0">
        {/* Lokalita */}
        <div className="flex-1 sm:px-4 sm:py-3">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:mb-0">
            Lokalita
          </label>
          <input
            type="text"
            placeholder="Město nebo lokalita..."
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        {/* Search button */}
        <div className="sm:p-2">
          <Button
            onClick={handleSearch}
            size="lg"
            className="w-full bg-primary text-white hover:bg-primary/90 sm:w-auto sm:rounded-lg"
          >
            <Search className="mr-2 h-4 w-4" />
            Hledat
          </Button>
        </div>
      </div>
    </div>
  );
}
