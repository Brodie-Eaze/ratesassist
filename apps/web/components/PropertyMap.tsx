"use client";

/**
 * PropertyMap — the council-CFO-grade map experience.
 *
 * Reused on:
 *   - /alerts/[tenementId]  (focusMode="tenement")
 *   - /recovery/[assessment] (focusMode="parcel")
 *
 * Hero features:
 *   1.  Hybrid / Satellite / Street / Topo / SLIP basemap toggles
 *   2.  Real Landgate cadastre parcel polygon (red, animated-dash stroke)
 *   3.  Sutherland-Hodgman overlap polygon (gold) with area + percent badge
 *   4.  Smooth flyToBounds transitions
 *   5.  Inline stats card top-right (collapsible)
 *   6.  Scale bar + click-to-measure tool
 *   7.  "Zoom to parcel" / "Zoom to tenement" buttons
 *   8.  North arrow + live cursor lat/lng readout
 *   9.  Print mode (?print=1) — fixed 1200×800 + watermark
 *   10. Self-explanatory legend bottom-left
 *
 * Honest source labelling: if the SLIP cadastre query returns no geometry,
 * the parcel layer falls back to a synthetic stand-in polygon and the stats
 * card surfaces "SOURCE: Synthetic parcel (real cadastre unavailable)".
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  GeoJSON as RLGeoJSON,
  Polygon as RLPolygon,
  Polyline as RLPolyline,
  CircleMarker,
  ScaleControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { ChevronDown, ChevronUp, Ruler, Printer, Compass } from "lucide-react";
import {
  overlapStats,
  geodesicAreaM2,
  haversineDistanceM,
  m2ToHa,
  type Ring,
} from "@/lib/polygonClip";
import {
  probeSlipAerial,
  type SlipAerialProbeResult,
} from "@/lib/slipBasemapProbe";

// =================================================================
// Types
// =================================================================

export type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "Point"; coordinates: number[] };

export type PropertyMapFocus = "tenement" | "parcel";

export type PropertyMapStats = {
  assessmentNumber?: string;
  address?: string;
  landUse?: string;
  valuation?: number;
  currentAnnualRates?: number;
  projectedAnnualRates?: number;
  estimatedUplift?: number;
};

export type PropertyMapProps = {
  focusMode: PropertyMapFocus;
  /** The tenement polygon (DMIRS). Always passed for both focus modes. */
  tenement?: { id: string; idDisplay?: string; geometry: Geometry; holder?: string } | null;
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

// =================================================================
// Basemap registry — kept inline so the component is self-contained.
// =================================================================

type BasemapKey =
  | "hybrid"
  | "satellite"
  | "sentinel"
  | "street"
  | "topo"
  | "slip-aerial";

const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_REF =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const ESRI_TOPO =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}";
const CARTO_LIGHT =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

// Sentinel-2 cloudless mosaic from EOX (ESA Copernicus data, ~10m resolution,
// global coverage with no API key). The 2024 build is the freshest public-tier
// composite. Always has imagery anywhere on Earth — fixes the "Map data not
// yet available" blank tiles Esri shows for remote WA at high zoom.
const SENTINEL_BASE =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const SENTINEL_ATTR =
  'Sentinel-2 cloudless 2024 by <a href="https://s2maps.eu">EOX IT</a> (ESA Copernicus)';

const ESRI_ATTR = "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics";
const CARTO_ATTR =
  '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>';

// Esri World Imagery serves real imagery to zoom 17 across remote WA
// (verified by probing tile sizes against Kalgoorlie: 16KB real tile at
// zoom 17, drops to a 2.5KB "Map data not yet available" placeholder at
// zoom 18+). Capping maxNativeZoom at 17 makes Leaflet upsample the real
// zoom-17 tile when the viewport zooms further, instead of falling
// through to the placeholder.
const ESRI_IMAGERY_MAX_NATIVE = 17;
const ESRI_IMAGERY_MAX_DISPLAY = 22; // user may zoom past; Leaflet upsamples

