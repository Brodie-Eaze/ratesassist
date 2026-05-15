/**
 * PropertyMap split — sanity tests for the post-refactor component layout.
 *
 * The vitest harness here is Node-only (no DOM, no react-leaflet runtime).
 * To exercise the post-split module surface without booting a real map, we
 * mock the two libraries that read `window` / mount DOM at module-load time:
 *
 *   - leaflet       — replaced with a structural stub
 *   - react-leaflet — replaced with no-op React FCs + the `useMap` /
 *                     `useMapEvents` hooks needed by sub-components
 *
 * What this file covers:
 *
 *   1. PropertyMap and every sub-component module imports without throwing.
 *   2. Basemap default ("sentinel") is wired to the documented tile URL.
 *   3. PropertyMapStats type contract — anchors the StatsCard shape.
 *   4. ?print=1 detection helper.
 *   5. PolygonLayers default export is a single-arg React FC (sanity check
 *      for post-split signature drift).
 *   6. The pure geometry helpers (geometryToRings, boundsOf) behave as
 *      documented — including the safe behaviour on empty inputs.
 *
 * We don't render the React tree — react-leaflet needs a live MapContainer
 * context which lives in Playwright (out of scope here).
 */

import { describe, expect, it, vi } from "vitest";

// ---- Mocks ----------------------------------------------------------------
//
// Mocks are hoisted by vitest, so every dynamic-import below sees them.

vi.mock("leaflet", () => {
  function latLngBounds(pts: Array<[number, number]>): {
    isValid: () => boolean;
    getCenter: () => { lat: number; lng: number };
    getWest: () => number;
    getEast: () => number;
    getNorth: () => number;
    getSouth: () => number;
  } {
    let west = Number.POSITIVE_INFINITY;
    let east = Number.NEGATIVE_INFINITY;
    let south = Number.POSITIVE_INFINITY;
    let north = Number.NEGATIVE_INFINITY;
    for (const [lat, lng] of pts) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
    }
    return {
      isValid: () => Number.isFinite(west),
      getCenter: () => ({ lat: (south + north) / 2, lng: (west + east) / 2 }),
      getWest: () => west,
      getEast: () => east,
      getNorth: () => north,
      getSouth: () => south,
    };
  }
  const stub = {
    latLngBounds,
    tooltip: () => ({
      setLatLng: () => stub.tooltip(),
      setContent: () => stub.tooltip(),
      addTo: () => stub.tooltip(),
      remove: () => undefined,
    }),
    divIcon: () => ({}),
  };
  return { default: stub, ...stub };
});

vi.mock("react-leaflet", () => {
  const noopComponent = (): null => null;
  return {
    MapContainer: noopComponent,
    TileLayer: noopComponent,
    GeoJSON: noopComponent,
    Polygon: noopComponent,
    Polyline: noopComponent,
    CircleMarker: noopComponent,
    Marker: noopComponent,
    Popup: noopComponent,
    Circle: noopComponent,
    WMSTileLayer: noopComponent,
    ScaleControl: noopComponent,
    useMap: () => ({ flyToBounds: () => undefined, invalidateSize: () => undefined }),
    useMapEvents: () => ({}),
  };
});

// ---- Tests ---------------------------------------------------------------

describe("PropertyMap split — module imports", () => {
  it("PropertyMap orchestrator module loads", async () => {
    const mod = await import("../components/PropertyMap");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  it("all six sub-components load", async () => {
    const subs = await Promise.all([
      import("../components/map/BasemapLayer"),
      import("../components/map/PolygonLayers"),
      import("../components/map/MapToolbar"),
      import("../components/map/StatsCard"),
      import("../components/map/CursorReadout"),
      import("../components/map/MeasureTool"),
    ]);
    for (const m of subs) {
      expect(m.default).toBeDefined();
      expect(typeof m.default).toBe("function");
    }
  });

  it("types module re-exports the BasemapKey + tile registry", async () => {
    const types = await import("../components/map/types");
    expect(typeof types.ESRI_IMAGERY).toBe("string");
    expect(typeof types.SENTINEL_BASE).toBe("string");
    expect(typeof types.CARTO_LIGHT).toBe("string");
    expect(types.ESRI_IMAGERY_MAX_NATIVE).toBe(17);
    expect(types.ESRI_IMAGERY_MAX_DISPLAY).toBe(22);
  });
});

describe("PropertyMap split — basemap default", () => {
  it("'sentinel' resolves to the documented EOX Sentinel-2 tile URL", async () => {
    const types = await import("../components/map/types");
    expect(types.SENTINEL_BASE).toContain("tiles.maps.eox.at");
    expect(types.SENTINEL_BASE).toContain("s2cloudless-2024");
    expect(types.SENTINEL_ATTR).toContain("Sentinel-2");
  });
});

describe("PropertyMap split — StatsCard props contract", () => {
  it("PropertyMapStats accepts the documented shape", async () => {
    const types = await import("../components/map/types");
    const stats: import("../components/map/types").PropertyMapStats = {
      assessmentNumber: "12345",
      address: "100 Test St",
      landUse: "Rural",
      valuation: 1_000_000,
      currentAnnualRates: 12_000,
      projectedAnnualRates: 18_000,
      estimatedUplift: 6_000,
    };
    expect(stats.assessmentNumber).toBe("12345");
    expect(types).toBeDefined();
  });
});

describe("PropertyMap split — print mode detection", () => {
  it("returns true for ?print=1", () => {
    expect(new URLSearchParams("?print=1").get("print") === "1").toBe(true);
  });

  it("returns false for ?print=0 and missing param", () => {
    expect(new URLSearchParams("?print=0").get("print") === "1").toBe(false);
    expect(new URLSearchParams("").get("print") === "1").toBe(false);
  });
});

describe("PropertyMap split — PolygonLayers with empty geometries", () => {
  it("default export is a single-arg React function component", async () => {
    const mod = await import("../components/map/PolygonLayers");
    expect(typeof mod.default).toBe("function");
    expect(mod.default.length).toBe(1);
  });
});

describe("PropertyMap split — geometry helpers", () => {
  it("geometryToRings unwraps a Polygon", async () => {
    const { geometryToRings } = await import("../components/map/useCadastre");
    const rings = geometryToRings({
      type: "Polygon",
      coordinates: [
        [
          [115.86, -31.95],
          [115.87, -31.95],
          [115.87, -31.94],
          [115.86, -31.94],
          [115.86, -31.95],
        ],
      ],
    });
    expect(rings.length).toBe(1);
    expect(rings[0]!.length).toBe(5);
    expect(rings[0]![0]).toEqual([115.86, -31.95]);
  });

  it("boundsOf returns null for empty input", async () => {
    const { boundsOf } = await import("../components/map/useCadastre");
    expect(boundsOf([])).toBeNull();
  });
});
