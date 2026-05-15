"use client";

/**
 * PolygonLayers — renders the tenement (amber), parcel (red), and overlap
 * (gold) polygons.
 *
 * Single responsibility: turn already-computed rings into Leaflet polygons.
 * Computes nothing — the caller is responsible for converting source
 * Geometry into Ring[] / Ring[][] and for computing overlap stats.
 *
 * No-op when all inputs are empty / null — safe to mount with absent
 * geometries (e.g. before the cadastre query resolves).
 */

import { Polygon as RLPolygon } from "react-leaflet";
import type { Ring } from "@/lib/polygonClip";
import type { OverlapStats } from "./types";

export type PolygonLayersProps = {
  /** The tenement polygon rings (DMIRS source). */
  tenementRings: ReadonlyArray<Ring>;
  /** The parcel polygon rings (one Ring[] per parcel). */
  parcelRings: ReadonlyArray<ReadonlyArray<Ring>>;
  /** The pre-computed overlap polygon, if any. */
  overlap: OverlapStats | null;
};

function ringToLatLng(ring: Ring): Array<[number, number]> {
  return ring.map(([lng, lat]) => [lat, lng]);
}

export default function PolygonLayers({
  tenementRings,
  parcelRings,
  overlap,
}: PolygonLayersProps): JSX.Element {
  return (
    <>
      {/* Tenement polygon — amber */}
      {tenementRings.map((ring, i) => (
        <RLPolygon
          key={`ten-${i}`}
          positions={ringToLatLng(ring)}
          pathOptions={{
            color: "#b45309",
            fillColor: "#f59e0b",
            fillOpacity: 0.25,
            weight: 2,
          }}
        />
      ))}

      {/* Parcel polygons — red, animated dashed stroke */}
      {parcelRings.map((rings, i) =>
        rings.map((ring, j) => (
          <RLPolygon
            key={`parcel-${i}-${j}`}
            positions={ringToLatLng(ring)}
            pathOptions={{
              color: "#dc2626",
              fillColor: "#dc2626",
              fillOpacity: 0.15,
              weight: 3,
              dashArray: "8 6",
              className: "ratesassist-parcel-stroke",
            }}
          />
        )),
      )}

      {/* Overlap polygon — gold */}
      {overlap && (
        <RLPolygon
          positions={ringToLatLng(overlap.ring)}
          pathOptions={{
            color: "#ca8a04",
            fillColor: "#facc15",
            fillOpacity: 0.35,
            weight: 2,
          }}
        />
      )}
    </>
  );
}
