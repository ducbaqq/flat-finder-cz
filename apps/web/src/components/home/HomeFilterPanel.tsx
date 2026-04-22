"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PropertyTypeTabs } from "./PropertyTypeTabs";
import { QuickActions } from "./QuickActions";

/**
 * Owns the home-page filter composition state: property types (multi),
 * transaction type (exclusive), location (free text). Nothing navigates
 * until the user commits via the submit button.
 */
export function HomeFilterPanel() {
  const router = useRouter();

  const [propertyTypes, setPropertyTypes] = useState<string[]>([]);
  const [transactionType, setTransactionType] = useState<"" | "sale" | "rent">("");
  const [locationQuery, setLocationQuery] = useState("");

  const togglePropertyType = useCallback((key: string) => {
    setPropertyTypes((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const toggleTransactionType = useCallback((next: "sale" | "rent") => {
    setTransactionType((prev) => (prev === next ? "" : next));
  }, []);

  const submitHref = useMemo(() => {
    const params = new URLSearchParams();
    if (propertyTypes.length > 0) {
      params.set("property_type", propertyTypes.join(","));
    }
    if (transactionType) {
      params.set("transaction_type", transactionType);
    }
    const trimmedLocation = locationQuery.trim();
    if (trimmedLocation) {
      params.set("location", trimmedLocation);
    }
    const qs = params.toString();
    return qs ? `/search?${qs}` : "/search";
  }, [propertyTypes, transactionType, locationQuery]);

  const handleSubmit = useCallback(() => {
    router.push(submitHref);
  }, [router, submitHref]);

  return (
    <div className="flex flex-col gap-5" data-testid="home-filter-panel">
      <PropertyTypeTabs
        selected={propertyTypes}
        onToggle={togglePropertyType}
      />
      <QuickActions
        transactionType={transactionType}
        onTransactionToggle={toggleTransactionType}
        locationQuery={locationQuery}
        onLocationChange={setLocationQuery}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
