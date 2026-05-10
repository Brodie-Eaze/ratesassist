"use client";

/**
 * Grant detail map — renders the tenement polygon (amber/red, semi-
 * transparent) plus markers/circles for each synthetically-matched
 * council parcel. Click a parcel marker → fires onSelectParcel so the
 * outer page can highlight the corresponding row.
 */

import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Polygon as RLPolygon,
  CircleMarker,
  Popup,
  GeoJSON,
  useMap,
} from "react-leaflet";

type Basemap = "satellite" | "street";

const BASEMAPS: Record<Basemap, { url: string; attribution: string; maxZoom: number }> = {
  satellite: {
    // Esri World Imagery — free, no API key required, global coverage.
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
  street: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  },
};

type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "Point"; coordinates: number[] };

type Grant = {
  tenementId: string;
  tenementIdDisplay: string;
  typeLabel: string;
  holder: string;
  grantDate: string;
  geometry: Geometry;
  provisional: boolean;
};

type Parcel = {
  assessmentNumber: string;
  address: string;
  landUse: string;
  estimatedUpliftSeverity: "high" | "medium" | "low";
  estimatedUpliftAmount: number;
};

type Props = {
  grant: Grant;
  parcels: Parcel[];
  highlightedAssessment: string | null;
  onSelectParcel: (assessmentNumber: string) => void;
};

/** Convert geometry to flat list of [lat, lng] rings for Leaflet's Polygon. */
function geometryToLatLngRings(
  geom: Geometry,
): Array<Array<[number, number]>> {
  if (geom.type === "Point") {
    const [lng, lat] = geom.coordinates;
    // Tiny placeholder square so the polygon layer still renders something.
    const d = 0.005;
    return [
      [
        [lat - d, lng - d],
        [lat - d, lng + d],
        [lat + d, lng + d],
        [lat + d, lng - d],
      ],
    ];
  }
  const polys: number[][][][] =
    geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const rings: Array<Array<[number, number]>> = [];
  for (const poly of polys) {
    for (const ring of poly) {
      rings.push(
        ring.map((pt) => [pt[1] as number, pt[0] as number] as [number, number]),
      );
    }
  }
  return rings;
}

/** GeoJSON FeatureCollection wrapper for the tenement; lets us reuse Leaflet's GeoJSON layer for proper bbox. */
function geometryAsFeature(grant: Grant): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { id: grant.tenementId },
    geometry: grant.geometry as GeoJSON.Geometry,
  };
}

