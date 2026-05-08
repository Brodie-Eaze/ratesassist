"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  WMSTileLayer,
  Marker,
  Popup,
  Polygon,
  Circle,
  GeoJSON,
  useMap,
  useMapEvents,
  ScaleControl,
} from "react-leaflet";
import type { Feature, Geometry, GeoJsonProperties } from "geojson";
import type { Council, Property, Tenement } from "@/lib/types";
import { BASEMAPS, OVERLAYS, type BasemapDef, type OverlayDef } from "@/lib/basemaps";
import { bufferPolygon } from "@/lib/spatial";

type Props = {
  properties: Property[];
  tenements: Tenement[];
  councils: Council[];
  centre: [number, number];
  zoom: number;
  highlightAssessment?: string;
  basemapId?: string;
  overlayIds?: string[];
  /** When true, fetch real DMIRS / Landgate polygons for the current bbox at high zoom */
  liveVectors?: boolean;
  /** Optional: highlight a specific tenement with thick outline + 1km buffer */
  selectedTenementId?: string;
  onSelectProperty?: (assessment: string) => void;
  onSelectTenement?: (tenementId: string) => void;
};

function makeIcon(color: string, ring = "transparent"): L.DivIcon {
  return L.divIcon({
    html: `<span style="
      display:block; width:14px; height:14px; border-radius:50%;
      background:${color};
      box-shadow:0 0 0 2px ${ring}, 0 0 0 3px white, 0 1px 3px rgba(0,0,0,0.3);
    "></span>`,
    className: "ra-marker",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

const ICONS = {
  normal:    makeIcon("#1a52d4"),
  overdue:   makeIcon("#f59e0b"),
  mining:    makeIcon("#ef4444", "rgba(239,68,68,0.4)"),
  highlight: makeIcon("#10b981", "rgba(16,185,129,0.5)"),
};

function Recenter({
  centre,
  zoom,
  fitProperties,
}: {
  centre: [number, number];
  zoom: number;
  fitProperties?: Property[];
}) {
  const map = useMap();
  // One-shot size recompute on mount only — no repeated invalidateSize
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [map]);

  // Stable signature: centre/zoom + a fingerprint of the property set
  // (ids only, not the array identity) so the effect doesn't re-fire on every
  // parent render that produces a fresh array literal.
  const propsFingerprint = fitProperties
    ? fitProperties
        .map((p) => p.assessmentNumber)
        .sort()
        .join("|")
    : "";

  // Stable scalar deps (constant length, primitives only)
  const lat = centre[0];
  const lng = centre[1];
  useEffect(() => {
    if (fitProperties && fitProperties.length > 1) {
      const bounds = L.latLngBounds(
        fitProperties.map((p) => [p.lat, p.lng] as [number, number]),
      );
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13, animate: false });
        return;
      }
    }
    map.setView([lat, lng], zoom, { animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, zoom, map, propsFingerprint]);
  return null;
}

// Tracks bbox + zoom and reports up via callback (debounced)
function ViewportProbe({ onChange }: { onChange: (b: number[], z: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const fire = () => {
      const b = map.getBounds();
      onChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom());
    };
    let t: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (t) clearTimeout(t);
      t = setTimeout(fire, 250);
    };
    map.on("moveend", debounced);
    map.on("zoomend", debounced);
    fire();
    return () => {
      if (t) clearTimeout(t);
      map.off("moveend", debounced);
      map.off("zoomend", debounced);
    };
  }, [map, onChange]);
  return null;
}

// Fits map to a tenement's polygon when selected
function FitToTenement({ tenement }: { tenement?: Tenement }) {
  const map = useMap();
  useEffect(() => {
    if (!tenement) return;
    const bounds = L.latLngBounds(tenement.polygon);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
  }, [tenement, map]);
  return null;
}

