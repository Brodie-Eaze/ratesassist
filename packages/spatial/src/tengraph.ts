/**
 * @ratesassist/spatial/tengraph — DMIRS TenGraph spatial tenement viewer.
 *
 * TenGraph is DMIRS's authoritative spatial-viewer for WA mining tenements.
 * It's the canonical "show me this tenement on a map with all neighbours"
 * surface — separate from MINEDEX (which is the textual register) and SLIP
 * (which is the WFS feed).
 *
 * Connectivity reality (probed 2026-05-11):
 *   - https://tengraph.dmirs.wa.gov.au/ does not resolve cleanly from a
 *     non-browser client (connection establishes but returns no headers
 *     within the standard timeout). The viewer is intended for interactive
 *     browser sessions only.
 *   - There is no documented public deep-link URL pattern that surveys a
 *     specific tenement in TenGraph. The historical pattern was the home
 *     page with a manual search field.
 *
 * Consequence: `buildTengraphUrl` returns the TenGraph home with a hash
 * fragment carrying the tenement id, so the operator can paste it into the
 * search box. The hash is purely client-side context — TenGraph itself does
 * not interpret it, and we say so honestly in the JSDoc.
 */

/** TenGraph public viewer base URL. */
export const TENGRAPH_BASE = "https://tengraph.dmirs.wa.gov.au";

/**
 * Build a TenGraph viewer URL for a tenement id.
 *
 * Honest behaviour: TenGraph has no documented deep-link query parameter, so
 * the returned URL is the viewer home with the raw id encoded into the hash
 * fragment. The hash is for human convenience — copy/paste into the search
 * field once the viewer loads. We surface this caveat in the UI label rather
 * than pretending the URL deep-links.
 *
 * @param tenementId Raw DMIRS form, e.g. `"M  4701569"`. Trimmed but otherwise
 *                   passed through; empty/blank returns the bare base URL.
 */
export function buildTengraphUrl(tenementId: string): string {
  const trimmed = tenementId.trim();
  if (trimmed.length === 0) return `${TENGRAPH_BASE}/`;
  return `${TENGRAPH_BASE}/#tenement=${encodeURIComponent(trimmed)}`;
}

/**
 * Reports whether the TenGraph service is presumed reachable.
 *
 * The probe at 2026-05-11 did not resolve from a server-side curl, but the
 * viewer is operational for browser users. The UI uses this flag to gate
 * the "Open in TenGraph" link — currently always true; flip if DMIRS retires
 * the service.
 */
export function tengraphAvailable(): boolean {
  return true;
}
