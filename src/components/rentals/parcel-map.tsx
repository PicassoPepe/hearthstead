"use client";

import * as React from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";

type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: unknown };

/**
 * Parcel outline on a street or satellite map (Leaflet + OpenStreetMap / Esri World Imagery).
 * The outline comes from county GIS data — approximate, not a survey (the caption says so).
 */
export function ParcelMap({ geometry, latitude, longitude, label, className = "h-72" }: { geometry: Geometry | null; latitude: number | null; longitude: number | null; label: string; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const map = React.useRef<LeafletMap | null>(null);
  const [layer, setLayer] = React.useState<"street" | "satellite">("satellite");
  const layers = React.useRef<Record<string, import("leaflet").TileLayer>>({});

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current || map.current) return;
      const m = L.map(ref.current, { scrollWheelZoom: false, attributionControl: true });
      map.current = m;
      layers.current.street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" });
      layers.current.satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" });
      layers.current.satellite.addTo(m);
      if (geometry) {
        const shape = L.geoJSON({ type: "Feature", properties: {}, geometry } as GeoJSON.Feature, { style: { color: "#f59e0b", weight: 3, fillColor: "#f59e0b", fillOpacity: 0.15 } }).addTo(m);
        m.fitBounds(shape.getBounds(), { padding: [24, 24], maxZoom: 19 });
      } else if (latitude !== null && longitude !== null) {
        L.circleMarker([latitude, longitude], { radius: 8, color: "#f59e0b", weight: 3 }).addTo(m);
        m.setView([latitude, longitude], 17);
      } else {
        m.setView([37.8, -85.7], 7); // Kentucky
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [geometry, latitude, longitude]);

  React.useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const [k, l] of Object.entries(layers.current)) {
      if (k === layer) l.addTo(m);
      else l.remove();
    }
  }, [layer]);

  return (
    <figure className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="relative">
        <div ref={ref} role="img" aria-label={`Map of the parcel for ${label}`} className={`${className} w-full bg-surface-muted`} />
        <div className="absolute right-2 top-2 z-[400] flex overflow-hidden rounded-lg border border-border bg-surface text-xs font-medium shadow">
          {(["satellite", "street"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={layer === k} onClick={() => setLayer(k)} className={layer === k ? "bg-primary px-2.5 py-1.5 text-primary-foreground" : "px-2.5 py-1.5 hover:bg-surface-muted"}>
              {k === "satellite" ? "Satellite" : "Map"}
            </button>
          ))}
        </div>
      </div>
      <figcaption className="px-3 py-2 text-xs text-muted-foreground">
        {geometry ? "Parcel outline from county GIS records — approximate, not a survey." : "No parcel outline on file — showing the address location."}
      </figcaption>
    </figure>
  );
}