export default function MapInner({
  properties,
  tenements,
  councils,
  centre,
  zoom,
  highlightAssessment,
  basemapId,
  overlayIds = [],
  liveVectors = false,
  selectedTenementId,
  onSelectProperty,
  onSelectTenement,
}: Props) {
  const propertyTenementIds = useMemo(
    () => new Set(tenements.flatMap((t) => t.intersectsAssessmentNumbers)),
    [tenements],
  );

  const basemap: BasemapDef =
    BASEMAPS.find((b) => b.id === basemapId && b.url !== null) ??
    BASEMAPS.find((b) => b.id === "carto-positron")!;
  const isHybridLabels = basemap.id === "esri-hybrid";

  const activeOverlays: OverlayDef[] = OVERLAYS.filter((o) => overlayIds.includes(o.id));
  const selectedTenement = useMemo(
    () => tenements.find((t) => t.tenementId === selectedTenementId),
    [tenements, selectedTenementId],
  );

  // ----- Live vector loading -----
  const [liveTenements, setLiveTenements] = useState<Feature[]>([]);
  const [liveParcels, setLiveParcels] = useState<Feature[]>([]);
  const [liveStatus, setLiveStatus] = useState<{
    tenements?: { source: string; count: number; queriedAt?: string };
    parcels?: { source: string; count: number; queriedAt?: string };
    err?: string;
  }>({});

  const ctrlRef = useRef<AbortController | null>(null);
  const handleViewportChange = useCallback(
    async (bbox: number[], z: number) => {
      if (!liveVectors) return;
      // Cancel any in-flight viewport fetch before starting a new one.
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      // Polygon detail only useful from zoom >= 8 (LGA) for tenements,
      // zoom >= 14 (parcel) for cadastre.
      const wantsTenements = z >= 8;
      const wantsParcels = z >= 14;
      if (!wantsTenements && !wantsParcels) {
        setLiveTenements([]);
        setLiveParcels([]);
        return;
      }
      const params = `bbox=${bbox.join(",")}&limit=200`;
      const tasks: Promise<void>[] = [];
      if (wantsTenements) {
        tasks.push(
          fetch(`/api/spatial/miningTenements?${params}`, { signal: ctrl.signal })
            .then(async (r) => {
              if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
              return r.json();
            })
            .then((j) => {
              if (ctrl.signal.aborted) return;
              if (j.ok) {
                setLiveTenements(j.features ?? []);
                setLiveStatus((s) => ({
                  ...s,
                  err: undefined,
                  tenements: {
                    source: j.source,
                    count: (j.features ?? []).length,
                    queriedAt: j.queriedAt,
                  },
                }));
              } else {
                throw new Error(j.error ?? "tenement query returned ok=false");
              }
            })
            .catch((e: unknown) => {
              if (ctrl.signal.aborted) return;
              const msg = e instanceof Error ? e.message : String(e);
              setLiveTenements([]);
              setLiveStatus((s) => ({ ...s, err: `tenements: ${msg}` }));
            }),
        );
      } else {
        setLiveTenements([]);
      }
      if (wantsParcels) {
        tasks.push(
          fetch(`/api/spatial/cadastre?${params}`, { signal: ctrl.signal })
            .then(async (r) => {
              if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
              return r.json();
            })
            .then((j) => {
              if (ctrl.signal.aborted) return;
              if (j.ok) {
                setLiveParcels(j.features ?? []);
                setLiveStatus((s) => ({
                  ...s,
                  err: undefined,
                  parcels: {
                    source: j.source,
                    count: (j.features ?? []).length,
                    queriedAt: j.queriedAt,
                  },
                }));
              } else {
                throw new Error(j.error ?? "parcel query returned ok=false");
              }
            })
            .catch((e: unknown) => {
              if (ctrl.signal.aborted) return;
              const msg = e instanceof Error ? e.message : String(e);
              setLiveParcels([]);
              setLiveStatus((s) => ({ ...s, err: `parcels: ${msg}` }));
            }),
        );
      } else {
        setLiveParcels([]);
      }
      await Promise.allSettled(tasks);
    },
    [liveVectors],
  );

  return (
    <MapContainer
      center={centre}
      zoom={zoom}
      scrollWheelZoom
      style={{ height: "100%", width: "100%", minHeight: "300px" }}
      worldCopyJump
      preferCanvas={true}
    >
      <Recenter centre={centre} zoom={zoom} fitProperties={properties} />
      <FitToTenement tenement={selectedTenement} />
      <ViewportProbe onChange={handleViewportChange} />
      <ScaleControl position="bottomleft" imperial={false} />

      {/* Basemap */}
      <TileLayer
        key={basemap.id}
        url={basemap.url ?? ""}
        attribution={basemap.attribution}
        maxZoom={basemap.maxZoom}
        {...(basemap.subdomains ? { subdomains: basemap.subdomains } : {})}
      />
      {isHybridLabels && (
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
          attribution="Labels &copy; Esri"
          maxZoom={19}
        />
      )}

      {/* WMS overlays */}
      {activeOverlays.map((o) =>
        o.type === "wms" ? (
          <WMSTileLayer
            key={o.id}
            url={o.url}
            layers={o.layers ?? ""}
            format={o.format ?? "image/png"}
            transparent={o.transparent ?? true}
            attribution={o.attribution}
          />
        ) : null,
      )}

      {/* Council seat markers */}
      {councils.map((co) => (
        <Circle
          key={co.code}
          center={[co.centerLat, co.centerLng]}
          radius={8000}
          pathOptions={{
            color: "#5c6878",
            fillColor: "#5c6878",
            fillOpacity: 0.04,
            weight: 1,
            dashArray: "4 4",
          }}
        />
      ))}

      {/* Live cadastral parcels (real Landgate polygons) — render below tenements */}
      {liveVectors && liveParcels.length > 0 && (
        <GeoJSON
          key={`parcels-${liveParcels.length}`}
          data={
            {
              type: "FeatureCollection",
              features: liveParcels,
            } as never
          }
          style={() => ({
            color: "#1a52d4",
            weight: 1,
            opacity: 0.75,
            fillColor: "#2a6cf0",
            fillOpacity: 0.05,
          })}
          onEachFeature={(feat: Feature<Geometry, GeoJsonProperties>, layer: L.Layer) => {
            const props = feat.properties ?? {};
            const html = renderParcelPopup(props);
            layer.bindPopup(html, { maxWidth: 320 });
          }}
        />
      )}

      {/* Live mining tenement polygons (real DMIRS geometry) */}
      {liveVectors && liveTenements.length > 0 && (
        <GeoJSON
          key={`tenements-${liveTenements.length}`}
          data={
            {
              type: "FeatureCollection",
              features: liveTenements,
            } as never
          }
          style={(feat) => {
            const p = feat?.properties ?? {};
            const status = String(p.STATUS ?? p.status ?? "").toUpperCase();
            const isLive = status.includes("LIVE") || status.includes("ACTIVE");
            return {
              color: isLive ? "#b91c1c" : "#5c6878",
              weight: 1.5,
              fillColor: isLive ? "#ef4444" : "#94a0b3",
              fillOpacity: 0.18,
            };
          }}
          onEachFeature={(feat, layer) => {
            const props = feat.properties ?? {};
            const tenId = extractTenementId(props);
            const html = renderTenementPopup(tenId, props);
            layer.bindPopup(html, { maxWidth: 380 });
            layer.on({
              click: () => onSelectTenement?.(tenId),
            });
          }}
        />
      )}

      {/* Seeded tenement polygons (only when not in live mode, to avoid double-render) */}
      {!liveVectors &&
        tenements.map((t) => {
          const isSelected = selectedTenementId === t.tenementId;
          return (
            <Polygon
              key={t.tenementId}
              positions={t.polygon}
              pathOptions={{
                color: t.isProducing ? "#b91c1c" : "#f59e0b",
                fillColor: t.isProducing ? "#ef4444" : "#fbbf24",
                fillOpacity: isSelected ? 0.32 : 0.22,
                weight: isSelected ? 3.5 : 1.5,
                dashArray: isSelected ? undefined : undefined,
              }}
              eventHandlers={{
                click: () => onSelectTenement?.(t.tenementId),
              }}
            >
              <Popup>
                <div style={{ fontSize: "12px", lineHeight: 1.5 }}>
                  <strong>{t.tenementId}</strong> ·{" "}
                  {t.type === "M"
                    ? "Mining Lease"
                    : t.type === "E"
                      ? "Exploration Licence"
                      : t.type === "P"
                        ? "Prospecting Licence"
                        : t.type === "G"
                          ? "General Purpose Lease"
                          : "Misc Licence"}
                  <br />
                  <span style={{ color: "#5c6878" }}>{t.holder}</span>
                  {t.holderAbn && (
                    <span style={{ color: "#94a0b3" }}> · ABN {t.holderAbn}</span>
                  )}
                  <br />
                  {t.commodity.join(" · ")}
                  {t.isProducing && (
                    <>
                      {" · "}
                      <span style={{ color: "#10b981" }}>producing</span>
                    </>
                  )}
                  <br />
                  {t.areaHectares.toLocaleString()} ha · expires {t.expiryDate}
                </div>
              </Popup>
            </Polygon>
          );
        })}

      {/* Selected-tenement buffer ring (1km) — centred on polygon bounds centre,
          not the first vertex. */}
      {selectedTenement && (() => {
        const centroid = L.latLngBounds(selectedTenement.polygon).getCenter();
        return (
        <Polygon
          positions={bufferPolygon(centroid.lat, centroid.lng, 1000)}
          pathOptions={{
            color: "#10b981",
            weight: 2,
            dashArray: "6 4",
            fillColor: "#10b981",
            fillOpacity: 0.04,
          }}
        />
        );
      })()}

      {/* Property markers */}
      {properties.map((p) => {
        const isMining = propertyTenementIds.has(p.assessmentNumber);
        const isOverdue = p.balance > 0;
        const isHighlight = highlightAssessment === p.assessmentNumber;
        const icon = isHighlight
          ? ICONS.highlight
          : isMining
            ? ICONS.mining
            : isOverdue
              ? ICONS.overdue
              : ICONS.normal;
        return (
          <Marker
            key={p.assessmentNumber}
            position={[p.lat, p.lng]}
            icon={icon}
            eventHandlers={{
              click: () => onSelectProperty?.(p.assessmentNumber),
            }}
          >
            <Popup>
              <div style={{ fontSize: "12px", lineHeight: 1.5 }}>
                <strong>{p.address}</strong>
                <br />
                {p.suburb}, {p.state} {p.postcode}
                <br />
                <code style={{ color: "#1a52d4" }}>{p.assessmentNumber}</code>
                <br />
                {p.landUse} · ${p.annualRates.toLocaleString()}/yr
                {isOverdue && (
                  <>
                    <br />
                    <span style={{ color: "#b45309" }}>
                      Overdue: ${p.balance.toFixed(2)}
                    </span>
                  </>
                )}
                {isMining && (
                  <>
                    <br />
                    <span style={{ color: "#b91c1c" }}>⚠ Tenement coverage detected</span>
                  </>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}

      {/* Live status corner badge */}
      {liveVectors && (
        <LiveStatusBadge status={liveStatus} />
      )}
    </MapContainer>
  );
}

function LiveStatusBadge({
  status,
}: {
  status: { tenements?: { source: string; count: number }; parcels?: { source: string; count: number }; err?: string };
}) {
  const map = useMap();
  const z = map.getZoom();
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 1000,
        background: "white",
        border: "1px solid #dde2ea",
        borderRadius: "6px",
        padding: "8px 10px",
        fontSize: "11px",
        fontFamily: "Inter, sans-serif",
        boxShadow: "0 2px 8px rgba(15,20,28,0.08)",
        minWidth: "200px",
      }}
    >
      <div style={{ fontWeight: 600, color: "#0f141c", marginBottom: 4 }}>
        Live vector mode
      </div>
      <div style={{ color: "#5c6878", marginBottom: 4 }}>Zoom {z.toFixed(0)}</div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: "#5c6878" }}>DMIRS tenements</span>
        <span style={{ color: status.tenements ? "#0f141c" : "#94a0b3" }}>
          {z < 8 ? "zoom in (≥8)" : status.tenements ? `${status.tenements.count} loaded` : "fetching…"}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: "#5c6878" }}>Cadastral parcels</span>
        <span style={{ color: status.parcels ? "#0f141c" : "#94a0b3" }}>
          {z < 14 ? "zoom in (≥14)" : status.parcels ? `${status.parcels.count} loaded` : "fetching…"}
        </span>
      </div>
      {status.err && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: "1px solid #fee2e2",
            color: "#b91c1c",
            fontSize: "10.5px",
            lineHeight: 1.4,
          }}
        >
          ⚠ Live data unavailable — {status.err}
        </div>
      )}
    </div>
  );
}