// =================================================================
// Helpers
// =================================================================

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

function ringsToLatLng(rings: Ring[]): Array<Array<[number, number]>> {
  return rings.map((r) => r.map(([lng, lat]) => [lat, lng] as [number, number]));
}

function ringToLatLng(ring: Ring): Array<[number, number]> {
  return ring.map(([lng, lat]) => [lat, lng]);
}

function boundsOf(rings: Ring[]): L.LatLngBounds | null {
  if (rings.length === 0) return null;
  const pts: Array<[number, number]> = [];
  for (const ring of rings) for (const [lng, lat] of ring) pts.push([lat, lng]);
  if (pts.length === 0) return null;
  return L.latLngBounds(pts);
}

function formatLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function formatAud(n: number | undefined): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

// =================================================================
// Inner control components
// =================================================================

function FlyTo({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds || !bounds.isValid()) return;
    // Cap fly-to zoom at 17 — beyond that, Esri imagery falls through to
    // the "Map data not yet available" placeholder for remote WA. The
    // user can still scroll-zoom further; tiles will upsample.
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

function CursorReadout({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({
    mousemove: (e) => onMove(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

/**
 * Click-to-measure tool. Two points → distance, three+ → polygon area.
 */
function MeasureTool({
  active,
  onClear,
}: {
  active: boolean;
  onClear: () => void;
}) {
  const [points, setPoints] = useState<Array<[number, number]>>([]);

  useMapEvents({
    click: (e) => {
      if (!active) return;
      setPoints((p) => [...p, [e.latlng.lat, e.latlng.lng]]);
    },
  });

  useEffect(() => {
    if (!active) setPoints([]);
  }, [active]);

  // Expose a clear via dblclick
  useMapEvents({
    dblclick: () => {
      if (!active) return;
      setPoints([]);
      onClear();
    },
  });

  if (!active || points.length === 0) return null;

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

  const latlngs: Array<[number, number]> = points;
  const midLat = latlngs.reduce((s, p) => s + p[0], 0) / latlngs.length;
  const midLng = latlngs.reduce((s, p) => s + p[1], 0) / latlngs.length;

  return (
    <>
      {points.length >= 3 ? (
        <RLPolygon
          positions={latlngs}
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
          positions={latlngs}
          pathOptions={{ color: "#22d3ee", weight: 3, dashArray: "4 4" }}
        />
      )}
      {points.map((p, i) => (
        <CircleMarker
          key={i}
          center={p}
          radius={4}
          pathOptions={{ color: "#0e7490", fillColor: "#22d3ee", fillOpacity: 1, weight: 2 }}
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
}) {
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

// =================================================================
// Cadastre fetch
// =================================================================

const cadastreCache = new Map<string, Geometry[]>();

async function fetchCadastreForBounds(
  bbox: [number, number, number, number],
  cacheKey: string,
): Promise<Geometry[]> {
  const cached = cadastreCache.get(cacheKey);
  if (cached) return cached;
  try {
    const r = await fetch(
      `/api/spatial/cadastre?bbox=${bbox.join(",")}&limit=20`,
    );
    if (!r.ok) return [];
    const j = (await r.json()) as {
      ok?: boolean;
      features?: Array<{ geometry?: Geometry }>;
    };
    if (!j.ok || !Array.isArray(j.features)) return [];
    const polys = j.features
      .map((f) => f.geometry)
      .filter((g): g is Geometry => !!g && (g.type === "Polygon" || g.type === "MultiPolygon"));
    cadastreCache.set(cacheKey, polys);
    return polys;
  } catch {
    return [];
  }
}

// =================================================================
// Main component
// =================================================================

export default function PropertyMap({
  focusMode,
  tenement,
  parcels,
  assessmentNumber,
  stats,
  evidenceHref,
  height,
}: PropertyMapProps) {
  // Default to Sentinel-2 cloudless mosaic — global 10m/pixel imagery
  // that ALWAYS renders ground (no "Map data not yet available"
  // placeholder, no zoom-coverage gaps). Esri Hybrid is one click away
  // via the toggle for the metro areas where it has higher detail.
  const [basemap, setBasemap] = useState<BasemapKey>("sentinel");
  const [statsOpen, setStatsOpen] = useState(true);
  const [measureOn, setMeasureOn] = useState(false);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [cadastre, setCadastre] = useState<Geometry[]>([]);
  const [cadastreSource, setCadastreSource] =
    useState<"prop" | "live" | "synthetic">("synthetic");
  const [slipProbe, setSlipProbe] = useState<SlipAerialProbeResult | null>(null);
  const [zoomTarget, setZoomTarget] = useState<"parcel" | "tenement" | "all">(
    focusMode === "parcel" ? "parcel" : "all",
  );

  const isPrint =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("print") === "1";

  // ---- Probe SLIP aerial once on mount ----
  useEffect(() => {
    let alive = true;
    void probeSlipAerial().then((r) => {
      if (alive) setSlipProbe(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ---- Resolve parcel polygons ----
  useEffect(() => {
    if (parcels && parcels.length > 0) {
      setCadastre(parcels.map((p) => p.geometry));
      setCadastreSource("prop");
      return;
    }
    if (!tenement) return;
    // Compute the tenement bbox and request cadastre within it.
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
    void fetchCadastreForBounds(bbox, key).then((polys) => {
      if (polys.length === 0) {
        // Synthetic stand-in — a small square slightly inset from the tenement
        // centre. Honest label is surfaced in the stats card.
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
        setCadastreSource("synthetic");
      } else {
        setCadastre(polys);
        setCadastreSource("live");
      }
    });
  }, [tenement, parcels]);

  // ---- Memoise geometry conversions ----
  const tenementRings = useMemo<Ring[]>(
    () => (tenement ? geometryToRings(tenement.geometry) : []),
    [tenement],
  );
  const parcelRings = useMemo<Ring[][]>(
    () => cadastre.map((g) => geometryToRings(g)),
    [cadastre],
  );

  // ---- Compute overlap ----
  const overlap = useMemo(() => {
    if (tenementRings.length === 0 || parcelRings.length === 0) return null;
    const ten = tenementRings[0]!;
    // Try each parcel ring — use the first that returns overlap.
    for (const p of parcelRings) {
      const pr = p[0];
      if (!pr) continue;
      const s = overlapStats(ten, pr);
      if (s) return s;
    }
    return null;
  }, [tenementRings, parcelRings]);

  // ---- Compute fly-to bounds ----
  const flyBounds = useMemo<L.LatLngBounds | null>(() => {
    if (zoomTarget === "parcel" && parcelRings.length > 0) {
      const all: Ring[] = parcelRings.flat();
      return boundsOf(all);
    }
    if (zoomTarget === "tenement" && tenementRings.length > 0) {
      return boundsOf(tenementRings);
    }
    const all: Ring[] = [...tenementRings, ...parcelRings.flat()];
    return boundsOf(all);
  }, [zoomTarget, tenementRings, parcelRings]);

  // ---- Initial centre / zoom ----
  const initialCentre: [number, number] = useMemo(() => {
    const b = boundsOf([...tenementRings, ...parcelRings.flat()]);
    if (b) {
      const c = b.getCenter();
      return [c.lat, c.lng];
    }
    return [-25.27, 133.78];
  }, [tenementRings, parcelRings]);

  // ---- Print trigger ----
  const handlePrint = useCallback(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("print", "1");
    window.open(u.toString(), "_blank");
  }, []);

  // ---- Map setup ----
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
        {/* Base tile layer — note maxNativeZoom upsamples the deepest
            available tile in remote WA instead of showing Esri's "Map data
            not yet available" placeholder at high zoom. */}
        {basemap === "hybrid" && (
          <>
            <TileLayer
              key="hybrid-base"
              url={ESRI_IMAGERY}
              attribution={ESRI_ATTR}
              maxNativeZoom={ESRI_IMAGERY_MAX_NATIVE}
              maxZoom={ESRI_IMAGERY_MAX_DISPLAY}
            />
            <TileLayer
              key="hybrid-ref"
              url={ESRI_REF}
              attribution=""
              maxNativeZoom={ESRI_IMAGERY_MAX_NATIVE}
              maxZoom={ESRI_IMAGERY_MAX_DISPLAY}
              opacity={0.85}
            />
          </>
        )}
        {basemap === "satellite" && (
          <TileLayer
            key="sat"
            url={ESRI_IMAGERY}
            attribution={ESRI_ATTR}
            maxNativeZoom={ESRI_IMAGERY_MAX_NATIVE}
            maxZoom={ESRI_IMAGERY_MAX_DISPLAY}
          />
        )}
        {basemap === "sentinel" && (
          // Sentinel-2 cloudless mosaic — 10m/pixel, global, always
          // available. Lower resolution than Esri at zoom 18 but never
          // shows the "Map data not yet available" placeholder.
          <TileLayer
            key="sentinel"
            url={SENTINEL_BASE}
            attribution={SENTINEL_ATTR}
            maxNativeZoom={14}
            maxZoom={ESRI_IMAGERY_MAX_DISPLAY}
          />
        )}
        {basemap === "street" && (
          <TileLayer key="street" url={CARTO_LIGHT} attribution={CARTO_ATTR} maxZoom={19} />
        )}
        {basemap === "topo" && (
          <TileLayer key="topo" url={ESRI_TOPO} attribution={ESRI_ATTR} maxZoom={19} />
        )}
        {basemap === "slip-aerial" && slipProbe && slipProbe.ok && (
          <TileLayer
            key="slip"
            url={slipProbe.tileUrl}
            attribution="© Landgate SLIP (WA)"
            maxZoom={19}
          />
        )}

        <ScaleControl position="bottomleft" metric imperial={false} />

        <FlyTo bounds={flyBounds} />
        <CursorReadout onMove={(lat, lng) => setCursor([lat, lng])} />
        <MeasureTool active={measureOn} onClear={() => setMeasureOn(false)} />

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
      </MapContainer>

      {/* CSS for animated dashed stroke + measure tooltip */}
      <style>{`
        @keyframes ratesassistDash {
          to { stroke-dashoffset: -28; }
        }
        .ratesassist-parcel-stroke {
          animation: ratesassistDash 1.6s linear infinite;
        }
        .ratesassist-measure-tip {
          background: rgba(8, 47, 73, 0.92);
          color: #fff;
          border: none;
          border-radius: 4px;
          padding: 4px 8px;
          font: 600 11px/1.2 ui-sans-serif, system-ui;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        }
        .ratesassist-measure-tip:before { display: none; }
      `}</style>

      {/* Basemap toggle pill row (top-left) */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={pillRowStyle}>
          {(
            [
              ["hybrid", "Hybrid"],
              ["satellite", "Satellite"],
              ["sentinel", "Sentinel‑2"],
              ["street", "Street"],
              ["topo", "Topo"],
              ...(slipProbe && slipProbe.ok
                ? ([["slip-aerial", "SLIP Aerial"]] as const)
                : []),
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setBasemap(key as BasemapKey)}
              style={pillButtonStyle(basemap === key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Zoom-to-detail buttons */}
        <div style={pillRowStyle}>
          <button
            type="button"
            onClick={() => setZoomTarget("parcel")}
            style={pillButtonStyle(zoomTarget === "parcel")}
            disabled={parcelRings.length === 0}
            title="Zoom to parcel boundary"
          >
            Zoom to parcel
          </button>
          <button
            type="button"
            onClick={() => setZoomTarget("tenement")}
            style={pillButtonStyle(zoomTarget === "tenement")}
            disabled={tenementRings.length === 0}
            title="Zoom to tenement boundary"
          >
            Zoom to tenement
          </button>
        </div>

        {/* Measure + print */}
        <div style={pillRowStyle}>
          <button
            type="button"
            onClick={() => setMeasureOn((v) => !v)}
            style={pillButtonStyle(measureOn)}
            title="Click to measure distance (2 clicks) or area (3+ clicks). Double-click to clear."
          >
            <Ruler className="inline w-3 h-3 mr-1" />
            {measureOn ? "Measuring" : "Measure"}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            style={pillButtonStyle(false)}
            title="Open print view"
          >
            <Printer className="inline w-3 h-3 mr-1" />
            Print view
          </button>
        </div>
      </div>

      {/* North arrow (top-right, above stats card) */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: statsOpen ? 308 : 64,
          zIndex: 1000,
          background: "rgba(255,255,255,0.92)",
          borderRadius: "50%",
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
          transition: "right 0.15s",
        }}
        title="North"
      >
        <Compass size={22} color="#1a52d4" />
      </div>

      {/* Stats card (top-right) */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 1000,
          width: statsOpen ? 288 : 44,
          background: "rgba(255,255,255,0.96)",
          borderRadius: 8,
          boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
          fontSize: 12,
          overflow: "hidden",
          transition: "width 0.15s",
        }}
      >
        <button
          type="button"
          onClick={() => setStatsOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            color: "#1f2937",
          }}
        >
          {statsOpen ? <span>Property snapshot</span> : <span>›</span>}
          {statsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {statsOpen && (
          <div style={{ padding: "0 12px 12px 12px", color: "#374151" }}>
            {stats?.assessmentNumber && (
              <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#1f2937" }}>
                {stats.assessmentNumber}
              </div>
            )}
            {stats?.address && (
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{stats.address}</div>
            )}
            {stats?.landUse && (
              <span
                style={{
                  display: "inline-block",
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  padding: "2px 6px",
                  borderRadius: 3,
                  background: landUseColour(stats.landUse).bg,
                  color: landUseColour(stats.landUse).fg,
                  marginBottom: 8,
                }}
              >
                {stats.landUse}
              </span>
            )}
            {stats?.valuation != null && (
              <Row k="Valuation" v={formatAud(stats.valuation)} />
            )}
            {(stats?.currentAnnualRates != null || stats?.projectedAnnualRates != null) && (
              <Row
                k="Annual rates"
                v={
                  <span>
                    {formatAud(stats?.currentAnnualRates)}
                    {" → "}
                    <strong>{formatAud(stats?.projectedAnnualRates)}</strong>
                  </span>
                }
              />
            )}
            {stats?.estimatedUplift != null && (
              <Row
                k="Estimated uplift"
                v={<strong style={{ color: "#059669" }}>+{formatAud(stats.estimatedUplift)}/yr</strong>}
              />
            )}
            {overlap && (
              <Row
                k="Tenement coverage"
                v={
                  <span>
                    {m2ToHa(overlap.areaM2).toFixed(2)} ha (
                    {overlap.percentOfParcel.toFixed(0)}% of parcel)
                  </span>
                }
              />
            )}
            <Row
              k="Cadastre source"
              v={
                <span
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: cadastreSource === "live" ? "#059669" : "#b45309",
                  }}
                >
                  {cadastreSource === "live"
                    ? "LIVE (Landgate SLIP)"
                    : cadastreSource === "prop"
                      ? "Provided"
                      : "Synthetic (real cadastre unavailable)"}
                </span>
              }
            />
            {evidenceHref && (
              <a
                href={evidenceHref}
                style={{
                  display: "block",
                  marginTop: 10,
                  padding: "6px 8px",
                  textAlign: "center",
                  background: "#1a52d4",
                  color: "white",
                  borderRadius: 4,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Click to open evidence pack →
              </a>
            )}
          </div>
        )}
      </div>

      {/* Overlap badge (always visible if overlap exists) */}
      {overlap && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            background: "rgba(202, 138, 4, 0.95)",
            color: "white",
            padding: "5px 12px",
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 700,
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            letterSpacing: 0.5,
          }}
        >
          OVERLAP: {m2ToHa(overlap.areaM2).toFixed(1)} ha ({overlap.percentOfParcel.toFixed(0)}% of parcel)
        </div>
      )}

      {/* Legend (bottom-left, above scale) */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          left: 12,
          zIndex: 1000,
          background: "rgba(255,255,255,0.94)",
          padding: "8px 10px",
          borderRadius: 6,
          fontSize: 11,
          boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
          color: "#1f2937",
        }}
      >
        <LegendRow swatch="#dc2626" dashed label="Parcel boundary (rated parcel)" />
        <LegendRow swatch="#f59e0b" label="Mining tenement (DMIRS)" />
        <LegendRow swatch="#facc15" label="Overlap area (reclassification candidate)" />
      </div>

      {/* Cursor lat/lng readout (bottom-right) */}
      {cursor && !isPrint && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            zIndex: 1000,
            background: "rgba(255,255,255,0.92)",
            padding: "3px 8px",
            borderRadius: 4,
            fontFamily: "ui-monospace, monospace",
            fontSize: 11,
            color: "#374151",
            boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
          }}
        >
          {formatLatLng(cursor[0], cursor[1])}
        </div>
      )}

      {/* Print watermark */}
      {isPrint && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: "rgba(15, 23, 42, 0.85)",
            color: "#fff",
            textAlign: "center",
            padding: "6px 0",
            fontSize: 11,
            letterSpacing: 1,
            zIndex: 1000,
          }}
        >
          RatesAssist — Confidential, decision-support only
        </div>
      )}
    </div>
  );
}

// =================================================================
// Small presentational helpers
// =================================================================

const pillRowStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.95)",
  borderRadius: 6,
  padding: 2,
  display: "flex",
  gap: 2,
  boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
};

function pillButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    background: active ? "#1a52d4" : "transparent",
    color: active ? "white" : "#374151",
    fontWeight: active ? 600 : 500,
    fontSize: 12,
    fontFamily: "inherit",
  };
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderTop: "1px solid #f3f4f6" }}>
      <span style={{ color: "#6b7280", fontSize: 11 }}>{k}</span>
      <span style={{ fontSize: 12 }}>{v}</span>
    </div>
  );
}

function LegendRow({
  swatch,
  label,
  dashed,
}: {
  swatch: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
      <span
        style={{
          display: "inline-block",
          width: 14,
          height: 8,
          background: swatch,
          opacity: 0.65,
          border: `2px ${dashed ? "dashed" : "solid"} ${swatch}`,
          borderRadius: 2,
        }}
      />
      <span>{label}</span>
    </div>
  );
}

function landUseColour(landUse: string): { bg: string; fg: string } {
  const u = landUse.toLowerCase();
  if (u.includes("rural")) return { bg: "#dcfce7", fg: "#166534" };
  if (u.includes("vacant")) return { bg: "#fef3c7", fg: "#92400e" };
  if (u.includes("commercial") || u.includes("industrial"))
    return { bg: "#dbeafe", fg: "#1e40af" };
  if (u.includes("residential")) return { bg: "#ede9fe", fg: "#5b21b6" };
  return { bg: "#f3f4f6", fg: "#374151" };
}

// react-leaflet types — keep import live (RLGeoJSON is exported but unused in
// the simplified body; we re-export GeoJSON for parity with PortfolioMap).
export const __RLGeoJSON = RLGeoJSON;
