"use client";

import { useCallback, useRef, useState } from "react";
import { Save } from "lucide-react";
import type { ListingFilters } from "@flat-finder/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getFilterSummaryTags } from "@/lib/utils";

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
  currentFilters?: Record<string, string>;
}

export default function WatchdogForm({
  email,
  onEmailChange,
  onEmailBlur,
  onSave,
  isCreating,
  currentFilters,
}: WatchdogFormProps) {
  const [localLabel, setLocalLabel] = useState("");
  const [emailError, setEmailError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);

  const filters = currentFilters || {};
  const filterSummaryTags = getFilterSummaryTags(filters);

  const handleSave = useCallback(async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError("Zadejte e-mailovou adresu");
      emailRef.current?.focus();
      return;
    }
    if (!trimmedEmail.includes("@") || !trimmedEmail.includes(".")) {
      setEmailError("Zadejte platnou e-mailovou adresu");
      emailRef.current?.focus();
      return;
    }

    setEmailError("");

    // The modal already filters out `sort`/`view`/`watchdog`/`listing`
    // before passing currentFilters in. Defensive cleanup still keeps the
    // form valid if a future caller passes a less-curated filter object.
    const filtersToSave = { ...filters };
    delete filtersToSave.sort;
    delete filtersToSave.view;

    await onSave({
      email: trimmedEmail,
      filters: filtersToSave as unknown as ListingFilters,
      label: localLabel.trim() || undefined,
    });
    setLocalLabel("");
  }, [email, localLabel, filters, onSave]);

  const handleEmailChange = useCallback(
    (value: string) => {
      onEmailChange(value);
      if (emailError) setEmailError("");
    },
    [onEmailChange, emailError]
  );

  return (
    <div className="space-y-4" data-testid="watchdog-form">
      <div data-testid="watchdog-form-filters-summary">
        <p className="mb-2 text-sm text-muted-foreground">Aktuální filtry:</p>
        {filterSummaryTags.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="watchdog-form-no-filters">
            Žádné filtry — hlídač nemovitostí bude sledovat všechny nabídky.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {filterSummaryTags.map((t, i) => (
              <Badge key={i} variant="secondary" className="text-xs" data-testid="watchdog-form-filter-tag">
                {t.label}: {t.value}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="watchdogEmail">E-mail</Label>
        <Input
          type="email"
          id="watchdogEmail"
          ref={emailRef}
          placeholder="vas@email.cz"
          value={email}
          onChange={(e) => handleEmailChange(e.target.value)}
          onBlur={onEmailBlur}
          className={emailError ? "border-destructive ring-destructive/20 ring-2" : ""}
          aria-invalid={!!emailError}
          aria-describedby={emailError ? "watchdogEmailError" : undefined}
          data-testid="watchdog-form-email"
        />
        {emailError && (
          <p id="watchdogEmailError" className="text-sm text-destructive mt-1" data-testid="watchdog-form-email-error">
            {emailError}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="watchdogLabel">Název (volitelný)</Label>
        <Input
          type="text"
          id="watchdogLabel"
          placeholder="např. Byt 2+kk Praha do 20 000"
          value={localLabel}
          onChange={(e) => setLocalLabel(e.target.value)}
          data-testid="watchdog-form-label"
        />
      </div>

      <Button
        className="w-full"
        onClick={handleSave}
        disabled={isCreating}
        data-testid="watchdog-form-submit"
      >
        <Save className="mr-2 h-4 w-4" />
        {/* FIXME(czech-grammar) — accusative collision; nominative kept verbatim, review */}
        {isCreating ? "Ukládám..." : "Uložit Hlídač nemovitostí"}
      </Button>
    </div>
  );
}
