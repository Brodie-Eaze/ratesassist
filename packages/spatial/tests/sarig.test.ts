/**
 * SA SARIG mineral-tenements adapter — allowlist + probe/fallback behaviour.
 * Every test injects a `fetcher`; we never reach the network. Mirrors the
 * DMIRS adapter's contract (the WA sibling) so SA mining detection behaves
 * identically + honestly (no "live" label without real feature data).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchSarigTenementsForRegion,
  isAllowedSarigBase,
  parseSarigFeatureCollection,
  __resetSarigCacheForTests,
} from "../src/sarig.js";
import type { GeoJsonFeature } from "../src/types.js";

const SEED: readonly GeoJsonFeature[] = [
  {
    type: "Feature",
    properties: { tenement: "EL 1234", holder: "Acme Resources" },
    geometry: { type: "Point", coordinates: [138.6, -34.9] },
  },
];

function okResponse(): Response {
  return new Response("<wfs:Capabilities/>", { status: 200 });
}

beforeEach(() => {
  __resetSarigCacheForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("isAllowedSarigBase (allowlist)", () => {
  it("accepts the official SARIG services host", () => {
    expect(isAllowedSarigBase("https://services.sarig.sa.gov.au/vector/mineral_tenements/wfs")).toBe(true);
  });
  it("rejects any other host", () => {
    expect(isAllowedSarigBase("https://evil.example.com/wfs")).toBe(false);
    expect(isAllowedSarigBase("http://services.sarig.sa.gov.au/wfs")).toBe(false); // not https
  });
});

describe("fetchSarigTenementsForRegion", () => {
  it("rejects an empty region key", async () => {
    const r = await fetchSarigTenementsForRegion("  ", { fetcher: vi.fn() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
  });

  it("probe reachable + seeded → source 'seeded' (honest: no GetFeature parse yet)", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResponse()) as unknown as typeof fetch;
    const r = await fetchSarigTenementsForRegion("SA-COUNCIL", { fetcher, seededFeatures: SEED });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("seeded");
      expect(r.features).toHaveLength(1);
      expect(r.note).toMatch(/reachable/i);
    }
  });

  it("probe fails + seeded → seeded fallback with a probe-failed note", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const r = await fetchSarigTenementsForRegion("SA-COUNCIL", { fetcher, seededFeatures: SEED });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("seeded");
      expect(r.note).toMatch(/probe failed/i);
    }
  });

  it("probe fails + no seed → structured upstream_error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const r = await fetchSarigTenementsForRegion("SA-COUNCIL", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("upstream_error");
  });

  it("caches within TTL — a second call does not re-probe", async () => {
    const fetcher = vi.fn().mockResolvedValue(okResponse()) as unknown as typeof fetch;
    await fetchSarigTenementsForRegion("SA-CACHE", { fetcher, seededFeatures: SEED });
    await fetchSarigTenementsForRegion("SA-CACHE", { fetcher, seededFeatures: SEED });
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});

describe("parseSarigFeatureCollection", () => {
  it("returns the collection for a valid FeatureCollection", () => {
    const fc = parseSarigFeatureCollection({ type: "FeatureCollection", features: SEED });
    expect(fc).not.toBeNull();
    expect(fc?.features).toHaveLength(1);
  });
  it("returns null for non-FeatureCollection payloads", () => {
    expect(parseSarigFeatureCollection(null)).toBeNull();
    expect(parseSarigFeatureCollection({ type: "Feature" })).toBeNull();
    expect(parseSarigFeatureCollection({ type: "FeatureCollection", features: "nope" })).toBeNull();
  });
});
