/**
 * Live DMIRS feature → Tenement mapper. The "parse live GetFeature" core: turns
 * raw SLIP ArcGIS attributes into the contract Tenement shape the recovery
 * engine consumes. Pure (no network); fetchLiveTenementsForBbox is exercised
 * with an injected fetcher.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  mapSlipFeatureToTenement,
  mapSlipFeaturesToTenements,
  fetchLiveTenementsForBbox,
} from "../src/tenementMapping.js";
import { __resetSlipCacheForTests } from "../src/slip.js";
import type { GeoJsonFeature } from "../src/types.js";

// fetchSlipFeatures caches by bbox — clear it so tests don't see each other's results.
beforeEach(() => __resetSlipCacheForTests());

function feature(props: Record<string, unknown>, geometry?: GeoJsonFeature["geometry"]): GeoJsonFeature {
  return {
    type: "Feature",
    properties: props,
    geometry: geometry ?? { type: "Point", coordinates: [117.79, -22.69] },
  };
}

describe("mapSlipFeatureToTenement", () => {
  it("maps a full DMIRS feature to a typed Tenement", () => {
    const t = mapSlipFeatureToTenement(
      feature(
        {
          tenid: "M  4701569",
          type: "M",
          tenstatus: "LIVE",
          holder1: "Pilbara Resources Pty Ltd",
          commodity: "Iron Ore, Gold",
          grantdate: "2026-05-01",
          enddate: "2047-05-01",
          legal_area: 1234.5,
        },
        { type: "Polygon", coordinates: [[[117.79, -22.69], [117.80, -22.69], [117.80, -22.70], [117.79, -22.69]]] },
      ),
    );
    expect(t).not.toBeNull();
    expect(t!.tenementId).toBe("M  4701569");
    expect(t!.type).toBe("M");
    expect(t!.status).toBe("Live");
    expect(t!.holder).toBe("Pilbara Resources Pty Ltd");
    expect(t!.commodity).toEqual(["Iron Ore", "Gold"]);
    expect(t!.grantedDate).toBe("2026-05-01");
    expect(t!.expiryDate).toBe("2047-05-01");
    expect(t!.areaHectares).toBe(1234.5);
    expect(t!.isProducing).toBe(false); // MINEDEX cross-ref flips this, not the tenement layer
    expect(t!.polygon[0]).toEqual([-22.69, 117.79]); // [lng,lat] → [lat,lng]
  });

  it("handles field-name variants + derives type from tenid when 'type' absent", () => {
    const t = mapSlipFeatureToTenement(feature({ TENID: "E  4500876", tenstatus: "PENDING", HOLDER: "Acme" }));
    expect(t!.tenementId).toBe("E  4500876");
    expect(t!.type).toBe("E"); // from the tenid's first char
    expect(t!.status).toBe("Pending");
    expect(t!.holder).toBe("Acme");
  });

  it("normalises statuses", () => {
    expect(mapSlipFeatureToTenement(feature({ tenid: "M1", tenstatus: "SURRENDERED" }))!.status).toBe("Surrendered");
    expect(mapSlipFeatureToTenement(feature({ tenid: "M1", tenstatus: "DEAD" }))!.status).toBe("Cancelled");
    expect(mapSlipFeatureToTenement(feature({ tenid: "M1" }))!.status).toBe("Live"); // default
  });

  it("falls back through holder1..9", () => {
    const t = mapSlipFeatureToTenement(feature({ tenid: "M1", holder3: "Third Holder Pty Ltd" }));
    expect(t!.holder).toBe("Third Holder Pty Ltd");
  });

  it("returns null when there is no tenement id", () => {
    expect(mapSlipFeatureToTenement(feature({ holder1: "Nobody" }))).toBeNull();
  });

  it("mapSlipFeaturesToTenements skips unmappable features", () => {
    const out = mapSlipFeaturesToTenements([
      feature({ tenid: "M1" }),
      feature({ holder1: "no tenid" }),
      feature({ fmt_tenid: "G2" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.tenementId)).toEqual(["M1", "G2"]);
  });
});

describe("fetchLiveTenementsForBbox", () => {
  const BBOX = [117.0, -23.0, 117.5, -22.5] as const;

  it("fetches live features and maps them to tenements", async () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { tenid: "M  4701569", tenstatus: "LIVE", type: "M" }, geometry: { type: "Point", coordinates: [117.2, -22.8] } },
      ],
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(fc), { status: 200 })) as unknown as typeof fetch;
    const r = await fetchLiveTenementsForBbox(BBOX, { fetcher });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("live");
      expect(r.tenements).toHaveLength(1);
      expect(r.tenements[0]!.tenementId).toBe("M  4701569");
    }
  });

  it("returns ok:false on fetch failure (caller falls back to seeded)", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const r = await fetchLiveTenementsForBbox(BBOX, { fetcher });
    expect(r.ok).toBe(false);
  });
});
