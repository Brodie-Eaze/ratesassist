"use client";

/**
 * PropertyMap — the council-CFO-grade map experience.
 *
 * Orchestrator: state, composition, fly-to. Rendering and side effects live
 * in the sub-components / hook under ./map/. Reused on
 * /alerts/[tenementId] (focusMode="tenement") and
 * /recovery/[assessment] (focusMode="parcel").
 *
 * Honest source labelling: if the SLIP cadastre query returns no geometry,
 * the parcel layer falls back to a synthetic stand-in polygon and the stats
 * card surfaces "Synthetic (real cadastre unavailable)".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  GeoJSON as RLGeoJSON,
  ScaleControl,
  useMap,
} from "react-leaflet";
import { overlapStats, type Ring } from "@/lib/polygonClip";
import { probeSlipAerial } from "@/lib/slipBasemapProbe";

import BasemapLayer from "./map/BasemapLayer";
import PolygonLayers from "./map/PolygonLayers";
import MapToolbar from "./map/MapToolbar";
import StatsCard from "./map/StatsCard";
import CursorReadout from "./map/CursorReadout";
import MeasureTool from "./map/MeasureTool";
import MapChrome from "./map/MapChrome";
import { useCadastre, geometryToRings, boundsOf } from "./map/useCadastre";
import {
  type BasemapKey,
  type Geometry,
  type OverlapStats,
  type PropertyMapFocus,
  type PropertyMapStats,
  type SlipAerialProbeResult,
  type ZoomTarget,
} from "./map/types";

// Re-export public types so existing consumers can keep importing them
// from "@/components/PropertyMap".
export type { Geometry, PropertyMapFocus, PropertyMapStats };

export type PropertyMapProps = {
  focusMode: PropertyMapFocus;
  /** The tenement polygon (DMIRS). Always passed for both focus modes. */
  tenement?: {
    id: string;
    idDisplay?: string;
    geometry: Geometry;
    holder?: string;
  } | null;
  /** Optional pre-resolved parcel polygons (avoids the SLIP fetch). */
  parcels?: ReadonlyArray<{ id: string; geometry: Geometry }>;
  /** Optional assessment number — used to fetch cadastre via the SLIP proxy. */
  assessmentNumber?: string;
  /** Stats card content. */
  stats?: PropertyMapStats;
  /** "Click to open evidence pack →" target. */
  evidenceHref?: string;
  /** Height of the map container — defaults to 100% of its parent. */
  height?: string;
};

// ---- FlyTo control --------------------------------------------------------

function FlyTo({ bounds }: { bounds: L.LatLngBounds | null }): null {
  const map = useMap();
  useEffect(() => {
    if (!bounds || !bounds.isValid()) return;
    // Cap fly-to zoom at 17 — beyond that, Esri imagery falls through to
    // the "Map data not yet available" placeholder for remote WA. The user
    // can still scroll-zoom further; tiles will upsample.
    map.flyToBounds(bounds, {
      duration: 0.6,
      easeLinearity: 0.25,
      padding: [40, 40],
      maxZoom: 17,
    });
    const t = setTimeout(() => map.invalidateSize(), 300);
    return () => clearTimeout(t);
  }, [bounds, map]);
  return null;
}

// ---- Main orchestrator ----------------------------------------------------

