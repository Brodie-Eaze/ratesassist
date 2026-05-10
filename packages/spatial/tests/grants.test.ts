/**
 * Characterization tests for fetchRecentlyGrantedTenements + tenid parsing.
 *
 * Pin tenid raw → display, MINEDEX URL encoding, provisional flag math,
 * happy + error paths against a mocked SLIP fetcher.
 */

import { describe, it, expect, vi } from "vitest";

import {
  fetchRecentlyGrantedTenements,
  parseTenidDisplay,
  buildMinedexUrl,
  tenementTypeLabel,
  tenementBoundingBox,
  pointInTenementBbox,
  MINEDEX_DETAIL_URL_BASE,
  SEEDED_GRANTS,
} from "../src/grants.js";

function geojsonResponse(features: unknown[], status = 200): Response {
  return new Response(
    JSON.stringify({ type: "FeatureCollection", features }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function makeFeature(props: Record<string, unknown>): unknown {
  return {
    type: "Feature",
    properties: props,
    geometry: { type: "Point", coordinates: [117.7935, -22.694] },
  };
}

describe("parseTenidDisplay", () => {
  it("parses canonical letter+2-spaces+7-digits", () => {
    expect(parseTenidDisplay("M  4701569")).toBe("M 47/1569");
    expect(parseTenidDisplay("E  4500876")).toBe("E 45/876");
    expect(parseTenidDisplay("P  2008221")).toBe("P 20/8221");
  });

  it("strips leading zeros from the trailing 5-digit number only (field is preserved verbatim per spec)", () => {
    expect(parseTenidDisplay("L  4500103")).toBe("L 45/103");
    expect(parseTenidDisplay("G  0800042")).toBe("G 08/42");
  });

  it("returns null for malformed input", () => {
    expect(parseTenidDisplay("M 47/1569")).toBeNull();
    expect(parseTenidDisplay("MM 4701569")).toBeNull();
    expect(parseTenidDisplay("")).toBeNull();
  });
});

describe("buildMinedexUrl", () => {
  it("percent-encodes the raw tenid (preserves the two spaces)", () => {
    const url = buildMinedexUrl("M  4701569");
    expect(url).toBe(`${MINEDEX_DETAIL_URL_BASE}M%20%204701569`);
  });

  it("uses the canonical detail base", () => {
    expect(MINEDEX_DETAIL_URL_BASE).toBe(
      "https://minedex.dmirs.wa.gov.au/Web/tenements/details/",
    );
  });
});

describe("tenementTypeLabel", () => {
  it("maps known WA codes", () => {
    expect(tenementTypeLabel("M")).toBe("Mining Lease");
    expect(tenementTypeLabel("E")).toBe("Exploration Licence");
    expect(tenementTypeLabel("P")).toBe("Prospecting Licence");
    expect(tenementTypeLabel("G")).toBe("General-Purpose Lease");
    expect(tenementTypeLabel("L")).toBe("Miscellaneous Licence");
    expect(tenementTypeLabel("R")).toBe("Retention Licence");
  });

  it("flags unknown codes with a question mark", () => {
    expect(tenementTypeLabel("Z")).toBe("Z?");
  });
});

describe("fetchRecentlyGrantedTenements — happy path", () => {
  it("returns parsed grants from a mocked SLIP response, sorted newest first", async () => {
    const NOW = Date.parse("2026-05-10T00:00:00Z");
    const fetcher = vi.fn().mockImplementation(async () =>
      geojsonResponse([
        makeFeature({
          tenid: "M  4701569",
          tenstatus: "LIVE",
          type: "M",
          grantdate: Date.parse("2026-05-01T00:00:00Z"),
          holder1: "Pilbara Resources Pty Ltd",
        }),
        makeFeature({
          tenid: "G  0800042",
          tenstatus: "LIVE",
          type: "G",
          grantdate: Date.parse("2026-04-22T00:00:00Z"),
          holder1: "Karratha Iron Holdings",
        }),
      ]),
    );

    const result = await fetchRecentlyGrantedTenements({
      sinceMs: NOW - 30 * 86_400_000,
      now: () => NOW,
      fetcher,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("live");
    expect(result.grants).toHaveLength(2);
    // Newest first.
    expect(result.grants[0]!.tenementId).toBe("M  4701569");
    expect(result.grants[0]!.tenementIdDisplay).toBe("M 47/1569");
    expect(result.grants[0]!.detailUrl).toBe(
      `${MINEDEX_DETAIL_URL_BASE}M%20%204701569`,
    );
    // Provisional: granted 9 days before NOW → within 30-day window.
    expect(result.grants[0]!.provisional).toBe(true);
  });

  it("flips provisional=false once the 30-day window has elapsed", async () => {
    const NOW = Date.parse("2026-06-15T00:00:00Z");
    const fetcher = vi.fn().mockImplementation(async () =>
      geojsonResponse([
        makeFeature({
          tenid: "M  4701569",
          tenstatus: "LIVE",
          type: "M",
          grantdate: Date.parse("2026-05-01T00:00:00Z"), // 45 days before NOW
          holder1: "Old Tenement Co",
        }),
      ]),
    );
    const result = await fetchRecentlyGrantedTenements({
      sinceMs: NOW - 90 * 86_400_000,
      now: () => NOW,
      fetcher,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grants[0]!.provisional).toBe(false);
  });

  it("applies the type allow-list", async () => {
    const NOW = Date.parse("2026-05-10T00:00:00Z");
    const fetcher = vi.fn().mockImplementation(async () =>
      geojsonResponse([
        makeFeature({ tenid: "M  4701569", tenstatus: "LIVE", type: "M", grantdate: NOW - 86_400_000, holder1: "A" }),
        makeFeature({ tenid: "E  4500876", tenstatus: "LIVE", type: "E", grantdate: NOW - 2 * 86_400_000, holder1: "B" }),
      ]),
    );
    const result = await fetchRecentlyGrantedTenements({
      sinceMs: NOW - 30 * 86_400_000,
      types: ["M", "G", "L"],
      now: () => NOW,
      fetcher,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grants).toHaveLength(1);
    expect(result.grants[0]!.type).toBe("M");
  });
});

describe("fetchRecentlyGrantedTenements — error paths", () => {
  it("returns invalid_input for non-positive sinceMs", async () => {
    const result = await fetchRecentlyGrantedTenements({
      sinceMs: 0,
      fetcher: vi.fn(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_input");
  });

  it("falls back to seeded when SLIP errors AND seededFeatures supplied", async () => {
    const NOW = Date.parse("2026-05-10T00:00:00Z");
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response("oops", { status: 500 }));
    const result = await fetchRecentlyGrantedTenements({
      sinceMs: NOW - 30 * 86_400_000,
      now: () => NOW,
      fetcher,
      seededFeatures: SEEDED_GRANTS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("seeded");
    expect(result.grants.length).toBeGreaterThan(0);
    expect(result.note).toMatch(/SLIP unreachable/);
  });

  it("returns upstream_error when SLIP fails AND no seeded provided", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response("oops", { status: 500 }));
    const result = await fetchRecentlyGrantedTenements({
      sinceMs: Date.parse("2026-04-10T00:00:00Z"),
      fetcher,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("upstream_error");
  });

  it("returns timeout when caller pre-aborts", async () => {
    const fetcher = vi.fn();
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await fetchRecentlyGrantedTenements({
      sinceMs: Date.parse("2026-04-10T00:00:00Z"),
      fetcher,
      signal: ctrl.signal,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("timeout");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("tenementBoundingBox / pointInTenementBbox", () => {
  it("returns a [lng,lat,lng,lat] tuple for a Point geometry", () => {
    const bbox = tenementBoundingBox({
      type: "Point",
      coordinates: [117.7935, -22.694],
    });
    expect(bbox).toEqual([117.7935, -22.694, 117.7935, -22.694]);
  });

  it("computes a polygon bbox correctly", () => {
    const bbox = tenementBoundingBox({
      type: "Polygon",
      coordinates: [
        [
          [117.0, -23.0],
          [117.5, -23.0],
          [117.5, -22.5],
          [117.0, -22.5],
          [117.0, -23.0],
        ],
      ],
    });
    expect(bbox).toEqual([117.0, -23.0, 117.5, -22.5]);
  });

  it("pointInTenementBbox returns true inside, false outside", () => {
    const geom = {
      type: "Polygon" as const,
      coordinates: [
        [
          [117.0, -23.0],
          [117.5, -23.0],
          [117.5, -22.5],
          [117.0, -22.5],
          [117.0, -23.0],
        ],
      ],
    };
    expect(pointInTenementBbox(geom, [117.25, -22.75])).toBe(true);
    expect(pointInTenementBbox(geom, [120.0, -22.75])).toBe(false);
  });
});

describe("SEEDED_GRANTS fixture", () => {
  it("contains 5 plausible grants with correct MINEDEX URL encoding", () => {
    expect(SEEDED_GRANTS).toHaveLength(5);
    for (const g of SEEDED_GRANTS) {
      expect(g.detailUrl.startsWith(MINEDEX_DETAIL_URL_BASE)).toBe(true);
      expect(g.detailUrl).toContain("%20%20");
    }
  });
});
