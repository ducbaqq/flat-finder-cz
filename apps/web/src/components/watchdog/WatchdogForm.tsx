"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Save } from "lucide-react";
import type { ListingFilters } from "@flat-finder/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";
import {
  conditionLabels,
  constructionLabels,
  ownershipLabels,
  furnishingLabels,
  amenityLabels,
  getFilterSummaryTags,
} from "@/lib/utils";
import { WatchdogLocationField, type Bbox } from "./WatchdogLocationField";

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

// Canonical lists — copied from FilterSidebar / its sub-components so the
// watchdog form ingests/emits the exact same values the /search filter
// pipeline understands.
const PROPERTY_TYPES: { value: string; label: string }[] = [
  { value: "flat", label: "Byt" },
  { value: "house", label: "Dům" },
  { value: "land", label: "Pozemek" },
  { value: "commercial", label: "Komerční" },
  { value: "cottage", label: "Chata" },
  { value: "garage", label: "Garáž" },
];

const LAYOUTS = [
  "1+kk",
  "1+1",
  "2+kk",
  "2+1",
  "3+kk",
  "3+1",
  "4+kk",
  "4+1",
  "5+kk",
  "5+1",
  "6+",
  "Atypický",
  "Pokoj",
];

const ENERGY_RATINGS = ["A", "B", "C", "D", "E", "F", "G"];

const SOURCES: { value: string; label: string }[] = [
  { value: "sreality", label: "sreality.cz" },
  { value: "bezrealitky", label: "bezrealitky.cz" },
  { value: "ulovdomov", label: "ulovdomov.cz" },
  { value: "bazos", label: "bazos.cz" },
  { value: "idnes", label: "idnes.cz" },
  { value: "ceskereality", label: "ceskereality.cz" },
  { value: "realitymix", label: "realitymix.cz" },
  { value: "ereality", label: "ereality.cz" },
  { value: "eurobydleni", label: "eurobydleni.cz" },
  { value: "realingo", label: "realingo.cz" },
];

// CSV split that tolerates the empty string (",".split(",") => [""], not []).
function splitCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBboxFromFilters(f: Record<string, string>): Bbox {
  const sw_lng = Number(f.sw_lng);
  const sw_lat = Number(f.sw_lat);
  const ne_lng = Number(f.ne_lng);
  const ne_lat = Number(f.ne_lat);
  if (
    Number.isFinite(sw_lng) &&
    Number.isFinite(sw_lat) &&
    Number.isFinite(ne_lng) &&
    Number.isFinite(ne_lat) &&
    (f.sw_lng || f.sw_lat || f.ne_lng || f.ne_lat)
  ) {
    return [sw_lng, sw_lat, ne_lng, ne_lat];
  }
  return null;
}

interface PillProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
  className?: string;
  ariaLabel?: string;
}

