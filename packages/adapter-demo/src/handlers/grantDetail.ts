/**
 * `get_grant_detail` handler — full briefing for a single granted tenement.
 *
 * Joins three sources:
 *   1. The recently-granted tenements feed (SLIP live, with seeded fallback)
 *      to find one tenement by raw tenid.
 *   2. The cadastral spatial layer — but the demo store has no real lot/plan
 *      geometry, so we fall back to a deterministic synthetic intersection:
 *      pick up to 5 demo properties whose centroid is closest to the
 *      tenement's bounding-box centre, capped at 50 km.
 *   3. The recovery engine's `estimateUplift` to put a dollar figure per
 *      affected parcel.
 *
 * The response is honest about its provenance: every parcel is tagged with
 * `cadastreSource` ("live" | "seeded") and synthetic intersections are
 * labelled accordingly so the UI can disclose the limitation.
 */

import type { schemas } from "@ratesassist/contract";
import {
  fetchRecentlyGrantedTenements,
  SEEDED_GRANTS,
  parseTenidDisplay,
  buildMinedexUrl,
  tenementTypeLabel,
  type GrantedTenement,
} from "@ratesassist/spatial";
import type { Property } from "@ratesassist/contract";
import { estimateUplift } from "@ratesassist/recovery-engine";

import type { RequestContext } from "../runtime/context.js";
import { failure } from "../runtime/errors.js";

/** Max number of synthetic-fallback parcels to surface. */
const MAX_SYNTHETIC_PARCELS = 5;

/** Max distance for synthetic centroid match (km). Beyond this, no match. */
const SYNTHETIC_MAX_KM = 50;

type GrantDetailParcel = {
  readonly assessmentNumber: string;
  readonly address: string;
  readonly landUse: string;
  readonly valuation: number;
  readonly annualRates: number;
  readonly estimatedUpliftSeverity: "high" | "medium" | "low";
  readonly estimatedUpliftAmount: number;
};

/** Severity heuristic per spec: M+Rural/Vacant=high; E+Rural=medium; else low. */
function severityFor(
  tenementType: string,
  landUse: string,
): "high" | "medium" | "low" {
  const t = tenementType.toUpperCase();
  const lu = landUse.toLowerCase();
  if (t === "M" && (lu === "rural" || lu === "vacant")) return "high";
  if (t === "E" && lu === "rural") return "medium";
  if (t === "G" && (lu === "rural" || lu === "vacant")) return "high";
  return "low";
}

