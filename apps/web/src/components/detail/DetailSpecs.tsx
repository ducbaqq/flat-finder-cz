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
    specs.push({ icon: Zap, label: "PENB", value: listing.energy_rating });

  return (
    <div className="space-y-4">
      {specs.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {specs.map(({ icon: Icon, label, value }) => (
            <div
              key={label}
              className="flex items-start gap-2.5 rounded-lg bg-surface-offset p-4"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="text-sm font-medium">{value}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {listing.amenities && listing.amenities.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Vybavení</h4>
          <div className="flex flex-wrap gap-1.5">
            {listing.amenities.map((a) => (
              <span
                key={a}
                className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                {amenityLabels[a] || a}
              </span>
            ))}
          </div>
        </div>
      )}

      {(listing.seller_name || listing.seller_phone || listing.seller_email) && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Prodávající</h4>
          <div className="grid gap-1 text-sm">
            {listing.seller_name && <p>{listing.seller_name}</p>}
            {listing.seller_company && (
              <p className="text-muted-foreground">{listing.seller_company}</p>
            )}
            {listing.seller_phone && (
              <a
                href={`tel:${listing.seller_phone}`}
                className="text-primary hover:underline"
              >
                {listing.seller_phone}
              </a>
            )}
            {listing.seller_email && (
              <a
                href={`mailto:${listing.seller_email}`}
                className="text-primary hover:underline"
              >
                {listing.seller_email}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