// Editorial Bytomat pill, same aesthetic as PropertyTypeTabs.
function Pill({ active, onClick, children, testId, className, ariaLabel }: PillProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium",
        "transition-[background-color,color,box-shadow] duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        // Active style matches the /search filter Toggle (`data-[state=on]:
        // bg-accent text-accent-foreground`): warm terracotta accent, no
        // border. Resting state uses the same neutral hover as Toggle.
        active
          ? "bg-accent text-accent-foreground"
          : "bg-transparent text-muted-foreground hover:bg-muted hover:text-muted-foreground",
        className,
      )}
      data-testid={testId}
      data-active={active}
    >
      {children}
    </button>
  );
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

  // ── Filter state, initialized from `currentFilters` ──────────────────────
  // Each dimension is local; nothing here mutates the parent prop or the
  // global /search store.
  const initial = currentFilters ?? {};

  const [transactionType, setTransactionType] = useState<string>(
    initial.transaction_type ?? "",
  );
  const [propertyTypes, setPropertyTypes] = useState<string[]>(
    splitCsv(initial.property_type),
  );
  const [locationValue, setLocationValue] = useState<string>(
    initial.location ?? "",
  );
  const [locationBbox, setLocationBbox] = useState<Bbox>(
    parseBboxFromFilters(initial),
  );
  const [priceMin, setPriceMin] = useState<string>(initial.price_min ?? "");
  const [priceMax, setPriceMax] = useState<string>(initial.price_max ?? "");
  const [sizeMin, setSizeMin] = useState<string>(initial.size_min ?? "");
  const [sizeMax, setSizeMax] = useState<string>(initial.size_max ?? "");
  const [layouts, setLayouts] = useState<string[]>(splitCsv(initial.layout));
  const [conditions, setConditions] = useState<string[]>(
    splitCsv(initial.condition),
  );
  const [constructions, setConstructions] = useState<string[]>(
    splitCsv(initial.construction),
  );
  const [ownerships, setOwnerships] = useState<string[]>(
    splitCsv(initial.ownership),
  );
  const [furnishings, setFurnishings] = useState<string[]>(
    splitCsv(initial.furnishing),
  );
  const [energyRatings, setEnergyRatings] = useState<string[]>(
    splitCsv(initial.energy_rating),
  );
  const [amenities, setAmenities] = useState<string[]>(
    splitCsv(initial.amenities),
  );
  const [sources, setSources] = useState<string[]>(splitCsv(initial.source));

  const [moreOpen, setMoreOpen] = useState(false);

  // Two display modes for the filters section:
  //   - "summary" — read-only chips of whatever /search already had applied,
  //     plus an "Upravit" button to switch to edit. Default when filters
  //     came in via `currentFilters`.
  //   - "edit" — the full pill/range/collapsible editor below. Default when
  //     no filters are applied (so a cold "Vytvořit hlídač" lands directly
  //     on the editor).
  // Once the user clicks "Upravit", we stay in edit mode for the lifetime
  // of this form mount (modal close+reopen remounts and re-evaluates).
  const summaryTagsFromProp = useMemo(
    () => getFilterSummaryTags(currentFilters ?? {}),
    [currentFilters],
  );
  const [mode, setMode] = useState<"summary" | "edit">(() =>
    summaryTagsFromProp.length > 0 ? "summary" : "edit",
  );

  // Re-sync from prop when caller passes a new filter snapshot (e.g., modal
  // re-opened after the user changed /search filters in the background).
  // Compare via JSON.stringify so we only reset when the snapshot really
  // changed — typing in a local input must not trigger this.
  const lastSnapshotRef = useRef<string>(JSON.stringify(currentFilters ?? {}));
  useEffect(() => {
    const next = JSON.stringify(currentFilters ?? {});
    if (next === lastSnapshotRef.current) return;
    lastSnapshotRef.current = next;

    const f = currentFilters ?? {};
    setTransactionType(f.transaction_type ?? "");
    setPropertyTypes(splitCsv(f.property_type));
    setLocationValue(f.location ?? "");
    setLocationBbox(parseBboxFromFilters(f));
    setPriceMin(f.price_min ?? "");
    setPriceMax(f.price_max ?? "");
    setSizeMin(f.size_min ?? "");
    setSizeMax(f.size_max ?? "");
    setLayouts(splitCsv(f.layout));
    setConditions(splitCsv(f.condition));
    setConstructions(splitCsv(f.construction));
    setOwnerships(splitCsv(f.ownership));
    setFurnishings(splitCsv(f.furnishing));
    setEnergyRatings(splitCsv(f.energy_rating));
    setAmenities(splitCsv(f.amenities));
    setSources(splitCsv(f.source));
  }, [currentFilters]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const toggleIn = useCallback(
    (set: (next: string[]) => void, current: string[], value: string) => {
      set(
        current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      );
    },
    [],
  );

  const handleLocationChange = useCallback((next: string, bbox: Bbox) => {
    setLocationValue(next);
    setLocationBbox(bbox);
  }, []);

  // Counts for collapsed "Další filtry" badge.
  const secondaryActiveCount = useMemo(() => {
    let n = 0;
    if (layouts.length) n++;
    if (conditions.length) n++;
    if (constructions.length) n++;
    if (ownerships.length) n++;
    if (amenities.length) n++;
    if (furnishings.length) n++;
    if (energyRatings.length) n++;
    if (sources.length) n++;
    return n;
  }, [
    layouts,
    conditions,
    constructions,
    ownerships,
    amenities,
    furnishings,
    energyRatings,
    sources,
  ]);

  // Whether ANY filter is set — drives the empty-state hint.
  const anyFilterActive = useMemo(() => {
    return Boolean(
      transactionType ||
        propertyTypes.length ||
        locationValue ||
        priceMin ||
        priceMax ||
        sizeMin ||
        sizeMax ||
        secondaryActiveCount > 0,
    );
  }, [
    transactionType,
    propertyTypes,
    locationValue,
    priceMin,
    priceMax,
    sizeMin,
    sizeMax,
    secondaryActiveCount,
  ]);

  const handleReset = useCallback(() => {
    setTransactionType("");
    setPropertyTypes([]);
    setLocationValue("");
    setLocationBbox(null);
    setPriceMin("");
    setPriceMax("");
    setSizeMin("");
    setSizeMax("");
    setLayouts([]);
    setConditions([]);
    setConstructions([]);
    setOwnerships([]);
    setFurnishings([]);
    setEnergyRatings([]);
    setAmenities([]);
    setSources([]);
  }, []);

  // ── Submit ──────────────────────────────────────────────────────────────
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

    // Compose the EDITED filter payload. Drop empty strings/arrays so the
    // backend doesn't store noise like price_min: "".
    const filters: ListingFilters = {};
    if (transactionType) filters.transaction_type = transactionType;
    if (propertyTypes.length) filters.property_type = propertyTypes.join(",");
    const trimmedLocation = locationValue.trim();
    if (trimmedLocation) {
      filters.location = trimmedLocation;
      if (locationBbox) {
        filters.sw_lng = locationBbox[0];
        filters.sw_lat = locationBbox[1];
        filters.ne_lng = locationBbox[2];
        filters.ne_lat = locationBbox[3];
      }
    }
    const priceMinNum = Number(priceMin);
    if (priceMin && Number.isFinite(priceMinNum)) filters.price_min = priceMinNum;
    const priceMaxNum = Number(priceMax);
    if (priceMax && Number.isFinite(priceMaxNum)) filters.price_max = priceMaxNum;
    const sizeMinNum = Number(sizeMin);
    if (sizeMin && Number.isFinite(sizeMinNum)) filters.size_min = sizeMinNum;
    const sizeMaxNum = Number(sizeMax);
    if (sizeMax && Number.isFinite(sizeMaxNum)) filters.size_max = sizeMaxNum;
    if (layouts.length) filters.layout = layouts.join(",");
    if (conditions.length) filters.condition = conditions.join(",");
    if (constructions.length) filters.construction = constructions.join(",");
    if (ownerships.length) filters.ownership = ownerships.join(",");
    if (furnishings.length) filters.furnishing = furnishings.join(",");
    if (energyRatings.length) filters.energy_rating = energyRatings.join(",");
    if (amenities.length) filters.amenities = amenities.join(",");
    if (sources.length) filters.source = sources.join(",");

    await onSave({
      email: trimmedEmail,
      filters,
      label: localLabel.trim() || undefined,
    });
    setLocalLabel("");
  }, [
    email,
    localLabel,
    transactionType,
    propertyTypes,
    locationValue,
    locationBbox,
    priceMin,
    priceMax,
    sizeMin,
    sizeMax,
    layouts,
    conditions,
    constructions,
    ownerships,
    furnishings,
    energyRatings,
    amenities,
    sources,
    onSave,
  ]);

  const handleEmailChange = useCallback(
    (value: string) => {
      onEmailChange(value);
      if (emailError) setEmailError("");
    },
    [onEmailChange, emailError],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4" data-testid="watchdog-form">
      {mode === "summary" ? (
        <section
          className="space-y-2"
          data-testid="watchdog-form-filters-summary"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold tracking-tight">
              Aktuální filtry:
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode("edit")}
              className="h-7 px-2 text-xs"
              data-testid="watchdog-form-filters-edit"
            >
              Upravit
            </Button>
          </div>
          {/*
            Definition-list table view: label column auto-widths to the
            longest label, value column gets the rest. No borders, generous
            row gap. Each filter dimension on its own line.
          */}
          <dl
            className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm"
            data-testid="watchdog-form-filters-summary-list"
          >
            {summaryTagsFromProp.map((t, i) => (
              <div
                key={`${t.label}-${i}`}
                className="contents"
                data-testid="watchdog-form-filter-tag"
              >
                <dt className="text-muted-foreground">{t.label}</dt>
                <dd className="font-medium text-foreground">{t.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
      <section className="space-y-3" data-testid="watchdog-form-filters">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight">Filtry</h3>
          {anyFilterActive && (
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              data-testid="watchdog-form-filter-reset"
            >
              Resetovat
            </button>
          )}
        </div>

        {/* Transaction type — exclusive */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Typ obchodu</Label>
          <div
            className="flex flex-wrap gap-1.5"
            data-testid="watchdog-form-filter-transaction_type"
          >
            <Pill
              active={transactionType === "rent"}
              onClick={() =>
                setTransactionType((curr) => (curr === "rent" ? "" : "rent"))
              }
              testId="watchdog-form-filter-transaction_type-rent"
            >
              Pronájem
            </Pill>
            <Pill
              active={transactionType === "sale"}
              onClick={() =>
                setTransactionType((curr) => (curr === "sale" ? "" : "sale"))
              }
              testId="watchdog-form-filter-transaction_type-sale"
            >
              Prodej
            </Pill>
          </div>
        </div>

        {/* Property type — multi */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Typ nemovitosti</Label>
          <div
            className="flex flex-wrap gap-1.5"
            data-testid="watchdog-form-filter-property_type"
          >
            {PROPERTY_TYPES.map((t) => (
              <Pill
                key={t.value}
                active={propertyTypes.includes(t.value)}
                onClick={() => toggleIn(setPropertyTypes, propertyTypes, t.value)}
                testId={`watchdog-form-filter-property_type-${t.value}`}
              >
                {t.label}
              </Pill>
            ))}
          </div>
        </div>

        {/* Location */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Lokalita</Label>
          <WatchdogLocationField
            value={locationValue}
            bbox={locationBbox}
            onChange={handleLocationChange}
          />
        </div>

        {/* Price range */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Cena (Kč)</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <Input
                type="number"
                inputMode="numeric"
                placeholder="od"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
                className="pr-8"
                data-testid="watchdog-form-filter-price_min"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                Kč
              </span>
            </div>
            <div className="relative">
              <Input
                type="number"
                inputMode="numeric"
                placeholder="do"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
                className="pr-8"
                data-testid="watchdog-form-filter-price_max"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                Kč
              </span>
            </div>
          </div>
        </div>

        {/* Size range */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Plocha (m²)</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <Input
                type="number"
                inputMode="numeric"
                placeholder="od"
                value={sizeMin}
                onChange={(e) => setSizeMin(e.target.value)}
                className="pr-8"
                data-testid="watchdog-form-filter-size_min"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                m²
              </span>
            </div>
            <div className="relative">
              <Input
                type="number"
                inputMode="numeric"
                placeholder="do"
                value={sizeMax}
                onChange={(e) => setSizeMax(e.target.value)}
                className="pr-8"
                data-testid="watchdog-form-filter-size_max"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                m²
              </span>
            </div>
          </div>
        </div>

        {/* Inline empty-state hint */}
        {!anyFilterActive && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="watchdog-form-no-filters"
          >
            {/* FIXME(czech-grammar) — confirm phrasing with native speaker */}
            Žádné filtry — hlídač nemovitostí bude sledovat všechny nabídky.
          </p>
        )}

        {/* Další filtry */}
        <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
          <CollapsibleTrigger
            className={cn(
              "group flex w-full items-center justify-between rounded-md border border-border/60 bg-secondary/40 px-3 py-2",
              "text-xs font-medium tracking-tight text-foreground",
              "transition-colors hover:bg-secondary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
            data-testid="watchdog-form-more-filters-trigger"
          >
            <span className="flex items-center gap-2">
              Další filtry
              {secondaryActiveCount > 0 && (
                <Badge
                  variant="secondary"
                  className="h-5 rounded-full px-2 text-[10px]"
                  data-testid="watchdog-form-more-filters-count"
                >
                  {/* FIXME(czech-grammar) — singular/plural endings (1 aktivní / 2-4 aktivní / 5+ aktivních) */}
                  {secondaryActiveCount} aktivní
                </Badge>
              )}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform duration-200",
                moreOpen && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            {/* Layout / Dispozice */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Dispozice</Label>
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="watchdog-form-filter-layout"
              >
                {LAYOUTS.map((l) => (
                  <Pill
                    key={l}
                    active={layouts.includes(l)}
                    onClick={() => toggleIn(setLayouts, layouts, l)}
                    testId={`watchdog-form-filter-layout-${l}`}
                  >
                    {l}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Condition */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Stav</Label>
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="watchdog-form-filter-condition"
              >
                {Object.entries(conditionLabels).map(([k, v]) => (
                  <Pill
                    key={k}
                    active={conditions.includes(k)}
                    onClick={() => toggleIn(setConditions, conditions, k)}
                    testId={`watchdog-form-filter-condition-${k}`}
                  >
                    {v}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Construction */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Konstrukce</Label>
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="watchdog-form-filter-construction"
              >
                {Object.entries(constructionLabels).map(([k, v]) => (
                  <Pill
                    key={k}
                    active={constructions.includes(k)}
                    onClick={() =>
                      toggleIn(setConstructions, constructions, k)
                    }
                    testId={`watchdog-form-filter-construction-${k}`}
                  >
                    {v}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Ownership */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Vlastnictví</Label>
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="watchdog-form-filter-ownership"
              >
                {Object.entries(ownershipLabels).map(([k, v]) => (
                  <Pill
                    key={k}
                    active={ownerships.includes(k)}
                    onClick={() => toggleIn(setOwnerships, ownerships, k)}
                    testId={`watchdog-form-filter-ownership-${k}`}
                  >
                    {v}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Amenities */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Vybavenost</Label>
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="watchdog-form-filter-amenities"
              >
                {Object.entries(amenityLabels).map(([k, v]) => (
                  <Pill
                    key={k}
                    active={amenities.includes(k)}
                    onClick={() => toggleIn(setAmenities, amenities, k)}
                    testId={`watchdog-form-filter-amenities-${k}`}
                  >
                    {v}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Furnishing */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Vybavení</Label>
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="watchdog-form-filter-furnishing"
              >
                {Object.entries(furnishingLabels).map(([k, v]) => (
                  <Pill
                    key={k}
                    active={furnishings.includes(k)}
                    onClick={() => toggleIn(setFurnishings, furnishings, k)}
                    testId={`watchdog-form-filter-furnishing-${k}`}
                  >
                    {v}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Energy rating */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">
                Energetická třída
              </Label>
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="watchdog-form-filter-energy_rating"
              >
                {ENERGY_RATINGS.map((r) => (
                  <Pill
                    key={r}
                    active={energyRatings.includes(r)}
                    onClick={() => toggleIn(setEnergyRatings, energyRatings, r)}
                    testId={`watchdog-form-filter-energy_rating-${r}`}
                    className="min-w-[2rem] justify-center font-semibold"
                  >
                    {r}
                  </Pill>
                ))}
              </div>
            </div>

            {/* Source */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">
                Zdroj inzerátu
              </Label>
              <div
                className="flex flex-wrap gap-1.5"
                data-testid="watchdog-form-filter-source"
              >
                {SOURCES.map((s) => (
                  <Pill
                    key={s.value}
                    active={sources.includes(s.value)}
                    onClick={() => toggleIn(setSources, sources, s.value)}
                    testId={`watchdog-form-filter-source-${s.value}`}
                  >
                    {s.label}
                  </Pill>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
      )}

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