export default function PropertyMap({
  focusMode,
  tenement,
  parcels,
  stats,
  evidenceHref,
  height,
}: PropertyMapProps): JSX.Element {
  // Default to Sentinel-2 Live — rolling latest cloud-free scene (Esri
  // Living Atlas, ~14-day freshness). This is the council edge: clerks
  // open a property and see imagery captured WITHIN THE FORTNIGHT, not the
  // 1-3-year-old composite Esri World Imagery / EOX cloudless mosaic ships.
  // The older yearly composite is one click away if the latest scene has
  // cloud cover over the target.
  const [basemap, setBasemap] = useState<BasemapKey>("sentinel-latest");
  const [statsOpen, setStatsOpen] = useState(true);
  const [measureOn, setMeasureOn] = useState(false);
  const [slipProbe, setSlipProbe] = useState<SlipAerialProbeResult | null>(null);
  const [zoomTarget, setZoomTarget] = useState<ZoomTarget>(
    focusMode === "parcel" ? "parcel" : "all",
  );

  // Read ?print=1 client-side only so server-rendered HTML and the first
  // client render match (no hydration mismatch).
  const [isPrint, setIsPrint] = useState(false);
  useEffect(() => {
    setIsPrint(
      new URLSearchParams(window.location.search).get("print") === "1",
    );
  }, []);

  // Probe SLIP aerial once on mount.
  useEffect(() => {
    let alive = true;
    void probeSlipAerial().then((r) => {
      if (alive) setSlipProbe(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Resolve parcel polygons.
  const { cadastre, source: cadastreSource } = useCadastre({
    ...(tenement ? { tenement } : {}),
    ...(parcels ? { parcels } : {}),
  });

  const tenementRings = useMemo<Ring[]>(
    () => (tenement ? geometryToRings(tenement.geometry) : []),
    [tenement],
  );
  const parcelRings = useMemo<Ring[][]>(
    () => cadastre.map((g) => geometryToRings(g)),
    [cadastre],
  );

  const overlap = useMemo<OverlapStats | null>(() => {
    if (tenementRings.length === 0 || parcelRings.length === 0) return null;
    const ten = tenementRings[0]!;
    for (const p of parcelRings) {
      const pr = p[0];
      if (!pr) continue;
      const s = overlapStats(ten, pr);
      if (s) return s;
    }
    return null;
  }, [tenementRings, parcelRings]);

  const flyBounds = useMemo<L.LatLngBounds | null>(() => {
    if (zoomTarget === "parcel" && parcelRings.length > 0) {
      return boundsOf(parcelRings.flat());
    }
    if (zoomTarget === "tenement" && tenementRings.length > 0) {
      return boundsOf(tenementRings);
    }
    return boundsOf([...tenementRings, ...parcelRings.flat()]);
  }, [zoomTarget, tenementRings, parcelRings]);

  const initialCentre: [number, number] = useMemo(() => {
    const b = boundsOf([...tenementRings, ...parcelRings.flat()]);
    if (b) {
      const c = b.getCenter();
      return [c.lat, c.lng];
    }
    return [-25.27, 133.78];
  }, [tenementRings, parcelRings]);

  const handlePrint = useCallback(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("print", "1");
    window.open(u.toString(), "_blank");
  }, []);

  return (
    <div
      style={{
        position: "relative",
        height: isPrint ? 800 : height ?? "100%",
        width: isPrint ? 1200 : "100%",
      }}
    >
      <MapContainer
        center={initialCentre}
        zoom={12}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        preferCanvas
        doubleClickZoom={!measureOn}
      >
        <BasemapLayer basemap={basemap} slipProbe={slipProbe} />
        <ScaleControl position="bottomleft" metric imperial={false} />
        <FlyTo bounds={flyBounds} />
        <CursorReadout isPrint={isPrint} />
        <MeasureTool active={measureOn} onClear={() => setMeasureOn(false)} />
        <PolygonLayers
          tenementRings={tenementRings}
          parcelRings={parcelRings}
          overlap={overlap}
        />
      </MapContainer>

      <MapToolbar
        activeBasemap={basemap}
        onBasemapChange={setBasemap}
        slipProbe={slipProbe}
        zoomTarget={zoomTarget}
        onZoomTargetChange={setZoomTarget}
        hasParcel={parcelRings.length > 0}
        hasTenement={tenementRings.length > 0}
        measureOn={measureOn}
        onMeasureToggle={() => setMeasureOn((v) => !v)}
        onPrint={handlePrint}
      />

      <StatsCard
        open={statsOpen}
        onToggle={() => setStatsOpen((v) => !v)}
        stats={stats}
        cadastreSource={cadastreSource}
        overlap={overlap}
        evidenceHref={evidenceHref}
      />

      <MapChrome statsOpen={statsOpen} isPrint={isPrint} />
    </div>
  );
}

// react-leaflet types — keep import live (RLGeoJSON is exported but unused in
// the simplified body; we re-export GeoJSON for parity with PortfolioMap).
export const __RLGeoJSON = RLGeoJSON;
