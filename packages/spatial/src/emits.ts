/**
 * @ratesassist/spatial/emits — DMIRS Environmental Management & Tracking System.
 *
 * EMITS is the DMIRS register of environmental approvals tied to WA mining
 * tenements: Mining Proposals (MP), Programmes of Work (POW), Mine Management
 * Plans (MMP) and related instruments. An active EMITS approval is strong
 * evidence that a tenement is being worked on the ground — it complements
 * the DMIRS grant register (which only tells us a tenement exists) and the
 * Landgate cadastre (which lags both).
 *
 * Connectivity reality (probed 2026-05-11):
 *   - https://emits.dmp.wa.gov.au/ returns 403 from non-browser clients
 *     (Incapsula bot block). The portal is intended for interactive browser
 *     sessions with cookies established via the WA Government landing page.
 *   - No public machine-readable export (JSON / WFS) is published today.
 *
 * Consequence: the library exposes a `buildEmitsSearchUrl` helper that takes
 * the user to the EMITS public-search page seeded with the raw tenement id,
 * and a `fetchEmitsApprovalsForTenement` that returns honest `source: "seeded"`
 * with caller-supplied fixtures. We never claim live data we do not have.
 *
 * If/when DMIRS publishes a JSON endpoint, swap `_attemptLiveFetch` with a
 * real implementation — the outer contract (`EmitsApproval`) is stable.
 */

import type { DmirsErrorCode } from "./types.js";

// ===== Public constants =====

/** EMITS portal base. Public search entry point. */
export const EMITS_BASE = "https://emits.dmp.wa.gov.au";

/**
 * Public-reports search page. The page accepts a free-text tenement search;
 * we cannot deep-link to a pre-filtered result (the search is POST-driven),
 * so we send users to the search form and instruct them to paste the id.
 */
export const EMITS_PUBLIC_SEARCH = `${EMITS_BASE}/Pages/PublicReports.aspx`;

// ===== Types =====

/**
 * Single environmental approval associated with a tenement.
 *
 * `tenementId` is the raw DMIRS form (letter + spaces + 7 digits, e.g.
 * `"M  4701569"`) so it round-trips with the MINEDEX deep-link helpers in
 * `./grants.ts`. The UI is expected to derive display form separately.
 */
export type EmitsApproval = {
  readonly tenementId: string;
  readonly approvalType: "MP" | "POW" | "MMP" | "MIN" | "other";
  readonly approvalNumber: string;
  readonly status: "active" | "pending" | "expired" | "withdrawn";
  readonly startDate?: string;
  readonly endDate?: string;
  readonly scopeSummary: string;
  readonly emitsUrl?: string;
};

/**
 * Discriminated fetch result. Mirrors `DmirsFetchResult` shape but parameterised
 * to the approval payload so callers get strong typing across the boundary.
 */
export type EmitsFetchResult =
  | {
      readonly ok: true;
      readonly source: "live" | "seeded";
      readonly approvals: readonly EmitsApproval[];
      readonly queriedAt: string;
      readonly note?: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly code: DmirsErrorCode;
      readonly correlationId?: string;
    };

// ===== Helpers =====

/**
 * Build a search URL that loads the EMITS public-reports page with the raw
 * tenement id pre-staged in the hash. EMITS does not officially honour this
 * query parameter (the form is POST-driven) but the hash survives the round
 * trip so the operator can paste it into the search field — a tiny ergonomic
 * win that's honest about its limits.
 */
export function buildEmitsSearchUrl(tenementId: string): string {
  const trimmed = tenementId.trim();
  if (trimmed.length === 0) return EMITS_PUBLIC_SEARCH;
  // We use the hash fragment so this is purely client-side context — no
  // server pretends to interpret a parameter it does not support.
  return `${EMITS_PUBLIC_SEARCH}#tenement=${encodeURIComponent(trimmed)}`;
}

/**
 * Indicates whether the EMITS portal is reachable in principle. As of the
 * 2026-05-11 probe the portal returns 403 to non-browser user agents — but
 * users with normal browsers can still load it. The UI may use this flag to
 * decorate the link with a "browser session required" hint.
 */
export function emitsAvailable(): boolean {
  // No runtime probe — the portal blocks server-side fetches by design and
  // we don't want to false-negative on the UI. Returning `true` reflects
  // "the portal exists for human users", which is the property the UI needs.
  return true;
}

// ===== Fetcher =====

/**
 * Attempt a live JSON fetch — currently always returns null because DMIRS
 * does not publish a machine-readable endpoint. Stub kept so the integration
 * shape is obvious when an endpoint does appear.
 */
async function _attemptLiveFetch(
  _tenementId: string,
  _fetcher: typeof fetch,
  _signal: AbortSignal | undefined,
): Promise<readonly EmitsApproval[] | null> {
  return null;
}

export type FetchEmitsOptions = {
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly correlationId?: string;
  /**
   * Seeded fixture pool to filter on tenementId when the live endpoint is
   * unavailable. Callers (adapter-demo) inject this; the library is fixture-free.
   */
  readonly seeded?: readonly EmitsApproval[];
};

/**
 * Fetch EMITS approvals for a specific tenement id.
 *
 * Behaviour:
 *  1. Trim/validate the id.
 *  2. Try a live JSON fetch — currently a no-op (returns null).
 *  3. Fall back to filtering the caller-supplied seeded set by exact-match
 *     `tenementId`. Returns `source: "seeded"` honestly.
 *  4. With no seeded set provided, return `ok: false / no_layer_responded`
 *     so the caller can surface the gap rather than display empty state.
 */
export async function fetchEmitsApprovalsForTenement(
  tenementId: string,
  opts: FetchEmitsOptions = {},
): Promise<EmitsFetchResult> {
  const { fetcher = fetch, signal, correlationId, seeded } = opts;

  const trimmed = tenementId.trim();
  if (trimmed.length === 0) {
    return correlationId === undefined
      ? { ok: false, code: "invalid_input", error: "tenement id required" }
      : { ok: false, code: "invalid_input", error: "tenement id required", correlationId };
  }

  // Live path (currently always null — no public endpoint).
  try {
    const live = await _attemptLiveFetch(trimmed, fetcher, signal);
    if (live !== null) {
      return {
        ok: true,
        source: "live",
        approvals: live,
        queriedAt: new Date().toISOString(),
      };
    }
  } catch (e: unknown) {
    // Live path errored — fall through to seeded if we have it.
    const message = e instanceof Error ? e.message : "EMITS live fetch failed";
    if (seeded === undefined) {
      const base = { ok: false as const, code: "upstream_error" as DmirsErrorCode, error: message };
      return correlationId === undefined ? base : { ...base, correlationId };
    }
  }

  if (seeded === undefined) {
    const base = {
      ok: false as const,
      code: "no_layer_responded" as DmirsErrorCode,
      error: "EMITS has no public machine-readable endpoint; no seeded fixtures supplied",
    };
    return correlationId === undefined ? base : { ...base, correlationId };
  }

  const filtered = seeded.filter((a) => a.tenementId.trim() === trimmed);
  return {
    ok: true,
    source: "seeded",
    approvals: filtered,
    queriedAt: new Date().toISOString(),
    note:
      "EMITS publishes no machine-readable export today; returning caller-supplied seeded fixtures filtered by tenement id.",
  };
}
