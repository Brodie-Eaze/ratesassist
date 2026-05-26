/**
 * POST /api/strata/:assessment/request-conversion — strata-conversion state-machine transition.
 *
 * Drives the strata-parent → children lifecycle for a given parent
 * assessment number. Wraps the `request_strata_conversion` MCP tool via the
 * two-phase commit contract.
 *
 * Body (JSON only — no CSV upload): `{ toState, childCts?, reason?, confirm?, commitToken? }`.
 *
 * Auth: requires `write.commit_mutation` (rates_supervisor or higher per the
 * contract's RBAC matrix). Rate-officers can DRAFT but only supervisors can
 * commit a state transition.
 */

import { NextRequest, NextResponse } from "next/server";

import { getSessionFromRequest, hasPermission } from "@/lib/auth";
import {
  sessionMayAccessTenant,
  tenantFromAssessmentNumber,
} from "@/lib/api-helpers";
import { invalidateEvaluationContext } from "@/lib/clients";
import { scoped } from "@/lib/logger";
import {
  correlationIdFromHeaders,
  runWithCorrelation,
} from "@/lib/correlation";
import { getClientIp } from "@/lib/rate-limit";
import { runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TO_STATES = new Set([
  "strata_plan_uploaded",
  "children_previewed",
  "children_imported",
  "parent_superseded",
  "withdrawn",
]);

type ChildCt = {
  volume: string;
  folio: string;
  ven?: string;
  address?: string;
};

type Input = {
  toState: string;
  childCts?: ChildCt[];
  reason?: string;
  confirm: boolean;
  commitToken?: string;
};

function coerceChildCts(raw: unknown): ChildCt[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ChildCt[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o["volume"] !== "string" || typeof o["folio"] !== "string") {
      continue;
    }
    const cc: ChildCt = {
      volume: o["volume"] as string,
      folio: o["folio"] as string,
    };
    if (typeof o["ven"] === "string") cc.ven = o["ven"] as string;
    if (typeof o["address"] === "string") cc.address = o["address"] as string;
    out.push(cc);
  }
  return out;
}

async function readInput(
  req: NextRequest,
): Promise<{ ok: true; input: Input } | { ok: false; message: string }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, message: "body must be JSON" };
  }
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be an object" };
  }
  const b = body as Record<string, unknown>;
  const toState = typeof b["toState"] === "string" ? (b["toState"] as string) : "";
  if (!TO_STATES.has(toState)) {
    return {
      ok: false,
      message: `toState must be one of ${[...TO_STATES].join(", ")}`,
    };
  }
  const childCts = coerceChildCts(b["childCts"]);
  const reason = typeof b["reason"] === "string" ? (b["reason"] as string) : undefined;
  const confirm = b["confirm"] === true;
  const commitToken =
    typeof b["commitToken"] === "string" ? (b["commitToken"] as string) : undefined;
  return {
    ok: true,
    input: {
      toState,
      ...(childCts !== undefined && childCts.length > 0
        ? { childCts }
        : {}),
      ...(reason !== undefined ? { reason } : {}),
      confirm,
      ...(commitToken !== undefined ? { commitToken } : {}),
    },
  };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ assessment: string }> },
): Promise<NextResponse> {
  const { assessment } = await ctx.params;
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api.strata.request_conversion", {
    correlationId,
    assessment,
  });
  const ip = getClientIp(req);

  return runWithCorrelation(
    {
      correlationId,
      route: `/api/strata/${assessment}/request-conversion`,
      method: "POST",
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    },
    async () => {
      const session = getSessionFromRequest(req);
      if (!session) {
        log.warn({ event: "unauthorized" });
        return NextResponse.json(
          {
            ok: false,
            code: "unauthorized",
            message: "Authentication required.",
          },
          { status: 401 },
        );
      }
      if (!hasPermission(session, "write.commit_mutation")) {
        log.warn({ event: "forbidden", userId: session.userId });
        return NextResponse.json(
          {
            ok: false,
            code: "forbidden",
            message: "write.commit_mutation required.",
          },
          { status: 403 },
        );
      }

      if (!/^[A-Z0-9][A-Z0-9-]*$/i.test(assessment) || assessment.length > 40) {
        return NextResponse.json(
          {
            ok: false,
            code: "invalid_input",
            message: "Invalid assessment number in path.",
          },
          { status: 400 },
        );
      }

      // F-002 mitigation — refuse cross-tenant strata mutations. The
      // pen-test showed a TPS council_admin could POST against a KAL
      // strata parent and trigger a real state transition because the
      // session's tenantId was never compared to the asset. 404 (not
      // 403) on mismatch so the endpoint doesn't leak whether a given
      // assessment is a strata parent on a different tenant.
      const assetTenant = tenantFromAssessmentNumber(assessment);
      if (!sessionMayAccessTenant(session, assetTenant)) {
        log.warn({
          event: "cross_tenant_refused",
          userId: session.userId,
          sessionTenant: session.tenantId,
          assetTenant,
        });
        return NextResponse.json(
          {
            ok: false,
            code: "not_found",
            message: `Strata parent ${assessment} not found.`,
          },
          { status: 404 },
        );
      }

      const parsed = await readInput(req);
      if (!parsed.ok) {
        log.warn({ event: "invalid_input", message: parsed.message });
        return NextResponse.json(
          { ok: false, code: "invalid_input", message: parsed.message },
          { status: 400 },
        );
      }
      const input = parsed.input;

      const result = await runTool(
        "request_strata_conversion",
        {
          parentAssessmentNumber: assessment,
          toState: input.toState,
          ...(input.childCts !== undefined ? { childCts: input.childCts } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          confirm: input.confirm,
          ...(input.commitToken !== undefined
            ? { commitToken: input.commitToken }
            : {}),
        },
        correlationId,
        {
          tenantId: session.tenantId,
          actorId: session.userId,
          actorKind: "user",
        },
      );

      if (!result.ok) {
        const errCode = result.code ?? "upstream_error";
        const status =
          errCode === "not_found"
            ? 404
            : errCode === "conflict" || errCode === "commit_token_invalid"
              ? 409
              : errCode === "invalid_input"
                ? 400
                : errCode === "forbidden"
                  ? 403
                  : 502;
        log.warn({
          event: "strata.failed",
          code: errCode,
          error: result.error,
        });
        return NextResponse.json(
          {
            ok: false,
            code: errCode,
            message: result.error ?? "request_strata_conversion failed",
          },
          { status },
        );
      }

      // children_imported materialises child Property rows; invalidate
      // EvaluationContext so the next sweep sees them.
      if (
        input.confirm &&
        result.mutated === true &&
        input.toState === "children_imported"
      ) {
        try {
          invalidateEvaluationContext();
        } catch (e) {
          log.warn({
            event: "invalidate.failed",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      log.info({
        event: "strata.ok",
        confirmed: input.confirm,
        mutated: result.mutated === true,
        toState: input.toState,
      });

      return NextResponse.json({
        ok: true,
        output: result.output,
        data: result.data ?? null,
        commitToken: result.commitToken,
        mutated: result.mutated === true,
      });
    },
  ) as Promise<NextResponse>;
}