/** Use Leaflet's fitBounds with 10% padding once we know the geometry. */
function FitToGrant({ grant, parcels }: { grant: Grant; parcels: Array<{ lat: number; lng: number }> }) {
  const map = useMap();
  useEffect(() => {
    const rings = geometryToLatLngRings(grant.geometry);
    const points: Array<[number, number]> = [];
    for (const ring of rings) for (const pt of ring) points.push(pt);
    for (const p of parcels) points.push([p.lat, p.lng]);
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [grant, parcels, map]);
  return null;
}

/**
 * Resolve approximate parcel coordinates for plotting.
 *
 * The detail API returns parcels by assessment number only — no lat/lng. We
 * place each parcel marker at the tenement bbox centre offset by a small
 * spiral so they're visible and clickable. Real cadastre joins (Phase 2)
 * will provide actual parcel centroids.
 */
function syntheticParcelPoints(
  grant: Grant,
  parcels: Parcel[],
): Array<Parcel & { lat: number; lng: number }> {
  const rings = geometryToLatLngRings(grant.geometry);
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const ring of rings) {
    for (const [lat, lng] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  if (!Number.isFinite(minLat)) return [];
  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;
  const spreadLat = Math.max(0.01, (maxLat - minLat) * 0.7);
  const spreadLng = Math.max(0.01, (maxLng - minLng) * 0.7);
  return parcels.map((p, i) => {
    // deterministic spiral
    const angle = (i / Math.max(1, parcels.length)) * Math.PI * 2;
    const r = 0.4 + (i % 2) * 0.3;
    return {
      ...p,
      lat: cLat + Math.sin(angle) * spreadLat * r,
      lng: cLng + Math.cos(angle) * spreadLng * r,
    };
  });
}

export default function GrantMap({
  grant,
  parcels,
  highlightedAssessment,
  onSelectParcel,
}: Props) {
  const tenementRings = useMemo(
    () => geometryToLatLngRings(grant.geometry),
    [grant],
  );
  const parcelPoints = useMemo(
    () => syntheticParcelPoints(grant, parcels),
    [grant, parcels],
  );

  const isProvisional = grant.provisional;
  const fillColor = isProvisional ? "#f59e0b" : "#ef4444";
  const strokeColor = isProvisional ? "#b45309" : "#b91c1c";

  // Use Point-style centred placeholder when geometry is a Point.
  const centre: [number, number] =
    grant.geometry.type === "Point"
      ? [grant.geometry.coordinates[1] as number, grant.geometry.coordinates[0] as number]
      : tenementRings[0]?.[0] ?? [-25.27, 133.78];

  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const tile = BASEMAPS[basemap];

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      {/* Basemap toggle pill — top-right of the map, above tile layer. */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 1000,
          background: "rgba(255,255,255,0.95)",
          borderRadius: 6,
          padding: 2,
          fontSize: 12,
          fontFamily: "Arial, sans-serif",
          boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
          display: "flex",
          gap: 2,
        }}
      >
        {(["satellite", "street"] as const).map((b) => (
          <button
            key={b}
            onClick={() => setBasemap(b)}
            style={{
              padding: "4px 10px",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              background: basemap === b ? "#1a52d4" : "transparent",
              color: basemap === b ? "white" : "#374151",
              fontWeight: basemap === b ? 600 : 400,
              textTransform: "capitalize",
            }}
            type="button"
          >
            {b}
          </button>
        ))}
      </div>

      <MapContainer
        center={centre}
        zoom={11}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
        preferCanvas
      >
        <TileLayer
          key={basemap}
          url={tile.url}
          attribution={tile.attribution}
          maxZoom={tile.maxZoom}
        />

      <FitToGrant grant={grant} parcels={parcelPoints} />

      {/* Tenement polygon (or stand-in box for Points). */}
      {grant.geometry.type === "Point" ? (
        <CircleMarker
          center={centre}
          radius={20}
          pathOptions={{
            color: strokeColor,
            fillColor,
            fillOpacity: 0.3,
            weight: 2,
          }}
        >
          <Popup>
            <strong>{grant.tenementIdDisplay}</strong>
            <br />
            {grant.typeLabel}
            <br />
            <span style={{ color: "#5c6878" }}>{grant.holder}</span>
            <br />
            granted {grant.grantDate}
          </Popup>
        </CircleMarker>
      ) : (
        <GeoJSON
          key={grant.tenementId}
          data={geometryAsFeature(grant)}
          style={() => ({
            color: strokeColor,
            fillColor,
            fillOpacity: 0.3,
            weight: 2,
          })}
        >
          <Popup>
            <strong>{grant.tenementIdDisplay}</strong>
            <br />
            {grant.typeLabel}
            <br />
            <span style={{ color: "#5c6878" }}>{grant.holder}</span>
            <br />
            granted {grant.grantDate}
          </Popup>
        </GeoJSON>
      )}

      {/* Parcel markers (synthetic positions). */}
      {parcelPoints.map((p) => {
        const highlighted = highlightedAssessment === p.assessmentNumber;
        return (
          <CircleMarker
            key={p.assessmentNumber}
            center={[p.lat, p.lng]}
            radius={highlighted ? 12 : 8}
            pathOptions={{
              color: "#1a52d4",
              fillColor: highlighted ? "#3b82f6" : "#60a5fa",
              fillOpacity: highlighted ? 0.85 : 0.55,
              weight: highlighted ? 3 : 1.5,
            }}
            eventHandlers={{
              click: () => onSelectParcel(p.assessmentNumber),
            }}
          >
            <Popup>
              <strong>{p.assessmentNumber}</strong>
              <br />
              {p.address}
              <br />
              {p.landUse} · uplift{" "}
              <strong style={{ color: "#10b981" }}>
                +${p.estimatedUpliftAmount.toLocaleString()}/yr
              </strong>
            </Popup>
          </CircleMarker>
        );
      })}

        <PolygonStandIn rings={[]} />
      </MapContainer>
    </div>
  );
}

/**
 * Tiny no-op component placeholder — kept only because react-leaflet's
 * Polygon import was needed at the top to type-check; some bundlers tree-
 * shake away the unused import otherwise. This keeps the import live.
 */
function PolygonStandIn({ rings }: { rings: Array<Array<[number, number]>> }) {
  if (rings.length === 0) return null;
  return <RLPolygon positions={rings} />;
}
