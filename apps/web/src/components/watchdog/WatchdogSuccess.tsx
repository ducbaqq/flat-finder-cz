"use client";

import { useMemo } from "react";
import { BellRing } from "lucide-react";
import { motion } from "framer-motion";
import type { ListingFilters } from "@flat-finder/types";
import { Button } from "@/components/ui/button";
import { getFilterSummaryTags } from "@/lib/utils";

interface WatchdogSuccessProps {
  email: string;
  label: string | null;
  /**
   * Saved filters. Accepts the typed `ListingFilters` payload (mixed
   * string / number / etc.) used by the API or the flat string-record
   * we keep in URL params. Either is normalized below.
   */
  filters: ListingFilters | Record<string, string>;
  onClose: () => void;
}

/**
 * `getFilterSummaryTags` expects a `Record<string, string | undefined>`
 * — but the watchdog save payload comes through as `ListingFilters`
 * with mixed value types (numbers for price/size, the bbox tuple, etc.).
 * Coerce every relevant entry to its string form so the summary table
 * renders the same labels the form's summary mode shows.
 */
function toStringRecord(
  filters: ListingFilters | Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

export default function WatchdogSuccess({
  email,
  label,
  filters,
  onClose,
}: WatchdogSuccessProps) {
  const tags = useMemo(
    () => getFilterSummaryTags(toStringRecord(filters)),
    [filters],
  );

  return (
    <div
      className="space-y-6 pt-2"
      data-testid="watchdog-success"
      role="status"
      aria-live="polite"
    >
      {/*
        Icon + headline + subline. A single staged motion: the icon
        breathes in slightly larger than its rest size, then the
        title/subline rise underneath. Kept short (≤ 400ms total) so
        repeat saves don't feel theatrical.
      */}
      <div className="flex flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="flex size-14 items-center justify-center rounded-full bg-accent/15 text-accent"
          aria-hidden="true"
        >
          <BellRing className="size-7" strokeWidth={1.75} />
        </motion.div>

        <motion.h3
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.08 }}
          className="mt-4 font-display text-2xl font-normal tracking-tight text-foreground"
          data-testid="watchdog-success-title"
        >
          Hlídač nemovitostí uložen
        </motion.h3>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.14 }}
          className="mt-1.5 max-w-[34ch] text-sm text-muted-foreground"
        >
          Pošleme vám e-mail, jakmile najdeme nabídku odpovídající vašim filtrům.
        </motion.p>
      </div>

      {/*
        Definition-list summary — same pattern as the form's read-only
        summary mode. Label column auto-sizes to the longest dt; value
        column takes the rest. No borders, no card chrome.
      */}
      <motion.dl
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut", delay: 0.2 }}
        className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm"
        data-testid="watchdog-success-summary"
      >
        <div className="contents" data-testid="watchdog-success-row-email">
          <dt className="text-muted-foreground">E-mail</dt>
          <dd className="break-all font-medium text-foreground">{email}</dd>
        </div>

        {label && (
          <div className="contents" data-testid="watchdog-success-row-label">
            <dt className="text-muted-foreground">Název</dt>
            <dd className="font-medium text-foreground">{label}</dd>
          </div>
        )}

        {tags.map((t, i) => (
          <div
            key={`${t.label}-${i}`}
            className="contents"
            data-testid="watchdog-success-row-filter"
          >
            <dt className="text-muted-foreground">{t.label}</dt>
            <dd className="font-medium text-foreground">{t.value}</dd>
          </div>
        ))}
      </motion.dl>

      <div className="flex justify-end pt-1">
        <Button
          onClick={onClose}
          className="w-full sm:w-auto sm:min-w-[7rem]"
          data-testid="watchdog-success-ok"
        >
          OK
        </Button>
      </div>
    </div>
  );
}
