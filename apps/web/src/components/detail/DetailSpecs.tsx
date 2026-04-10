"use client";

import {
  Ruler,
  LayoutGrid,
  Building,
  Wrench,
  Landmark,
  Key,
  Sofa,
  Zap,
} from "lucide-react";
import type { Listing } from "@flat-finder/types";
import {
  conditionLabels,
  constructionLabels,
  ownershipLabels,
  furnishingLabels,
  amenityLabels,
} from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface SpecItem {
  icon: LucideIcon;
  label: string;
  value: string;
}

export default function DetailSpecs({ listing }: { listing: Listing }) {
  const specs: SpecItem[] = [];

  if (listing.size_m2 != null)
    specs.push({ icon: Ruler, label: "Plocha", value: `${listing.size_m2} m²` });
  if (listing.layout)
    specs.push({ icon: LayoutGrid, label: "Dispozice", value: listing.layout });
  if (listing.floor != null)
    specs.push({
      icon: Building,
      label: "Patro",
      value: listing.total_floors
        ? `${listing.floor} / ${listing.total_floors}`
        : String(listing.floor),
    });
  if (listing.condition)
    specs.push({
      icon: Wrench,
      label: "Stav",
      value: conditionLabels[listing.condition] || listing.condition,
    });
  if (listing.construction)
    specs.push({
      icon: Landmark,
      label: "Konstrukce",
      value: constructionLabels[listing.construction] || listing.construction,
    });
  if (listing.ownership)
    specs.push({
      icon: Key,
      label: "Vlastnictví",
      value: ownershipLabels[listing.ownership] || listing.ownership,
    });
  if (listing.furnishing)
    specs.push({
      icon: Sofa,
      label: "Vybavenost",
      value: furnishingLabels[listing.furnishing] || listing.furnishing,
    });
  if (listing.energy_rating)
    specs.push({ icon: Zap, label: "Energetická třída (PENB)", value: listing.energy_rating });

  return (
    <div className="space-y-4" data-testid="listing-detail-specs">
      {specs.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="listing-detail-specs-grid">
          {specs.map(({ icon: Icon, label, value }) => (
            <div
              key={label}
              className="flex items-start gap-2.5 rounded-lg bg-surface-offset p-4"
              data-testid="listing-detail-spec"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="text-[11px] text-muted-foreground" data-testid="listing-detail-spec-label">{label}</div>
                <div className="text-sm font-medium" data-testid="listing-detail-spec-value">{value}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {listing.amenities && listing.amenities.length > 0 && (
        <div data-testid="listing-detail-amenities">
          <h4 className="mb-2 text-sm font-semibold">Vybavení</h4>
          <div className="flex flex-wrap gap-1.5">
            {listing.amenities.map((a) => (
              <span
                key={a}
                className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                data-testid="listing-detail-amenity"
              >
                {amenityLabels[a] || a}
              </span>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
