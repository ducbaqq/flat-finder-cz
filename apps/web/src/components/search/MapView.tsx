"use client";

import { useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import { useUiStore } from "@/store/ui-store";
import { useMarkers } from "@/hooks/useMarkers";
import { ListingPopup } from "./ListingPopup";

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
    popupAnchor: [0, -12],
  });
}

const dotIcon = L.divIcon({
  className: "",
  html: '<div class="custom-marker-dot"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createClusterIcon(cluster: any) {
  const count = cluster.getChildCount();
  let size: number;
  if (count < 10) size = 34;
  else if (count < 50) size = 40;
  else size = 46;
  return L.divIcon({
    html: "<div>" + count + "</div>",
    className: "marker-cluster",
    iconSize: L.point(size, size),
  });
}

function MapEventsHandler() {
  const setMapBounds = useUiStore((s) => s.setMapBounds);
  const isInitialMove = useRef(true);

  useMapEvents({
    moveend(e) {
      const map = e.target;
      const b = map.getBounds();
      setMapBounds({
        sw_lat: parseFloat(b.getSouthWest().lat.toFixed(6)),
        sw_lng: parseFloat(b.getSouthWest().lng.toFixed(6)),
        ne_lat: parseFloat(b.getNorthEast().lat.toFixed(6)),
        ne_lng: parseFloat(b.getNorthEast().lng.toFixed(6)),
      });
      if (isInitialMove.current) {
        isInitialMove.current = false;
      }
    },
  });

  return null;
}

function MarkerLayer({ filters }: { filters: Record<string, string> }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useMapEvents({
    zoomend() {
      setZoom(map.getZoom());
    },
  });

  const { data } = useMarkers({ filters, zoom });
  if (!data) return null;

  const showPrices = zoom >= 14;

  return (
    <MarkerClusterGroup
      maxClusterRadius={50}
      spiderfyOnMaxZoom
      showCoverageOnHover={false}
      zoomToBoundsOnClick
      iconCreateFunction={createClusterIcon}
    >
      {data.markers.map((cluster) =>
        cluster.listings.map((listing) => {
          const lat = listing.lat || cluster.lat;
          const lng = listing.lng || cluster.lng;
          const icon =
            showPrices && listing.price
              ? createPriceIcon(listing.price)
              : dotIcon;
          return (
            <Marker key={listing.id} position={[lat, lng]} icon={icon}>
              <Popup maxWidth={280} minWidth={260} className="custom-popup">
                <ListingPopup listing={listing} />
              </Popup>
            </Marker>
          );
        })
      )}
    </MarkerClusterGroup>
  );
}

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
