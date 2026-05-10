/**
 * GET /api/owners/[ownerId] — full owner record + portfolio.
 *
 * Owner field comes from `get_owner`. Portfolio (the properties this
 * owner appears against) is derived from the in-process evaluation
 * context's per-owner index — same data the recovery engine uses.
 *
 * `abnCheck` is whatever the upstream record carries today; this route
 * does NOT trigger a live ABN lookup (that would be a `verify_abn` tool
 * call and is left to explicit caller intent).
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
import { getEvaluationContext } from "@/lib/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ ownerId: string }> },
): Promise<Response> {
  if (!hasSession(req)) {
    return fail("unauthorized", "Authentication required.");
  }

  const { ownerId: encoded } = await ctx.params;
  const ownerId = decodeURIComponent(encoded);

  const result = await runTool("get_owner", { ownerId });
  if (!result.ok) {
    if (result.code === "not_found") {
      return fail("not_found", `Owner ${ownerId} not found.`);
    }
    if (result.code === "invalid_input") {
      return fail("invalid_input", result.error ?? "Invalid owner id.");
    }
    return fail("upstream_error", result.error ?? "get_owner failed", 502);
  }

  const data = (result.data ?? {}) as { owner?: unknown };
  const owner = data.owner;

  // Portfolio — properties this owner is on.
  const evalCtx = getEvaluationContext();
  const portfolio = evalCtx.propertiesByOwnerId?.get(ownerId) ?? [];

  const payload = {
    owner,
    portfolio,
    abnCheck: (owner as { abnCheck?: unknown } | undefined)?.abnCheck ?? {
      kind: "unchecked" as const,
    },
  };

  const etag = weakEtag(payload);
  const notModified = maybeNotModified(req, etag);
  if (notModified !== null) return notModified;

  return ok(payload, {
    headers: { etag, "cache-control": "private, max-age=60" },
  });
}
