"use client";

import { useEffect, useState } from "react";

interface MiniMapProps {
  lat: number;
  lng: number;
}

export default function MiniMap({ lat, lng }: MiniMapProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    let map: L.Map | null = null;

    const init = async () => {
      const L = (await import("leaflet")).default;

      const container = document.getElementById("detailMapContainer");
      if (!container) return;

      map = L.map(container, {
        center: [lat, lng],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
      });
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        { subdomains: "abcd", maxZoom: 20 }
      ).addTo(map);
      L.marker([lat, lng]).addTo(map);
    };

    const timer = setTimeout(init, 100);

    return () => {
      clearTimeout(timer);
      if (map) map.remove();
    };
  }, [mounted, lat, lng]);

  return (
    <div
      className="overflow-hidden rounded-lg border"
      id="detailMapContainer"
      style={{ height: 200 }}
      data-testid="listing-detail-minimap"
    />
  );
}
