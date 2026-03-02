"use client";

import type { Listing } from "@flat-finder/types";
import {
  conditionLabels,
  constructionLabels,
  ownershipLabels,
  furnishingLabels,
  amenityLabels,
} from "@/lib/utils";

interface DetailGridProps {
  listing: Listing;
}

interface DetailField {
  label: string;
  value: string;
}

export default function DetailGrid({ listing }: DetailGridProps) {
  const fields: DetailField[] = [];

  if (listing.size_m2 != null) {
    fields.push({ label: "Plocha (Size)", value: `${listing.size_m2} m\u00b2` });
  }
  if (listing.layout) {
    fields.push({ label: "Dispozice (Layout)", value: listing.layout });
  }
  if (listing.floor != null) {
    fields.push({
      label: "Patro (Floor)",
      value: listing.total_floors
        ? `${listing.floor} / ${listing.total_floors}`
        : String(listing.floor),
    });
  }
  if (listing.condition) {
    fields.push({
      label: "Stav (Condition)",
      value: conditionLabels[listing.condition] || listing.condition,
    });
  }
  if (listing.construction) {
    fields.push({
      label: "Konstrukce (Construction)",
      value: constructionLabels[listing.construction] || listing.construction,
    });
  }
  if (listing.ownership) {
    fields.push({
      label: "Vlastnictv\u00ed (Ownership)",
      value: ownershipLabels[listing.ownership] || listing.ownership,
    });
  }
  if (listing.furnishing) {
    fields.push({
      label: "Vybavenost (Furnishing)",
      value: furnishingLabels[listing.furnishing] || listing.furnishing,
    });
  }
  if (listing.energy_rating) {
    fields.push({ label: "PENB (Energy)", value: listing.energy_rating });
  }

  const hasAmenities = listing.amenities && listing.amenities.length > 0;
  const hasSeller =
    listing.seller_name ||
    listing.seller_phone ||
    listing.seller_email ||
    listing.seller_company;

  return (
    <>
      {fields.length > 0 && (
        <div className="modal-details">
          <div className="detail-grid">
            {fields.map((field) => (
              <div key={field.label} className="detail-item">
                <div className="detail-item-label">{field.label}</div>
                <div className="detail-item-value">{field.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasAmenities && (
        <div className="modal-amenities">
          <h3>Vybaven\u00ed (Amenities)</h3>
          <div className="amenity-tags">
            {listing.amenities.map((a) => (
              <span key={a} className="amenity-tag">
                {amenityLabels[a] || a}
              </span>
            ))}
          </div>
        </div>
      )}

      {hasSeller && (
        <div className="modal-seller">
          <h3>Prod\u00e1vaj\u00edc\u00ed (Seller)</h3>
          <div className="seller-grid">
            {listing.seller_name && (
              <div className="seller-item">
                <strong>Jm\u00e9no:</strong> {listing.seller_name}
              </div>
            )}
            {listing.seller_company && (
              <div className="seller-item">
                <strong>Firma:</strong> {listing.seller_company}
              </div>
            )}
            {listing.seller_phone && (
              <div className="seller-item">
                <strong>Telefon:</strong>{" "}
                <a href={`tel:${listing.seller_phone}`}>
                  {listing.seller_phone}
                </a>
              </div>
            )}
            {listing.seller_email && (
              <div className="seller-item">
                <strong>E-mail:</strong>{" "}
                <a href={`mailto:${listing.seller_email}`}>
                  {listing.seller_email}
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
