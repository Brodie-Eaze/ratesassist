/**
 * @ratesassist/spatial/tenementMapping — LIVE DMIRS feature → typed Tenement.
 *
 * The missing half of "live data": `fetchSlipFeatures` already returns LIVE
 * GeoJSON from the SLIP ArcGIS REST service, but nothing mapped those raw
 * ArcGIS attributes into the contract's `Tenement` shape the recovery engine
 * consumes. This module is that mapper + a `fetchLiveTenementsForBbox` entry
 * point, so the data pipeline can populate `tenementsByAssessment` from LIVE
 * register data instead of seeded fixtures.
 *
 * Field handling mirrors grants.ts (`tenid`/`fmt_tenid`, `holder1..9`,
 * `grantdate`, lowercase-keyed props) so the two stay consistent. Honest by
 * construction: a feature missing a tenid maps to null (skipped, not faked);
 * `isProducing` defaults FALSE here and is set TRUE only by a MINEDEX cross-
 * reference (tenement registers don't reliably carry production status).
 */

import type { BoundingBox, Tenement, TenementStatus, TenementType, LatLng } from "@ratesassist/contract";

import type { GeoJsonFeature, SlipFetchResult } from "./types.js";
import { fetchSlipFeatures, type FetchSlipFeaturesOptions } from "./slip.js";

// ===== Field pickers (mirror grants.ts; props are lowercase-keyed) =====

function lcProps(props: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) out[k.toLowerCase()] = v;
  return out;
}

function pickString(props: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = props[k.toLowerCase()];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function pickNumber(props: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const v = props[k.toLowerCase()];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim().length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickEpochMs(props: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const v = props[k.toLowerCase()];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string" && v.trim().length > 0) {
      const n = Date.parse(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

function pickHolder(props: Record<string, unknown>): string {
  for (let i = 1; i <= 9; i++) {
    const v = props[`holder${i}`];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  const single = pickString(props, ["holder"]);
  return single ?? "(holder undisclosed)";
}

// ===== Normalisers =====

const VALID_TYPES = new Set<TenementType>(["M", "E", "P", "G", "L"]);

function normaliseType(raw: string | undefined, tenid: string): TenementType {
  const c = (raw ?? tenid).trim().charAt(0).toUpperCase();
  return VALID_TYPES.has(c as TenementType) ? (c as TenementType) : "E";
}

/** Map a DMIRS status string to the contract's TenementStatus (default Live for "live"). */
function normaliseStatus(raw: string | undefined): TenementStatus {
  const s = (raw ?? "").trim().toUpperCase();
  if (s.startsWith("LIVE") || s.startsWith("GRANT")) return "Live";
  if (s.startsWith("PEND") || s.startsWith("APP")) return "Pending";
  if (s.startsWith("SURR")) return "Surrendered";
  if (s.startsWith("CANC") || s.startsWith("DEAD") || s.startsWith("EXPIR")) return "Cancelled";
  return "Live"; // SLIP's mining-tenement layer is the LIVE layer by default
}

function splitCommodity(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];
  return raw
    .split(/[,;/]+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function isoDate(ms: number | undefined): string {
  return ms === undefined ? "" : new Date(ms).toISOString().slice(0, 10);
}

/** GeoJSON [lng,lat] outer-ring → contract LatLng[] [lat,lng] (Leaflet order). Empty for points. */
function geometryToPolygon(geometry: GeoJsonFeature["geometry"]): readonly LatLng[] {
  const g = geometry as { type?: string; coordinates?: unknown };
  let ring: unknown;
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) ring = g.coordinates[0];
  else if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    const first = g.coordinates[0];
    ring = Array.isArray(first) ? first[0] : undefined;
  } else return []; // Point / unknown → no polygon
  if (!Array.isArray(ring)) return [];
  const out: LatLng[] = [];
  for (const pt of ring) {
    if (Array.isArray(pt) && typeof pt[0] === "number" && typeof pt[1] === "number") {
      out.push([pt[1], pt[0]] as LatLng); // [lng,lat] → [lat,lng]
    }
  }
  return out;
}

// ===== Public mapper =====

/**
 * Map ONE live SLIP/DMIRS GeoJSON feature → a contract `Tenement`. Returns null
 * when no tenement id is present (skip, don't fabricate). `isProducing` is
 * FALSE here; the MINEDEX cross-reference is what flips it true.
 */
export function mapSlipFeatureToTenement(feature: GeoJsonFeature): Tenement | null {
  const props = lcProps(feature.properties ?? {});
  const tenid = pickString(props, ["tenid", "fmt_tenid", "tenement_id"]);
  if (tenid === undefined) return null;

  return {
    tenementId: tenid,
    type: normaliseType(pickString(props, ["type"]), tenid),
    status: normaliseStatus(pickString(props, ["tenstatus", "status"])),
    holder: pickHolder(props),
    holderAbn: null, // resolved separately via ABN Lookup
    commodity: splitCommodity(pickString(props, ["commodity"])),
    grantedDate: isoDate(pickEpochMs(props, ["grantdate", "startdate"])),
    expiryDate: isoDate(pickEpochMs(props, ["enddate", "expirydate"])),
    areaHectares: pickNumber(props, ["legal_area", "area_ha", "graphic_ar"]) ?? 0,
    intersectsAssessmentNumbers: [], // spatial intersection is a separate step
    isProducing: false, // set TRUE only by MINEDEX cross-reference
    lastWorkProgramYear: null,
    polygon: geometryToPolygon(feature.geometry),
  };
}

/** Map a feature collection's worth of live features → Tenement[] (skips unmappable). */
export function mapSlipFeaturesToTenements(
  features: readonly GeoJsonFeature[],
): readonly Tenement[] {
  const out: Tenement[] = [];
  for (const f of features) {
    const t = mapSlipFeatureToTenement(f);
    if (t !== null) out.push(t);
  }
  return out;
}

/**
 * LIVE entry point: fetch DMIRS mining-tenement features for a bbox from the
 * SLIP ArcGIS REST service (`fetchSlipFeatures`, already live) and map them to
 * typed `Tenement` records. Returns `{ ok:false }` on fetch failure so callers
 * can fall back to seeded data — never throws.
 */
export async function fetchLiveTenementsForBbox(
  bbox: BoundingBox,
  opts: FetchSlipFeaturesOptions = {},
): Promise<
  | { readonly ok: true; readonly source: "live" | "cache"; readonly tenements: readonly Tenement[] }
  | { readonly ok: false; readonly error: string }
> {
  const res: SlipFetchResult = await fetchSlipFeatures("miningTenements", bbox, opts);
  if (!res.ok) return { ok: false, error: res.error };
  // "seeded" is not a SlipFetchResult source (slip.ts returns live|cache); narrow defensively.
  const source = res.source === "cache" ? "cache" : "live";
  return { ok: true, source, tenements: mapSlipFeaturesToTenements(res.features) };
}
