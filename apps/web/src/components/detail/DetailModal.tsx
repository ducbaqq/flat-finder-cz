"use client";

import { useEffect, useState, useCallback } from "react";
import { useFilterStore } from "@/store/filter-store";
import { apiGet } from "@/lib/api-client";
import type { Listing } from "@flat-finder/types";
import {
  formatPrice,
  buildSourceUrl,
  propertyTypeLabels,
} from "@/lib/utils";
import ImageGallery from "./ImageGallery";
import DetailGrid from "./DetailGrid";
import MiniMap from "./MiniMap";

export default function DetailModal() {
  const detailModalOpen = useFilterStore((s) => s.detailModalOpen);
  const selectedListingId = useFilterStore((s) => s.selectedListingId);
  const closeDetail = useFilterStore((s) => s.closeDetail);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!selectedListingId) return;

    setLoading(true);
    setError(false);
    setListing(null);

    apiGet<Listing>(`/listings/${selectedListingId}`)
      .then((data) => {
        setListing(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [selectedListingId]);

  useEffect(() => {
    if (detailModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [detailModalOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && detailModalOpen) {
        closeDetail();
      }
    },
    [detailModalOpen, closeDetail]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        closeDetail();
      }
    },
    [closeDetail]
  );

  if (!detailModalOpen) return null;

  const sourceUrl = listing ? buildSourceUrl(listing) : null;

  return (
    <div
      className="modal-overlay active"
      onClick={handleOverlayClick}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <button
          className="modal-close"
          onClick={closeDetail}
          aria-label="Close"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="modal-body">
          {loading && (
            <div
              style={{
                padding: "var(--space-8)",
                textAlign: "center",
              }}
            >
              <div className="seed-spinner" />
            </div>
          )}

          {error && (
            <p
              style={{
                padding: "var(--space-8)",
                textAlign: "center",
                color: "var(--color-error)",
              }}
            >
              Failed to load listing details.
            </p>
          )}

          {listing && (
            <>
              <ImageGallery images={listing.image_urls || []} />

              <div className="modal-header">
                <div
                  style={{
                    display: "flex",
                    gap: "var(--space-2)",
                    marginBottom: "var(--space-2)",
                  }}
                >
                  <span
                    className={`badge badge-source ${listing.source}`}
                  >
                    {listing.source}.cz
                  </span>
                  <span className="badge badge-type">
                    {propertyTypeLabels[listing.property_type] ||
                      listing.property_type}
                  </span>
                </div>
                <h2 className="modal-title">
                  {listing.title || "\u2014"}
                </h2>
                <div className="modal-price">
                  {formatPrice(listing.price, listing.currency)}
                  {listing.transaction_type === "rent" ? "/m\u011bs." : ""}
                  {listing.price_note && (
                    <span className="modal-price-note">
                      {listing.price_note}
                    </span>
                  )}
                </div>
                <div className="modal-address">
                  {listing.address || ""}, {listing.city || ""}
                </div>
              </div>

              <DetailGrid listing={listing} />

              {listing.description && (
                <div className="modal-description">
                  <h3>Popis (Description)</h3>
                  <p>{listing.description}</p>
                </div>
              )}

              {sourceUrl && (
                <div className="modal-source">
                  <a
                    className="source-link"
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    Zobrazit na {listing.source}.cz
                  </a>
                </div>
              )}

              {listing.latitude && listing.longitude && (
                <MiniMap
                  lat={listing.latitude}
                  lng={listing.longitude}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
