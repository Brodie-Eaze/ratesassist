/**
 * /api/tenants — tenant registry.
 *
 * GET: list configured tenants, the adapter catalogue, and cross-council
 *   benchmarks (rendered by the /tenants and /intel pages).
 *
 * POST: register a new council. Two-phase commit — the body must match the
 *   `add_council` contract input. The first call (`confirm: false`) returns
 *   a preview + commitToken; the second call (`confirm: true` + token)
 *   persists the council to the in-memory DataStore and writes an audit
 *   row. Requires the `write.user_management` permission (council_admin or
 *   platform_admin only). All errors flow through pino via lib/logger.
 */

import { NextRequest, NextResponse } from "next/server";
import { schemas } from "@ratesassist/contract";

import {
  ADAPTER_CATALOGUE,
  crossCouncilBenchmarks,
  listTenants,
} from "@/lib/tenants";
import { getSessionFromRequest, hasPermission } from "@/lib/auth";
import { runTool } from "@/lib/tools";
import { scoped } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    tenants: listTenants(),
    catalogue: ADAPTER_CATALOGUE,
    benchmarks: crossCouncilBenchmarks(),
  });
}

const log = scoped("api.tenants");

export async function POST(req: NextRequest): Promise<NextResponse> {
  // RBAC — write.user_management is the gate for tenant onboarding.
  const session = getSessionFromRequest(req);
  if (!session) {
    log.warn({ event: "unauthorized" });
    return NextResponse.json(
      { ok: false, code: "unauthorized", message: "Authentication required." },
      { status: 401 },
    );
  }
  if (!hasPermission(session, "write.user_management")) {
    log.warn({
      event: "forbidden",
      userId: session.userId,
      tenantId: session.tenantId,
    });
    return NextResponse.json(
      {
        ok: false,
        code: "forbidden",
        message: "write.user_management required.",
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_input", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = schemas.inputs.add_council.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_input",
        message: parsed.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const result = await runTool("add_council", input, undefined, {
    tenantId: session.tenantId,
    actorId: session.userId,
    actorKind: "user",
  });

  if (!result.ok) {
    const code = result.code ?? "upstream_error";
    const status =
      code === "conflict"
        ? 409
        : code === "invalid_input"
          ? 400
          : code === "not_found"
            ? 404
            : code === "forbidden"
              ? 403
              : 502;
    log.warn({ event: "add_council.failed", code, error: result.error });
    return NextResponse.json(
      {
        ok: false,
        code,
        message: result.error ?? "add_council failed",
      },
      { status },
    );
  }

  log.info({
    event: "add_council.ok",
    confirmed: input.confirm,
    code: input.code,
    actor: session.userId,
  });

  return NextResponse.json({
    ok: true,
    output: result.output,
    data: result.data ?? null,
    commitToken: result.commitToken,
    mutated: result.mutated === true,
  });
}
