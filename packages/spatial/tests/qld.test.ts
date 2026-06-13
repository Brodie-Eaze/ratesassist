/**
 * QLD QSpatial mining-tenure adapter — allowlist + probe/fallback behaviour.
 *
 * Every test injects a `fetcher`; we never reach the network. Mirrors the
 * DMIRS + SARIG adapter contracts so QLD mining detection behaves identically
 * and honestly (no "live" label without real parsed feature data).
 *
 * QLD context: Queensland Open Data licence (open, attribution). Tenure types
 * covered: EPM (Exploration Permit for Minerals), ML (Mining Lease),
 * MDL (Mineral Development Licence), MC (Mining Claim), PC (Petroleum).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchQldTenementsForRegion,
  isAllowedQldBase,
  parseQldFeatureCollection,
  __resetQldCacheForTests,
} from "../src/qld.js";
import type { GeoJsonFeature } from "../src/types.js";

const SEED: readonly GeoJsonFeature[] = [
  {
    type: "Feature",
    properties: { tenement: "ML 70244", holder: "BHP Coal Pty Ltd", status: "GRANTED" },
    geometry: { type: "Point", coordinates: [148.5, -22.5] }, // Bowen Basin
  },
];

function okResponse(): Response {
  return new Response("<wfs:WFS_Capabilities/>", { status: 200 });
}

beforeEach(() => {
  __resetQldCacheForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─── allowlist ──────────────────────────────────────────────────────────────

describe("isAllowedQldBase (allowlist)", () => {
  it("accepts the official QSpatial WFS endpoint", () => {
    expect(
      isAllowedQldBase(
        "https://spatial-gis.information.qld.gov.au/arcgis/services/Economy/MinesPermitsCurrent/MapServer/WFSServer",
      ),
    ).toBe(true);
  });

  it("accepts any path under the official QSpatial host", () => {
    expect(
      isAllowedQldBase("https://spatial-gis.information.qld.gov.au/arcgis/rest/services/"),
    ).toBe(true);
  });

  it("rejects a foreign host", () => {
    expect(isAllowedQldBase("https://evil.example.com/wfs")).toBe(false);
  });

  it("rejects the correct host over plain HTTP", () => {
    expect(
      isAllowedQldBase(
        "http://spatial-gis.information.qld.gov.au/arcgis/services/Economy/MinesPermitsCurrent/MapServer/WFSServer",
      ),
    ).toBe(false);
  });

  it("rejects a lookalike domain", () => {
    expect(
      isAllowedQldBase("https://spatial-gis.information.qld.gov.au.evil.com/wfs"),
    ).toBe(false);
  });
});

// ─── fetchQldTenementsForRegion ──────────────────────────────────────────────

describe("fetchQldTenementsForRegion", () => {
  it("rejects an empty region key", async () => {
    const r = await fetchQldTenementsForRegion("  ", { fetcher: vi.fn() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
  });

  it("probe reachable + seeded → source 'seeded' (honest: no GetFeature parse yet)", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResponse()) as unknown as typeof fetch;
    const r = await fetchQldTenementsForRegion("ISAAC", { fetcher, seededFeatures: SEED });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("seeded");
      expect(r.features).toHaveLength(1);
      expect(r.note).toMatch(/reachable/i);
    }
  });

  it("probe 304 Not Modified → treated as reachable (seeded result returned)", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 304 })) as unknown as typeof fetch;
    const r = await fetchQldTenementsForRegion("BOWEN", { fetcher, seededFeatures: SEED });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("seeded");
      expect(r.features).toHaveLength(1);
    }
  });

  it("probe fails + seeded → seeded fallback with a probe-failed note", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const r = await fetchQldTenementsForRegion("ISAAC", { fetcher, seededFeatures: SEED });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("seeded");
      expect(r.note).toMatch(/probe failed/i);
    }
  });

  it("probe fails + no seed → structured upstream_error", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const r = await fetchQldTenementsForRegion("ISAAC", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("upstream_error");
  });

  it("probe reachable + no seed → no_layer_responded error", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResponse()) as unknown as typeof fetch;
    const r = await fetchQldTenementsForRegion("ISAAC", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("no_layer_responded");
  });

  it("caches within TTL — a second call does not re-probe", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResponse()) as unknown as typeof fetch;
    await fetchQldTenementsForRegion("CACHE-TEST", { fetcher, seededFeatures: SEED });
    await fetchQldTenementsForRegion("CACHE-TEST", { fetcher, seededFeatures: SEED });
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("different region keys are cached independently", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResponse()) as unknown as typeof fetch;
    await fetchQldTenementsForRegion("REGION-A", { fetcher, seededFeatures: SEED });
    await fetchQldTenementsForRegion("REGION-B", { fetcher, seededFeatures: SEED });
    // Two distinct cache keys → two probe calls
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("passes correlationId through on failure", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("connection refused")) as unknown as typeof fetch;
    const r = await fetchQldTenementsForRegion("QLD-CORR", {
      fetcher,
      correlationId: "test-corr-id",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("upstream_error");
      expect((r as { correlationId?: string }).correlationId).toBe("test-corr-id");
    }
  });

  it("respects caller abort signal before fetch starts", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetcher = vi.fn() as unknown as typeof fetch;
    const r = await fetchQldTenementsForRegion("QLD-ABORT", {
      fetcher,
      signal: ctrl.signal,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("timeout");
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

// ─── parseQldFeatureCollection ────────────────────────────────────────────────

describe("parseQldFeatureCollection", () => {
  it("returns the collection for a valid FeatureCollection", () => {
    const fc = parseQldFeatureCollection({ type: "FeatureCollection", features: SEED });
    expect(fc).not.toBeNull();
    expect(fc?.features).toHaveLength(1);
  });

  it("returns null for a non-FeatureCollection type", () => {
    expect(parseQldFeatureCollection({ type: "Feature" })).toBeNull();
  });

  it("returns null when features is not an array", () => {
    expect(
      parseQldFeatureCollection({ type: "FeatureCollection", features: "nope" }),
    ).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseQldFeatureCollection(null)).toBeNull();
  });

  it("returns null for primitive input", () => {
    expect(parseQldFeatureCollection(42)).toBeNull();
    expect(parseQldFeatureCollection("string")).toBeNull();
  });
});
