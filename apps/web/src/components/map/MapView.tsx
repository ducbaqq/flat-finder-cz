"use client";

import { useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import { useFilterStore } from "@/store/filter-store";
import { useMarkers } from "@/hooks/useMarkers";
import ListingPopup from "./ListingPopup";

const tealIcon = L.divIcon({
  className: "custom-marker",
  html: '<div style="width:12px;height:12px;background:var(--color-primary,#0D9488);border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createClusterIcon(cluster: any) {
  const count = cluster.getChildCount();
  let size: number;
  let className: string;
  if (count < 10) {
    size = 36;
    className = "marker-cluster-small";
  } else if (count < 50) {
    size = 42;
    className = "marker-cluster-medium";
  } else {
    size = 48;
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
          return (
            <Marker
              key={listing.id}
              position={[lat, lng]}
              icon={tealIcon}
            >
              <Popup
                maxWidth={260}
                minWidth={220}
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
