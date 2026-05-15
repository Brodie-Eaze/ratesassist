"use client";

/**
 * MeasureTool — click-to-measure overlay layer.
 *
 * Single responsibility: handle the click-to-measure interaction. Records
 * clicked points while `active`, draws a polyline (for distance) or polygon
 * (for area) atop the map, and renders a permanent Leaflet tooltip at the
 * centroid with the measurement label.
 *
 * Interaction:
 *   - 1 click   → "Click again to measure distance…"
 *   - 2 clicks  → geodesic distance in m / km
 *   - 3+ clicks → geodesic area in ha + m²
 *   - dbl-click → clear, deactivate via `onClear`
 *
 * Self-contained Leaflet integration: cleans up its own tooltip on unmount.
 */

import { useEffect, useState } from "react";
import L from "leaflet";
import {
  Polygon as RLPolygon,
  Polyline as RLPolyline,
  CircleMarker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import {
  haversineDistanceM,
  geodesicAreaM2,
  m2ToHa,
  type Ring,
} from "@/lib/polygonClip";

export type MeasureToolProps = {
  /** When false, the tool ignores clicks and renders nothing. */
  active: boolean;
  /** Called when the user double-clicks to clear & exit. */
  onClear: () => void;
};

export default function MeasureTool({
  active,
  onClear,
}: MeasureToolProps): JSX.Element | null {
  const [points, setPoints] = useState<Array<[number, number]>>([]);

  // Single-click adds a point while active.
  useMapEvents({
    click: (e) => {
      if (!active) return;
      setPoints((p) => [...p, [e.latlng.lat, e.latlng.lng]]);
    },
    // Double-click clears + deactivates.
    dblclick: () => {
      if (!active) return;
      setPoints([]);
      onClear();
    },
  });

  // Reset points when the tool toggles off.
  useEffect(() => {
    if (!active) setPoints([]);
  }, [active]);

  if (!active || points.length === 0) return null;

  // Build the [lng, lat] ring for the geodesic helpers, while keeping the
  // [lat, lng] form for Leaflet positions.
  const ring: Ring = points.map(([lat, lng]) => [lng, lat]);
  let label = "";
  if (points.length === 1) {
    label = "Click again to measure distance…";
  } else if (points.length === 2) {
    const d = haversineDistanceM(ring[0]!, ring[1]!);
    label = d < 1000 ? `${d.toFixed(0)} m` : `${(d / 1000).toFixed(2)} km`;
  } else {
    const m2 = geodesicAreaM2(ring);
    label = `${m2ToHa(m2).toFixed(2)} ha (${m2.toFixed(0)} m²)`;
  }

  const midLat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const midLng = points.reduce((s, p) => s + p[1], 0) / points.length;

  return (
    <>
      {points.length >= 3 ? (
        <RLPolygon
          positions={points}
          pathOptions={{
            color: "#22d3ee",
            fillColor: "#22d3ee",
            fillOpacity: 0.15,
            weight: 2,
            dashArray: "4 4",
          }}
        />
      ) : (
        <RLPolyline
          positions={points}
          pathOptions={{ color: "#22d3ee", weight: 3, dashArray: "4 4" }}
        />
      )}
      {points.map((p, i) => (
        <CircleMarker
          key={i}
          center={p}
          radius={4}
          pathOptions={{
            color: "#0e7490",
            fillColor: "#22d3ee",
            fillOpacity: 1,
            weight: 2,
          }}
        />
      ))}
      <MeasureLabel position={[midLat, midLng]} text={label} />
    </>
  );
}

function MeasureLabel({
  position,
  text,
}: {
  position: [number, number];
  text: string;
}): null {
  const map = useMap();
  useEffect(() => {
    const tip = L.tooltip({
      permanent: true,
      direction: "center",
      className: "ratesassist-measure-tip",
    })
      .setLatLng(position)
      .setContent(text)
      .addTo(map);
    return () => {
      tip.remove();
    };
  }, [map, position, text]);
  return null;
}
