"use client";

import { cn } from "@/lib/cn";
import { LocationAutocomplete } from "@/components/filters/LocationAutocomplete";
import { Button } from "@/components/ui/button";

interface QuickActionsProps {
  transactionType: "" | "sale" | "rent";
  onTransactionToggle: (next: "sale" | "rent") => void;
  locationQuery: string;
  onLocationChange: (value: string) => void;
  onSubmit: () => void;
}

export function QuickActions({
  transactionType,
  onTransactionToggle,
  locationQuery,
  onLocationChange,
  onSubmit,
}: QuickActionsProps) {
  return (
    <div
      className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center"
      data-testid="quick-actions"
    >
      {/* Transaction type — exclusive segmented toggle */}
      <div
        className="flex items-center gap-2 shrink-0 self-center sm:self-auto"
        role="group"
        aria-label="Typ transakce"
      >
        <TransactionPill
          label="Prodej"
          active={transactionType === "sale"}
          onClick={() => onTransactionToggle("sale")}
          testId="quick-action-sale"
        />
        <TransactionPill
          label="Pronájem"
          active={transactionType === "rent"}
          onClick={() => onTransactionToggle("rent")}
          testId="quick-action-rent"
        />
      </div>

      {/* Location search — controlled text, no auto-submit */}
      <div className="flex-1 w-full sm:w-auto" data-testid="location-search-form">
        <LocationAutocomplete
          value={locationQuery}
          onChange={onLocationChange}
        />
      </div>

      {/* Commit button */}
      <Button
        type="button"
        size="lg"
        onClick={onSubmit}
        className="w-full rounded-full px-6 sm:w-auto"
        data-testid="home-filter-submit"
      >
        Zobrazit inzeráty
      </Button>
    </div>
  );
}

interface TransactionPillProps {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}

function TransactionPill({ label, active, onClick, testId }: TransactionPillProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      data-testid={testId}
      data-active={active}
      className={cn(
        "inline-flex items-center rounded-full px-4 py-2.5 text-sm font-medium",
        "transition-[background-color,color,box-shadow] duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? "bg-primary/8 text-foreground ring-2 ring-inset ring-foreground"
          : "bg-transparent text-foreground ring-1 ring-inset ring-border hover:bg-primary/8"
      )}
    >
      {label}
    </button>
  );
}