// --- helpers ---

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function extractTenementId(props: Record<string, unknown>): string {
  return (
    (props.fmt_tenid as string) ||
    (props.tenid as string)?.trim() ||
    (props.TENID as string) ||
    (props.TENEMENT_ID as string) ||
    "Tenement"
  );
}

function dmirsDate(v: unknown): string | null {
  if (typeof v !== "number") return null;
  if (v <= 0) return null;
  return new Date(v).toISOString().slice(0, 10);
}

function renderTenementPopup(tenId: string, props: Record<string, unknown>): string {
  const status = String(props.tenstatus ?? props.STATUS ?? "").trim();
  const type = String(props.type ?? props.TYPE ?? "").trim();
  const holder = String(props.holder1 ?? props.HOLDER ?? "").trim();
  const grantDate = dmirsDate(props.grantdate);
  const endDate = dmirsDate(props.enddate);
  const area = props.legal_area;
  const unit = String(props.unit_of_me ?? "").trim();
  const commodity = props.commodity ?? props.COMMODITY ?? "";
  const surveyStatus = String(props.survstatus ?? "").trim();
  const addr = String(props.addr1 ?? "").trim();

  const rows: [string, string][] = [];
  if (type) rows.push(["Type", type]);
  if (status) rows.push(["Status", status]);
  if (holder) rows.push(["Holder", holder]);
  if (addr) rows.push(["Holder address", addr]);
  if (commodity) rows.push(["Commodity", String(commodity)]);
  if (area) rows.push(["Legal area", `${area}${unit ? ` ${unit}` : ""}`]);
  if (grantDate) rows.push(["Granted", grantDate]);
  if (endDate) rows.push(["Expires", endDate]);
  if (surveyStatus) rows.push(["Survey", surveyStatus]);
  if (props.gid) rows.push(["DMIRS GID", String(props.gid)]);

  return `
    <div style="font-size:12px;line-height:1.5;min-width:260px;max-width:360px">
      <div style="font-weight:600;color:#0f141c;margin-bottom:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span>${escapeHtml(tenId)}</span>
        <span style="background:#fef2f2;color:#b91c1c;font-size:10px;padding:1px 6px;border-radius:9999px">DMIRS · live</span>
        ${status ? `<span style="background:${status.toUpperCase().includes("LIVE") ? "#ecfdf5" : "#f7f8fa"};color:${status.toUpperCase().includes("LIVE") ? "#047857" : "#5c6878"};font-size:10px;padding:1px 6px;border-radius:9999px">${escapeHtml(status)}</span>` : ""}
      </div>
      ${rows.length ? renderRows(rows) : `<div style="color:#5c6878">No attributes returned.</div>`}
      <div style="margin-top:6px;font-size:10px;color:#94a0b3">
        Source: services.slip.wa.gov.au · Industry_and_Mining/MapServer/3 (DMIRS-003)
      </div>
    </div>
  `;
}

function renderParcelPopup(props: Record<string, unknown>): string {
  const polyNum = props.polygon_number ?? props.POLY_ID ?? props.gid ?? props.OBJECTID;
  const lotPlan = props.lotplan ?? props.LOTPLAN ?? "";
  const area = props["st_area(the_geom)"];
  const rows: [string, string][] = [];
  if (lotPlan) rows.push(["Lot/Plan", String(lotPlan)]);
  if (polyNum) rows.push(["Parcel ID", String(polyNum)]);
  if (area && typeof area === "number") rows.push(["Area (deg²)", area.toExponential(3)]);

  return `
    <div style="font-size:12px;line-height:1.5;min-width:220px">
      <div style="font-weight:600;color:#0f141c;margin-bottom:4px">
        Cadastral Parcel
        <span style="background:#d8eaff;color:#1a52d4;font-size:10px;padding:1px 6px;border-radius:9999px;margin-left:6px">Landgate · live</span>
      </div>
      ${rows.length ? renderRows(rows) : `<div style="color:#94a0b3;font-size:11px">Parcel boundary (no attributes published — cadastre published as geometry-only).</div>`}
      <div style="margin-top:6px;font-size:10px;color:#94a0b3">
        Source: Property_and_Planning/MapServer/2 (LGATE-001)
      </div>
    </div>
  `;
}

function renderRows(rows: [string, string][]): string {
  return (
    `<table style="border-collapse:collapse;font-size:11px;width:100%">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="color:#5c6878;padding:2px 8px 2px 0;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:2px 0;color:#0f141c">${escapeHtml(v)}</td></tr>`,
      )
      .join("") +
    `</table>`
  );
}
