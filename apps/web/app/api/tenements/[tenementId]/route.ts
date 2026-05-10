/**
 * GET /api/tenements/[tenementId] — single mining-tenement briefing.
 *
 * Path param is the percent-encoded raw tenid (e.g. `M%20%204701569`).
 * Wraps `get_grant_detail` (already implemented) and re-shapes through
 * the Round 4B response envelope. Adds the canonical MINEDEX URL for the
 * tenement so council UIs can deep-link to the upstream register.
 *
 * Differences vs the existing /api/grants/[tenementId]:
 *   - Standard envelope (`ok` / `data` / pagination block).
 *   - ETag + `cache-control: private, max-age=60`.
 *   - Auth gate via `hasSession`.
 *   - MINEDEX URL synthesised here so adapters don't need to think about
 *     it.
 *
 * The original /api/grants/[tenementId] route is left intact for
 * existing callers; this is the canonical REST entity endpoint going
 * forward.
 */

import type { NextRequest } from "next/server";

import { runTool } from "@/lib/tools";
import {
  fail,
  hasSession,
  maybeNotModified,
  ok,
  weakEtag,
} from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MINEDEX is WA DMIRS's public tenement register. The deep-link uses the
 * raw tenement id with single-spaces (the same shape we accept on input).
 */
function minedexUrl(tenementId: string): string {
  return `https://minedex.dmirs.wa.gov.au/web/tenement/${encodeURIComponent(tenementId)}`;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tenementId: string }> },
): Promise<Response> {
  if (!hasSession(req)) {
    return fail("unauthorized", "Authentication required.");
  }

  const { tenementId: encoded } = await ctx.params;
  const tenementId = decodeURIComponent(encoded);

  const sinceDaysRaw = req.nextUrl.searchParams.get("sinceDays");
  const sinceDays = sinceDaysRaw === null ? 90 : Number(sinceDaysRaw);
  if (!Number.isFinite(sinceDays) || sinceDays < 1 || sinceDays > 365) {
    return fail("invalid_input", "sinceDays must be 1..365");
  }

  const result = await runTool("get_grant_detail", { tenementId, sinceDays });
  if (!result.ok) {
    if (result.code === "not_found") {
      return fail("not_found", `Tenement ${tenementId} not found.`);
    }
    if (result.code === "invalid_input") {
      return fail("invalid_input", result.error ?? "Invalid tenement id.");
    }
    return fail("upstream_error", result.error ?? "get_grant_detail failed", 502);
  }

  const data = (result.data ?? {}) as {
    grant?: unknown;
    intersectingParcels?: unknown[];
    cadastreSource?: string;
  };

  const payload = {
    tenement: data.grant ?? null,
    intersectingParcels: data.intersectingParcels ?? [],
    cadastreSource: data.cadastreSource ?? null,
    minedexUrl: minedexUrl(tenementId),
  };

  const etag = weakEtag(payload);
  const notModified = maybeNotModified(req, etag);
  if (notModified !== null) return notModified;

  return ok(payload, {
    headers: { etag, "cache-control": "private, max-age=60" },
  });
}
