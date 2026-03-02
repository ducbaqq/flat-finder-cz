"use client";

import { useCallback, useRef, useState } from "react";
import { useFilterStore } from "@/store/filter-store";
import { getFilterSummaryTags } from "@/lib/utils";
import type { ListingFilters } from "@flat-finder/types";

interface WatchdogFormProps {
  email: string;
  onEmailChange: (email: string) => void;
  onEmailBlur: () => void;
  onSave: (data: {
    email: string;
    filters: ListingFilters;
    label?: string;
  }) => Promise<void>;
  isCreating: boolean;
}

export default function WatchdogForm({
  email,
  onEmailChange,
  onEmailBlur,
  onSave,
  isCreating,
}: WatchdogFormProps) {
  const filters = useFilterStore((s) => s.filters);
  const [localLabel, setLocalLabel] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);

  const filterSummaryTags = getFilterSummaryTags(filters as unknown as Record<string, string | undefined>);

  const handleSave = useCallback(async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      if (emailRef.current) {
        emailRef.current.focus();
        emailRef.current.style.borderColor = "oklch(0.6 0.2 25)";
        setTimeout(() => {
          if (emailRef.current) {
            emailRef.current.style.borderColor = "";
          }
        }, 2000);
      }
      return;
    }

    const filtersToSave: Record<string, string> = { ...filters };
    delete filtersToSave.sort;

    await onSave({
      email: trimmedEmail,
      filters: filtersToSave as unknown as ListingFilters,
      label: localLabel.trim() || undefined,
    });
    setLocalLabel("");
  }, [email, localLabel, filters, onSave]);

  return (
    <div className="watchdog-create">
      <h3>Nov\u00fd hl\u00eddac\u00ed pes (New Watchdog)</h3>
      <div className="watchdog-filters-summary">
        {filterSummaryTags.length === 0 ? (
          <p className="watchdog-filters-empty">
            {"\u017d\u00e1dn\u00e9 filtry \u2014 hl\u00eddac\u00ed pes bude sledovat v\u0161echny nab\u00eddky."}
            <br />
            <small>
              No filters {"\u2014"} the watchdog will watch all listings.
            </small>
          </p>
        ) : (
          <div className="filter-tags">
            {filterSummaryTags.map((t, i) => (
              <span key={i} className="filter-tag">
                <strong>{t.label}:</strong> {t.value}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="watchdog-form">
        <div className="watchdog-input-row">
          <label htmlFor="watchdogEmail">E-mail</label>
          <input
            type="email"
            id="watchdogEmail"
            ref={emailRef}
            className="filter-input"
            placeholder="vas@email.cz"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            onBlur={onEmailBlur}
          />
        </div>
        <div className="watchdog-input-row">
          <label htmlFor="watchdogLabel">
            N\u00e1zev (voliteln\u00fd / optional label)
          </label>
          <input
            type="text"
            id="watchdogLabel"
            className="filter-input"
            placeholder="nap\u0159. Byt 2+kk Praha do 20 000"
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
          />
        </div>
        <button
          className="btn-search watchdog-save-btn"
          onClick={handleSave}
          disabled={isCreating}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          Ulo\u017eit hl\u00eddac\u00edho psa (Save Watchdog)
        </button>
      </div>
    </div>
  );
}
