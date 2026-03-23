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
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${Math.round(count / 1_000)}k`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function clusterRadius(count: number): number {
  if (count <= 1) return 8;
  return Math.min(55, 18 + Math.log10(count) * 14);
}

function clusterColor(): { fill: string; stroke: string } {
  return {
    fill: "hsl(174, 65%, 38%)",
    stroke: "hsl(174, 65%, 28%)",
  };
}

function clusterFontSize(count: number): number {
  const r = clusterRadius(count);
  return Math.max(10, Math.min(18, Math.round(r * 0.55)));
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
        const isSmall = cluster.count <= 2;
        const colors = clusterColor();
        const radius = isSmall ? 6 : clusterRadius(cluster.count);
        const fontSize = clusterFontSize(cluster.count);

        return (
          <CircleMarker
            key={`cl-${cluster.lat}-${cluster.lng}`}
            center={[cluster.lat, cluster.lng]}
            radius={radius}
            pathOptions={{
              fillColor: colors.fill,
              fillOpacity: isSmall ? 0.5 : 0.65,
              color: colors.stroke,
              weight: 2,
            }}
            eventHandlers={{
              click: () => {
                if (cluster.cluster_id != null) {
                  // Fetch the exact zoom that splits this cluster
                  apiGet<{ zoom: number }>(`/markers/expansion-zoom/${cluster.cluster_id}`)
                    .then(({ zoom: expZoom }) => {
                      map.flyTo([cluster.lat, cluster.lng], Math.min(expZoom, 18), { duration: 0.5 });
                    })
                    .catch(() => {
                      map.flyTo([cluster.lat, cluster.lng], Math.min(map.getZoom() + 3, 18), { duration: 0.5 });
                    });
                } else {
                  map.flyTo([cluster.lat, cluster.lng], Math.min(map.getZoom() + 3, 18), { duration: 0.5 });
                }
              },
            }}
          >
            {!isSmall && (
              <Tooltip
                direction="center"
                permanent
                className="cluster-count-tooltip"
              >
                <span style={{ fontSize: `${fontSize}px` }}>
                  {formatClusterCount(cluster.count)}
                </span>
              </Tooltip>
            )}
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
