"use client";

import { useEffect, useCallback, useState, useRef } from "react";
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

const dotIcon = L.divIcon({
  className: "",
  html: '<div class="custom-marker-dot"></div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

// ── Cluster display helpers ──

function formatClusterCount(count: number): string {
  if (count >= 1_000_000) {
    const m = count / 1_000_000;
    return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`;
  }
  if (count >= 1_000) {
    const k = count / 1_000;
    return k >= 10 ? `${Math.round(k)}K` : `${k.toFixed(1)}K`;
  }
  return String(count);
}

/** Logarithmic scaling: 30px at count=2, up to 70px for very large clusters */
const CLUSTER_SIZE_MIN = 30;
const CLUSTER_SIZE_MAX = 70;

function clusterRadius(count: number): number {
  if (count <= 1) return CLUSTER_SIZE_MIN / 2;
  const logMin = Math.log(2);
  const logMax = Math.log(100_000);
  const t = Math.min(1, Math.max(0, (Math.log(count) - logMin) / (logMax - logMin)));
  return (CLUSTER_SIZE_MIN + t * (CLUSTER_SIZE_MAX - CLUSTER_SIZE_MIN)) / 2;
}

/** Color gradient: cool teal for small clusters -> warm orange/red for large */
function clusterColor(count: number): { fill: string; stroke: string } {
  const logMin = Math.log(2);
  const logMax = Math.log(100_000);
  const t = Math.min(1, Math.max(0, (Math.log(Math.max(2, count)) - logMin) / (logMax - logMin)));
  const hue = Math.round(174 - t * 159);
  const sat = Math.round(65 + t * 15);
  const light = Math.round(38 + t * 7);

  return {
    fill: `hsl(${hue}, ${sat}%, ${light}%)`,
    stroke: `hsl(${hue}, ${sat}%, ${Math.max(20, light - 10)}%)`,
  };
}

/** Font size scales with bubble radius */
function clusterFontSize(count: number): number {
  const r = clusterRadius(count);
  return Math.round(11 + ((r - 15) / 20) * 5);
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
      <div className="marker-tooltip-inner" data-testid="map-marker-tooltip">
        {preview.thumbnail_url && (
          <img src={preview.thumbnail_url} alt="" className="marker-tooltip-img" data-testid="map-marker-tooltip-image" />
        )}
        {preview.title && (
          <div className="marker-tooltip-title" data-testid="map-marker-tooltip-title">{preview.title}</div>
        )}
      </div>
    </Tooltip>
  );
}

// ── Geocode location filter and fly map to that area ──

const geocodeCache = new Map<string, L.LatLngBounds | null>();

function geocodeLocation(query: string): Promise<L.LatLngBounds | null> {
  const cached = geocodeCache.get(query);
  if (cached !== undefined) return Promise.resolve(cached);

  const url =
    `https://nominatim.openstreetmap.org/search?` +
    `q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=cz&accept-language=cs`;

  return fetch(url)
    .then((r) => (r.ok ? r.json() : []))
    .then((results: Array<{ boundingbox: [string, string, string, string] }>) => {
      if (results.length === 0) {
        geocodeCache.set(query, null);
        return null;
      }
      const bb = results[0].boundingbox;
      const bounds = L.latLngBounds(
        [parseFloat(bb[0]), parseFloat(bb[2])],
        [parseFloat(bb[1]), parseFloat(bb[3])],
      );
      geocodeCache.set(query, bounds);
      return bounds;
    })
    .catch(() => {
      geocodeCache.set(query, null);
      return null;
    });
}

function LocationFlyTo({ location }: { location?: string }) {
  const map = useMap();
  const appliedRef = useRef("");

  useEffect(() => {
    const query = location?.trim() ?? "";
    if (!query || query === appliedRef.current) return;

    let active = true;
    geocodeLocation(query).then((bounds) => {
      if (!active || !bounds) return;
      appliedRef.current = query;
      map.fitBounds(bounds, { maxZoom: 14 });
    });

    return () => { active = false; };
  }, [location, map]);

  return null;
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

function MarkerLayer({ filters }: { filters: Record<string, string> }) {
  const map = useMap();
  const openDetail = useUiStore((s) => s.openDetail);
  const { data } = useMarkers(filters);

  const clusters = data?.clusters ?? [];
  const markers = data?.markers ?? [];

  return (
    <>
      {/* Server-side clusters */}
      {clusters.map((cluster) => {
        const colors = clusterColor(cluster.count);
        const fontSize = clusterFontSize(cluster.count);
        return (
          <CircleMarker
            key={`cl-${cluster.lat}-${cluster.lng}`}
            center={[cluster.lat, cluster.lng]}
            radius={clusterRadius(cluster.count)}
            pathOptions={{
              fillColor: colors.fill,
              fillOpacity: 0.75,
              color: colors.stroke,
              weight: 2,
            }}
            eventHandlers={{
              click: () => {
                const targetZoom = cluster.expansion_zoom
                  ? Math.min(cluster.expansion_zoom, 18)
                  : Math.min(map.getZoom() + 3, 18);
                map.flyTo([cluster.lat, cluster.lng], targetZoom, {
                  duration: 0.5,
                });
              },
            }}
          >
            <Tooltip
              direction="center"
              permanent
              className="cluster-count-tooltip"
            >
              <span style={{ fontSize: `${fontSize}px` }}>
                {formatClusterCount(cluster.count)}
              </span>
            </Tooltip>
          </CircleMarker>
        );
      })}

      {/* Individual points */}
      {markers.map((pt) => (
          <Marker
            key={`pt-${pt.id}`}
            position={[pt.lat, pt.lng]}
            icon={dotIcon}
            eventHandlers={{
              click: () => openDetail(pt.id),
            }}
          >
            <HoverTooltip id={pt.id} />
          </Marker>
      ))}
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
      zoom={11}
      zoomControl
      attributionControl
      style={{ width: "100%", height: "100%" }}
      data-testid="map-view"
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
        subdomains="abcd"
        maxZoom={20}
      />
      <MapEventsHandler />
      <LocationFlyTo location={filters.location} />
      <MarkerLayer filters={filters} />
    </MapContainer>
  );
}
