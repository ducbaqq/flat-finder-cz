"use client";

import { useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import { useFilterStore } from "@/store/filter-store";
import { useMarkers } from "@/hooks/useMarkers";
import ListingPopup from "./ListingPopup";

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
  let className: string;
  if (count < 10) {
    size = 34;
    className = "marker-cluster-small";
  } else if (count < 50) {
    size = 40;
    className = "marker-cluster-medium";
  } else {
    size = 46;
    className = "marker-cluster-large";
  }
  return L.divIcon({
    html: "<div>" + count + "</div>",
    className: "marker-cluster " + className,
    iconSize: L.point(size, size),
  });
}

function MapEventsHandler() {
  const setMapBounds = useFilterStore((s) => s.setMapBounds);
  const setPage = useFilterStore((s) => s.setPage);
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
      } else {
        setPage(1);
      }
    },
  });

  return null;
}

function MarkerLayer() {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useMapEvents({
    zoomend() {
      setZoom(map.getZoom());
    },
  });

  const { data } = useMarkers(zoom);

  if (!data) return null;

  const showPrices = zoom >= 14;

  return (
    <MarkerClusterGroup
      maxClusterRadius={50}
      spiderfyOnMaxZoom={true}
      showCoverageOnHover={false}
      zoomToBoundsOnClick={true}
      iconCreateFunction={createClusterIcon}
    >
      {data.markers.map((cluster) =>
        cluster.listings.map((listing) => {
          const lat = listing.lat || cluster.lat;
          const lng = listing.lng || cluster.lng;
          const icon = showPrices && listing.price
            ? createPriceIcon(listing.price)
            : dotIcon;
          return (
            <Marker
              key={listing.id}
              position={[lat, lng]}
              icon={icon}
            >
              <Popup
                maxWidth={280}
                minWidth={230}
                className="custom-popup"
              >
                <ListingPopup listing={listing} />
              </Popup>
            </Marker>
          );
        })
      )}
    </MarkerClusterGroup>
  );
}

export default function MapView() {
  return (
    <MapContainer
      center={[50.0755, 14.4378]}
      zoom={12}
      zoomControl={true}
      attributionControl={true}
      style={{ width: "100%", height: "100%" }}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
        subdomains="abcd"
        maxZoom={20}
      />
      <MapEventsHandler />
      <MarkerLayer />
    </MapContainer>
  );
}
