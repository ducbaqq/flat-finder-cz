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
  const emailRef = useRef<HTMLInputElement>(null);

  const filters = currentFilters || {};
  const filterSummaryTags = getFilterSummaryTags(filters);

  const handleSave = useCallback(async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      emailRef.current?.focus();
      return;
    }

    const filtersToSave = { ...filters };
    delete filtersToSave.sort;

    await onSave({
      email: trimmedEmail,
      filters: filtersToSave as unknown as ListingFilters,
      label: localLabel.trim() || undefined,
    });
    setLocalLabel("");
  }, [email, localLabel, filters, onSave]);

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Aktuální filtry:</p>
        {filterSummaryTags.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Žádné filtry — hlídací pes bude sledovat všechny nabídky.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {filterSummaryTags.map((t, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
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
          onChange={(e) => onEmailChange(e.target.value)}
          onBlur={onEmailBlur}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="watchdogLabel">Název (volitelný)</Label>
        <Input
          type="text"
          id="watchdogLabel"
          placeholder="např. Byt 2+kk Praha do 20 000"
          value={localLabel}
          onChange={(e) => setLocalLabel(e.target.value)}
        />
      </div>

      <Button
        className="w-full"
        onClick={handleSave}
        disabled={isCreating}
      >
        <Save className="mr-2 h-4 w-4" />
        {isCreating ? "Ukládám..." : "Uložit hlídacího psa"}
      </Button>
    </div>
  );
}
