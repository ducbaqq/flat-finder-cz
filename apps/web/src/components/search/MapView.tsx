"use client";

import { useEffect, useCallback, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  CircleMarker,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { useUiStore } from "@/store/ui-store";
import { useMarkers } from "@/hooks/useMarkers";
import { apiGet } from "@/lib/api-client";

// ── Price formatting ──

function formatMarkerPrice(price: number): string {
  if (price >= 1_000_000) {
    const m = price / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (price >= 1_000) {
    const k = price / 1_000;
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(0)}K`;
  }
  return String(price);
}

function createPriceIcon(price: number) {
  const label = formatMarkerPrice(price);
  return L.divIcon({
    className: "",
    html: `<div class="custom-marker-price">${label}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

const dotIcon = L.divIcon({
  className: "",
  html: '<div class="custom-marker-dot"></div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

// ── Cluster display helpers ──

function formatClusterCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function clusterRadius(count: number): number {
  return Math.min(35, 12 + Math.log10(count) * 8);
}

// ── Lazy hover tooltip — fetches preview on first hover ──

interface PreviewData {
  title: string | null;
  thumbnail_url: string | null;
}

const previewCache = new Map<number, PreviewData>();

function HoverTooltip({ id }: { id: number }) {
  const [preview, setPreview] = useState<PreviewData | null>(
    previewCache.get(id) ?? null
  );

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    apiGet<PreviewData>(`/markers/preview/${id}`).then((data) => {
      if (cancelled) return;
      previewCache.set(id, data);
      setPreview(data);
    });
    return () => { cancelled = true; };
  }, [id, preview]);

  if (!preview || (!preview.title && !preview.thumbnail_url)) return null;

  return (
    <Tooltip direction="top" offset={[0, -10]} className="marker-hover-tooltip">
      <div className="marker-tooltip-inner">
        {preview.thumbnail_url && (
          <img src={preview.thumbnail_url} alt="" className="marker-tooltip-img" />
        )}
        {preview.title && (
          <div className="marker-tooltip-title">{preview.title}</div>
        )}
      </div>
    </Tooltip>
  );
}

// ── Map event handler — sets bounds + zoom on mount + moveend ──

function MapEventsHandler() {
  const setMapBounds = useUiStore((s) => s.setMapBounds);
  const setMapZoom = useUiStore((s) => s.setMapZoom);
  const map = useMap();

  const updateBounds = useCallback(() => {
    const b = map.getBounds();
    setMapBounds({
      sw_lat: parseFloat(b.getSouthWest().lat.toFixed(6)),
      sw_lng: parseFloat(b.getSouthWest().lng.toFixed(6)),
      ne_lat: parseFloat(b.getNorthEast().lat.toFixed(6)),
      ne_lng: parseFloat(b.getNorthEast().lng.toFixed(6)),
    });
    setMapZoom(map.getZoom());
  }, [map, setMapBounds, setMapZoom]);

  useEffect(() => {
    updateBounds();
  }, [updateBounds]);

  useMapEvents({
    moveend() {
      updateBounds();
    },
  });

  return null;
}

// ── Marker layer — renders server-side clusters + individual points ──

// Zoom threshold: at this level and above, show pin dots instead of price labels
const PIN_ONLY_ZOOM = 16;

function MarkerLayer({ filters }: { filters: Record<string, string> }) {
  const map = useMap();
  const openDetail = useUiStore((s) => s.openDetail);
  const mapZoom = useUiStore((s) => s.mapZoom);
  const { data } = useMarkers(filters);

  const clusters = data?.clusters ?? [];
  const markers = data?.markers ?? [];
  const useDots = (mapZoom ?? map.getZoom()) >= PIN_ONLY_ZOOM;

  return (
    <>
      {/* Server-side clusters */}
      {clusters.map((cluster) => (
        <CircleMarker
          key={`cl-${cluster.lat}-${cluster.lng}`}
          center={[cluster.lat, cluster.lng]}
          radius={clusterRadius(cluster.count)}
          pathOptions={{
            fillColor: "#0F766E",
            fillOpacity: 0.7,
            color: "#0D6359",
            weight: 2,
          }}
          eventHandlers={{
            click: () => {
              const z = map.getZoom();
              map.setView([cluster.lat, cluster.lng], Math.min(z + 2, 18));
            },
          }}
        >
          <Tooltip
            direction="center"
            permanent
            className="cluster-count-tooltip"
          >
            {formatClusterCount(cluster.count)}
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Individual points — dots at high zoom, price labels otherwise */}
      {markers.map((pt) => {
        const icon =
          useDots || pt.price == null ? dotIcon : createPriceIcon(pt.price);
        return (
          <Marker
            key={`pt-${pt.id}`}
            position={[pt.lat, pt.lng]}
            icon={icon}
            eventHandlers={{
              click: () => openDetail(pt.id),
            }}
          >
            <HoverTooltip id={pt.id} />
          </Marker>
        );
      })}
    </>
  );
}

// ── Main MapView ──

interface MapViewProps {
  filters: Record<string, string>;
}

export function MapView({ filters }: MapViewProps) {
  return (
    <MapContainer
      center={[50.0755, 14.4378]}
      zoom={12}
      zoomControl
      attributionControl
      style={{ width: "100%", height: "100%" }}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
        subdomains="abcd"
        maxZoom={20}
      />
      <MapEventsHandler />
      <MarkerLayer filters={filters} />
    </MapContainer>
  );
}
