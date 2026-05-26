/**
 * GET /api/properties/[assessmentNumber] — full property detail.
 *
 * Wraps the `get_property_detail` MCP tool and shapes the result through
 * the Round 4B response envelope. Optional `?include=` controls which
 * subordinate collections are returned alongside the property record:
 *
 *   ?include=transactions          → adds `transactions: Transaction[]`
 *   ?include=signals               → adds `signals: SignalHit[]`
 *   ?include=tenements             → adds `tenements: Tenement[]` (default on)
 *   ?include=transactions,signals  → both
 *
 * The endpoint always returns the property + owners. Tenements are always
 * returned today because the upstream tool always resolves them; the
 * include flag is honoured prospectively for adapters that gate it.
 *
 * Caching: weak ETag from canonical JSON of the response body. Cache is
 * `private` because property data is tenant-scoped.
 */

import type { NextRequest } from "next/server";
import { findMismatches } from "@ratesassist/recovery-engine";

import { runTool } from "@/lib/tools";
import {
  fail,
  maybeNotModified,
  ok,
  resolveRouteSession,
  sessionMayAccessTenant,
  tenantFromAssessmentNumber,
  weakEtag,
} from "@/lib/api-helpers";
import { getEvaluationContext } from "@/lib/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncludeKey = "transactions" | "signals" | "tenements";

const VALID_INCLUDES: ReadonlySet<IncludeKey> = new Set([
  "transactions",
  "signals",
  "tenements",
]);

function parseInclude(raw: string | null): ReadonlySet<IncludeKey> {
  if (raw === null || raw.length === 0) {
    return new Set(["tenements"]);
  }
  const out = new Set<IncludeKey>();
  for (const part of raw.split(",")) {
    const v = part.trim().toLowerCase();
    if ((VALID_INCLUDES as ReadonlySet<string>).has(v)) {
      out.add(v as IncludeKey);
    }
  }
  return out;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ assessmentNumber: string }> },
): Promise<Response> {
  const session = await resolveRouteSession(req);
  if (!session) {
    return fail("unauthorized", "Authentication required.");
  }

  const { assessmentNumber: encoded } = await ctx.params;
  const assessmentNumber = decodeURIComponent(encoded);

  // F-002 mitigation: pen-test surfaced that a signed-in clerk in
  // tenant TPS could read a KAL property by issuing
  // `GET /api/properties/KAL-XXX`. Until the data model carries an
  // explicit `tenantId` per record, we derive the owning tenant from
  // the assessment-number prefix (which the seed data and demo
  // workflows already guarantee). 404 — not 403 — on mismatch so the
  // endpoint does not leak which assessment numbers exist on other
  // tenants.
  const assetTenant = tenantFromAssessmentNumber(assessmentNumber);
  if (!sessionMayAccessTenant(session, assetTenant)) {
    return fail("not_found", `Property ${assessmentNumber} not found.`);
  }

  const include = parseInclude(req.nextUrl.searchParams.get("include"));

  const result = await runTool("get_property_detail", { assessmentNumber });
  if (!result.ok) {
    if (result.code === "not_found") {
      return fail("not_found", `Property ${assessmentNumber} not found.`);
    }
    if (result.code === "invalid_input") {
      return fail("invalid_input", result.error ?? "Invalid assessment number.");
    }
    return fail("upstream_error", result.error ?? "get_property_detail failed", 502);
  }

  const data = (result.data ?? {}) as {
    property: unknown;
    owners?: unknown[];
    tenements?: unknown[];
  };

  const payload: Record<string, unknown> = {
    property: data.property,
    owners: data.owners ?? [],
  };
  if (include.has("tenements")) payload.tenements = data.tenements ?? [];

  if (include.has("transactions")) {
    const tx = await runTool("get_transaction_history", { assessmentNumber });
    if (tx.ok && tx.data !== undefined) {
      const txData = tx.data as { transactions?: unknown[] };
      payload.transactions = txData.transactions ?? [];
    } else {
      payload.transactions = [];
    }
  }

  if (include.has("signals")) {
    // Signals come from the recovery engine sweep, which is in-process and
    // cheap (memoised context). For each property we return the matching
    // candidate's signal hits, or an empty array if not currently flagged.
    const evalCtx = getEvaluationContext();
    const candidates = findMismatches(evalCtx);
    const match = candidates.find(
      (c) => c.property.assessmentNumber === assessmentNumber,
    );
    payload.signals = match?.signals ?? [];
  }

  const etag = weakEtag(payload);
  const notModified = maybeNotModified(req, etag);
  if (notModified !== null) return notModified;

  return ok(payload, {
    headers: { etag, "cache-control": "private, max-age=60" },
  });
}
