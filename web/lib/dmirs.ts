// DMIRS / SLIP probe + seeded fallback. Performs a SLIP capabilities check to
// surface availability, then returns the seeded tenement set. Full WFS
// GetFeature parsing of bbox-intersecting tenements is implemented separately
// in lib/spatial.ts.

import { getAllLiveTenements } from "./data";
import type { Tenement } from "./types";

// DMIRS / Landgate publishes WA Mining Tenement layers via SLIP services.
// The live WFS endpoint shape (subject to change):
//   https://services.slip.wa.gov.au/...?service=WFS&version=2.0.0&request=GetFeature
const DMIRS_WFS_BASE =
  process.env.DMIRS_WFS_BASE ??
  "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Industry_and_Mining/MapServer/WFSServer";

export type DmirsFetchResult =
  | {
      ok: true;
      count: number;
      sample: Tenement[];
      source: "seeded" | "cache" | "live";
      note?: string;
    }
  | {
      ok: false;
      error: string;
    };

let cache: { ts: number; data: Tenement[] } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function fetchDmirsTenementsForCouncil(
  councilCode: string,
): Promise<DmirsFetchResult> {
  if (!councilCode) {
    return { ok: false, error: "council code required" };
  }

  // Cache hit
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return {
      ok: true,
      count: cache.data.length,
      sample: cache.data.slice(0, 5),
      source: "cache",
    };
  }

  // Attempt SLIP capabilities probe with short timeout
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const url =
      DMIRS_WFS_BASE +
      "?service=WFS&version=2.0.0&request=GetCapabilities";
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    // We confirm live availability of the SLIP WFS, then return seeded data
    // for the demo. We do NOT actually parse features here — until that lands,
    // the data is "seeded" regardless of capabilities-probe success.
    // (Full WFS GetFeature parsing is implemented in lib/spatial.ts.)
    await res.text();
    const seeded = getAllLiveTenements();
    cache = { ts: Date.now(), data: seeded };
    return {
      ok: true,
      count: seeded.length,
      sample: seeded.slice(0, 5),
      source: "seeded",
    };
  } catch (e: unknown) {
    // Offline-safe fallback to seeded data so the demo always works
    const seeded = getAllLiveTenements();
    cache = { ts: Date.now(), data: seeded };
    return {
      ok: true,
      count: seeded.length,
      sample: seeded.slice(0, 5),
      source: "seeded",
      note: "SLIP capabilities probe failed; using seeded tenement set.",
    };
  }
}
