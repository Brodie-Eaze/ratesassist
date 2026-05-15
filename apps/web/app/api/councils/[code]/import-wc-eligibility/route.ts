/**
 * POST /api/councils/:code/import-wc-eligibility — Water Corp eligibility CSV ingestion.
 *
 * Modelled on `/api/councils/[code]/import/route.ts`. Two body shapes:
 *
 *  - `application/json` with `{ csvText, retrievedAt?, confirm?, commitToken? }`
 *  - `multipart/form-data` with `file` + form fields
 *
 * Both flow into the `import_wc_eligibility` MCP tool via two-phase commit.
 *
 * Auth: `write.user_management` (council_admin or platform_admin).
 */

import { NextRequest, NextResponse } from "next/server";

import { getSessionFromRequest, hasPermission } from "@/lib/auth";
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

const MAX_CSV_BYTES = 10 * 1024 * 1024;

type ImportInput = {
  csvText: string;
  retrievedAt?: string;
  confirm: boolean;
  commitToken?: string;
};

async function readImportInput(
  req: NextRequest,
): Promise<{ ok: true; input: ImportInput } | { ok: false; message: string }> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return { ok: false, message: "multipart upload missing 'file' field" };
    }
    if (file.size > MAX_CSV_BYTES) {
      return { ok: false, message: `file exceeds ${MAX_CSV_BYTES} byte cap` };
    }
    const csvText = await file.text();
    const retrievedAtRaw = form.get("retrievedAt");
    const confirmRaw = String(form.get("confirm") ?? "false");
    const commitTokenRaw = form.get("commitToken");
    return {
      ok: true,
      input: {
        csvText,
        ...(typeof retrievedAtRaw === "string" && retrievedAtRaw.length > 0
          ? { retrievedAt: retrievedAtRaw }
          : {}),
        confirm: confirmRaw === "true",
        ...(typeof commitTokenRaw === "string" && commitTokenRaw.length > 0
          ? { commitToken: commitTokenRaw }
          : {}),
      },
    };
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, message: "body must be JSON or multipart/form-data" };
  }
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "body must be an object" };
  }
  const b = body as Partial<ImportInput> & Record<string, unknown>;
  const csvText = typeof b["csvText"] === "string" ? b["csvText"] : "";
  if (csvText.length === 0) {
    return { ok: false, message: "csvText is required" };
  }
  if (csvText.length > MAX_CSV_BYTES) {
    return { ok: false, message: `csvText exceeds ${MAX_CSV_BYTES} byte cap` };
  }
  const retrievedAt =
    typeof b["retrievedAt"] === "string" ? b["retrievedAt"] : undefined;
  const confirm = b["confirm"] === true;
  const commitToken =
    typeof b["commitToken"] === "string" ? b["commitToken"] : undefined;
  return {
    ok: true,
    input: {
      csvText,
      ...(retrievedAt !== undefined ? { retrievedAt } : {}),
      confirm,
      ...(commitToken !== undefined ? { commitToken } : {}),
    },
  };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await ctx.params;
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api.councils.import_wc_eligibility", {
    correlationId,
    code,
  });
  const ip = getClientIp(req);

  return runWithCorrelation(
    {
      correlationId,
      route: `/api/councils/${code}/import-wc-eligibility`,
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
      if (!hasPermission(session, "write.user_management")) {
        log.warn({ event: "forbidden", userId: session.userId });
        return NextResponse.json(
          {
            ok: false,
            code: "forbidden",
            message: "write.user_management required.",
          },
          { status: 403 },
        );
      }

      if (!/^[A-Z]{2,5}$/.test(code)) {
        return NextResponse.json(
          {
            ok: false,
            code: "invalid_input",
            message: "Invalid council code in path.",
          },
          { status: 400 },
        );
      }

      const parsed = await readImportInput(req);
      if (!parsed.ok) {
        log.warn({ event: "invalid_input", message: parsed.message });
        return NextResponse.json(
          { ok: false, code: "invalid_input", message: parsed.message },
          { status: 400 },
        );
      }
      const input = parsed.input;

      const result = await runTool(
        "import_wc_eligibility",
        {
          councilCode: code,
          csvText: input.csvText,
          ...(input.retrievedAt !== undefined
            ? { retrievedAt: input.retrievedAt }
            : {}),
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
          event: "import.failed",
          code: errCode,
          error: result.error,
        });
        return NextResponse.json(
          {
            ok: false,
            code: errCode,
            message: result.error ?? "import_wc_eligibility failed",
          },
          { status },
        );
      }

      // Eligibility changes affect concession-class signals; invalidate
      // EvaluationContext on commit.
      if (input.confirm && result.mutated === true) {
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
        event: "import.ok",
        confirmed: input.confirm,
        mutated: result.mutated === true,
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