/** Geometry centroid for Polygon / MultiPolygon / Point — returns [lng, lat]. */
function geometryCentroid(
  geom: GrantedTenement["geometry"],
): { lat: number; lng: number } | null {
  if (geom.type === "Point") {
    const [lng, lat] = geom.coordinates as readonly number[] as [number, number];
    return { lat, lng };
  }
  // Walk all rings to derive a bbox; use bbox centre.
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const rings: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> =
    geom.type === "Polygon"
      ? (geom.coordinates as ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>)
      : (geom.coordinates as ReadonlyArray<ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>>).flat();
  for (const ring of rings) {
    for (const pt of ring) {
      const lng = pt[0]!;
      const lat = pt[1]!;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

/** Geometry bbox: [minLng, minLat, maxLng, maxLat]. */
function geometryBbox(
  geom: GrantedTenement["geometry"],
): [number, number, number, number] | null {
  if (geom.type === "Point") {
    const [lng, lat] = geom.coordinates as readonly number[] as [number, number];
    return [lng, lat, lng, lat];
  }
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const rings: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> =
    geom.type === "Polygon"
      ? (geom.coordinates as ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>)
      : (geom.coordinates as ReadonlyArray<ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>>).flat();
  for (const ring of rings) {
    for (const pt of ring) {
      const lng = pt[0]!;
      const lat = pt[1]!;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  if (!Number.isFinite(minLat)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

/** Number of vertices in a geometry — for the metadata card. */
function geometryVertexCount(geom: GrantedTenement["geometry"]): number {
  if (geom.type === "Point") return 1;
  let total = 0;
  const rings: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> =
    geom.type === "Polygon"
      ? (geom.coordinates as ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>)
      : (geom.coordinates as ReadonlyArray<ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>>).flat();
  for (const ring of rings) total += ring.length;
  return total;
}

/** Quick area in km² — bbox-derived approximation, fine for display. */
function geometryAreaKm2(geom: GrantedTenement["geometry"]): number {
  const bbox = geometryBbox(geom);
  if (bbox === null) return 0;
  const [minLng, minLat, maxLng, maxLat] = bbox;
  // 1 deg lat ≈ 111 km. 1 deg lng ≈ 111 * cos(lat) km.
  const meanLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const widthKm = (maxLng - minLng) * 111 * Math.cos(meanLat);
  const heightKm = (maxLat - minLat) * 111;
  return Math.max(0, widthKm * heightKm);
}

/** Haversine distance in km. */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

export async function getGrantDetailHandler(
  input: schemas.ToolInputs["get_grant_detail"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const since = ctx.now().getTime() - input.sinceDays * 24 * 60 * 60 * 1000;

  const fetchResult = await fetchRecentlyGrantedTenements({
    sinceMs: since,
    correlationId: ctx.correlationId,
    seededFeatures: SEEDED_GRANTS,
    now: () => ctx.now().getTime(),
  });

  if (!fetchResult.ok) {
    return failure("upstream_error", fetchResult.error, ctx.correlationId, true);
  }

  const grant = fetchResult.grants.find((g) => g.tenementId === input.tenementId);
  if (grant === undefined) {
    // Could be a known tenement that's beyond the lookback window — try
    // building a stub from the tenid itself so the page can still render.
    const display = parseTenidDisplay(input.tenementId);
    if (display === null) {
      return failure(
        "not_found",
        `No grant matches tenement id ${JSON.stringify(input.tenementId)}.`,
        ctx.correlationId,
      );
    }
    return failure(
      "not_found",
      `Tenement ${display} not present in the last ${input.sinceDays} days of grants. Widen sinceDays to see older records.`,
      ctx.correlationId,
    );
  }

  // Synthetic intersection — demo store has no real cadastre. Pick the
  // closest properties to the tenement centroid, capped at SYNTHETIC_MAX_KM.
  const centre = geometryCentroid(grant.geometry);
  const allProps = ctx.store.snapshotProperties();
  type Scored = { property: Property; distanceKm: number };
  const scored: Scored[] =
    centre === null
      ? []
      : allProps
          .map((p): Scored => ({
            property: p,
            distanceKm: haversineKm(centre, { lat: p.lat, lng: p.lng }),
          }))
          .filter((s) => s.distanceKm <= SYNTHETIC_MAX_KM)
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, MAX_SYNTHETIC_PARCELS);

  const intersectingParcels: GrantDetailParcel[] = scored.map(({ property }) => {
    const sev = severityFor(grant.type, property.landUse);
    const { estUplift } = estimateUplift(property.annualRates, sev);
    return {
      assessmentNumber: property.assessmentNumber,
      address: `${property.address}, ${property.suburb} ${property.state} ${property.postcode}`,
      landUse: property.landUse,
      valuation: property.valuation,
      annualRates: property.annualRates,
      estimatedUpliftSeverity: sev,
      estimatedUpliftAmount: estUplift,
    };
  });

  const cadastreSource: "live" | "seeded" = "seeded";

  const bbox = geometryBbox(grant.geometry);
  const vertexCount = geometryVertexCount(grant.geometry);
  const areaKm2 = geometryAreaKm2(grant.geometry);

  const parcelLines = intersectingParcels.length
    ? intersectingParcels.map(
        (p, i) =>
          `  ${i + 1}. ${p.assessmentNumber} — ${p.address} (${p.landUse}) — uplift ~$${p.estimatedUpliftAmount.toLocaleString()}/yr (${p.estimatedUpliftSeverity})`,
      )
    : ["  (no intersecting council-registered parcels)"];

  const text = [
    `Grant detail: ${grant.tenementIdDisplay} (${grant.typeLabel})`,
    `Holder: ${grant.holder}`,
    `Granted: ${grant.grantDate}${grant.provisional ? "  [PROVISIONAL — 30-day appeal window]" : ""}`,
    `Geometry: ${grant.geometry.type}, ${vertexCount} vertices, ${areaKm2.toFixed(1)} km²`,
    `MINEDEX: ${grant.detailUrl}`,
    `Source: grants=${fetchResult.source}, cadastre=${cadastreSource} (synthetic intersection — demo data only)`,
    ``,
    `Affected parcels (${intersectingParcels.length}):`,
    ...parcelLines,
  ].join("\n");

  return {
    ok: true,
    output: text,
    data: {
      grant,
      intersectingParcels,
      cadastreSource,
      cadastreNote:
        "synthetic intersection — demo data only; production uses Landgate cadastre with PostGIS spatial join.",
      geometryBbox: bbox,
      geometryVertexCount: vertexCount,
      geometryAreaKm2: areaKm2,
      grantsSource: fetchResult.source,
      refreshedAt: fetchResult.queriedAt,
      minedexUrl: buildMinedexUrl(grant.tenementId),
      typeLabel: tenementTypeLabel(grant.type),
    },
    mutated: false,
  };
}
