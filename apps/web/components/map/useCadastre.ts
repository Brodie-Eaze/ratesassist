/**
 * useCadastre — orchestrator hook that resolves parcel polygons.
 *
 * Single responsibility: given an optional caller-supplied parcel set OR a
 * tenement to derive a bbox from, hydrate a {@link Geometry}[] of parcel
 * polygons and a {@link CadastreSource} label. Priority order:
 *
 *   1. Provided `parcels` prop → use directly, label "prop".
 *   2. Live SLIP cadastre query → fetch via /api/spatial/cadastre, label "live".
 *   3. Fallback → synthetic stand-in polygon at the tenement centre, label
 *      "synthetic" so the UI can surface "real cadastre unavailable".
 *
 * The fetch is bbox-keyed and cached for the lifetime of the page.
 */

import { useEffect, useState } from "react";
import L from "leaflet";
import type { Ring } from "@/lib/polygonClip";
import type { CadastreSource, Geometry } from "./types";

const cadastreCache = new Map<string, Geometry[]>();

function geometryToRings(geom: Geometry): Ring[] {
  if (geom.type === "Point") {
    const [lng, lat] = geom.coordinates;
    const d = 0.0008;
    return [
      [
        [lng - d, lat - d],
        [lng + d, lat - d],
        [lng + d, lat + d],
        [lng - d, lat + d],
      ],
    ];
  }
  const polys: number[][][][] =
    geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const rings: Ring[] = [];
  for (const poly of polys) {
    if (poly[0]) {
      rings.push(poly[0].map((p) => [p[0]!, p[1]!] as [number, number]));
    }
  }
  return rings;
}

function boundsOf(rings: Ring[]): L.LatLngBounds | null {
  if (rings.length === 0) return null;
  const pts: Array<[number, number]> = [];
  for (const ring of rings) for (const [lng, lat] of ring) pts.push([lat, lng]);
  if (pts.length === 0) return null;
  return L.latLngBounds(pts);
}

async function fetchCadastreForBounds(
  bbox: [number, number, number, number],
  cacheKey: string,
  signal?: AbortSignal,
): Promise<Geometry[]> {
  const cached = cadastreCache.get(cacheKey);
  if (cached) return cached;
  try {
    const r = await fetch(
      `/api/spatial/cadastre?bbox=${bbox.join(",")}&limit=20`,
      { signal },
    );
    if (!r.ok) return [];
    const j = (await r.json()) as {
      ok?: boolean;
      features?: Array<{ geometry?: Geometry }>;
    };
    if (!j.ok || !Array.isArray(j.features)) return [];
    const polys = j.features
      .map((f) => f.geometry)
      .filter(
        (g): g is Geometry =>
          !!g && (g.type === "Polygon" || g.type === "MultiPolygon"),
      );
    cadastreCache.set(cacheKey, polys);
    return polys;
  } catch {
    return [];
  }
}

export type UseCadastreResult = {
  /** The parcel polygons to render. */
  cadastre: Geometry[];
  /** Where they came from — drives the stats card label. */
  source: CadastreSource;
};

export type UseCadastreInput = {
  tenement?: { geometry: Geometry } | null;
  parcels?: ReadonlyArray<{ geometry: Geometry }>;
};

export function useCadastre({
  tenement,
  parcels,
}: UseCadastreInput): UseCadastreResult {
  const [cadastre, setCadastre] = useState<Geometry[]>([]);
  const [source, setSource] = useState<CadastreSource>("synthetic");

  useEffect(() => {
    if (parcels && parcels.length > 0) {
      setCadastre(parcels.map((p) => p.geometry));
      setSource("prop");
      return;
    }
    if (!tenement) return;
    const tenRings = geometryToRings(tenement.geometry);
    const b = boundsOf(tenRings);
    if (!b) return;
    const bbox: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ];
    const key = bbox.map((n) => n.toFixed(4)).join(",");
    const ctrl = new AbortController();
    void fetchCadastreForBounds(bbox, key, ctrl.signal).then((polys) => {
      if (ctrl.signal.aborted) return;
      if (polys.length === 0) {
        // Synthetic stand-in — a small square slightly inset from the
        // tenement centre. Honest label surfaced in the stats card.
        const centre = b.getCenter();
        const d = 0.0015;
        setCadastre([
          {
            type: "Polygon",
            coordinates: [
              [
                [centre.lng - d, centre.lat - d],
                [centre.lng + d, centre.lat - d],
                [centre.lng + d, centre.lat + d],
                [centre.lng - d, centre.lat + d],
                [centre.lng - d, centre.lat - d],
              ],
            ],
          },
        ]);
        setSource("synthetic");
      } else {
        setCadastre(polys);
        setSource("live");
      }
    });
    return () => {
      ctrl.abort();
    };
  }, [tenement, parcels]);

  return { cadastre, source };
}

// Re-exported so the orchestrator only needs to import from this hook module.
export { geometryToRings, boundsOf };
