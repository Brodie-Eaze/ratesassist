/**
 * Runtime probe for the SLIP (WA Landgate) public aerial imagery layer.
 *
 * Background: SLIP exposes a public ArcGIS REST tree at
 *   https://services.slip.wa.gov.au/public/rest/services
 *
 * As of 2026-05 the catalogue exposes these folders:
 *   - Geocoder
 *   - Land_Monitor
 *   - Landgate_Public_Imagery  (event-driven only: Wooroloo_Bushfire_05_02_2021)
 *   - Landgate_Public_Maps     (Bush_Fire_Prone_Areas / Marine / Bathymetry)
 *   - SLIP_Public_Services     (the cadastre + DMIRS tenement layers we use)
 *   - Utilities
 *
 * There is no public state-wide aerial-imagery MapServer on the public tier.
 * The high-resolution aerial mosaics live behind authenticated SLIP accounts.
 *
 * So this probe attempts a small list of historically-suggested URLs, returns
 * the first one whose `?f=json` capabilities document advertises a tile
 * scheme, and caches the result. If none respond, the toggle is hidden.
 */

const CANDIDATES = [
  // The historically-suggested URL pattern from the spec.
  "https://services.slip.wa.gov.au/public/rest/services/Basemaps_/Aerial_/MapServer",
  "https://services.slip.wa.gov.au/public/rest/services/Basemaps/Aerial/MapServer",
  "https://services.slip.wa.gov.au/public/rest/services/Basemaps/Virtual_Mosaic/MapServer",
  // The one publicly-exposed imagery service — narrow scope (Wooroloo) but real.
  "https://services.slip.wa.gov.au/public/rest/services/Landgate_Public_Imagery/Wooroloo_Bushfire_05_02_2021/MapServer",
] as const;

export type SlipAerialProbeResult =
  | { ok: true; tileUrl: string; serviceUrl: string; label: string }
  | { ok: false; reason: string };

let cached: SlipAerialProbeResult | null = null;
let inFlight: Promise<SlipAerialProbeResult> | null = null;

async function probeOne(serviceUrl: string): Promise<SlipAerialProbeResult> {
  try {
    const r = await fetch(`${serviceUrl}?f=json`, {
      method: "GET",
      cache: "force-cache",
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const j = (await r.json()) as {
      singleFusedMapCache?: boolean;
      capabilities?: string;
      tileInfo?: unknown;
      mapName?: string;
    };
    if (!j.tileInfo) return { ok: false, reason: "no tile cache" };
    const label = j.mapName ?? "SLIP Aerial";
    return {
      ok: true,
      serviceUrl,
      tileUrl: `${serviceUrl}/tile/{z}/{y}/{x}`,
      label,
    };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function probeSlipAerial(): Promise<SlipAerialProbeResult> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    // Run all candidates in parallel and bound the total wall-clock to 6s,
    // so the basemap toggle never delays UI by the per-probe timeout × N.
    const deadline = new Promise<SlipAerialProbeResult>((_, reject) =>
      setTimeout(() => reject(new Error("probe deadline")), 6_000),
    );
    try {
      const results = await Promise.race([
        Promise.allSettled(CANDIDATES.map((u) => probeOne(u))),
        deadline,
      ]);
      if (Array.isArray(results)) {
        for (const settled of results) {
          if (settled.status === "fulfilled" && settled.value.ok) {
            cached = settled.value;
            return cached;
          }
        }
      }
    } catch {
      // fall through to negative cache
    }
    cached = { ok: false, reason: "no public-tier SLIP aerial endpoint" };
    return cached;
  })();
  const result = await inFlight;
  inFlight = null;
  return result;
}
