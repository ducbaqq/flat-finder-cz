"use client";

import dynamic from "next/dynamic";
import { useFilterStore } from "@/store/filter-store";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "var(--color-surface-2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div className="seed-spinner" />
    </div>
  ),
});

export default function MapSection() {
  const mapCollapsed = useFilterStore((s) => s.mapCollapsed);
  const toggleMapCollapsed = useFilterStore((s) => s.toggleMapCollapsed);

  return (
    <div className={`map-section${mapCollapsed ? " collapsed" : ""}`}>
      <div className="map-header">
        <span className="map-label">Mapa (Map)</span>
        <button
          className="map-collapse-btn"
          onClick={toggleMapCollapsed}
          aria-label="Toggle map"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      <div className="map-container">
        <div id="map" style={{ width: "100%", height: "100%" }}>
          {!mapCollapsed && <MapView />}
        </div>
      </div>
    </div>
  );
}
