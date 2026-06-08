/**
 * POST /api/exports/csv?type=candidates|grants|overdue — CSV export.
 *
 * Council finance teams universally request CSVs for ledger-style data
 * (auditors, EOFY pulls, internal triage spreadsheets). This route is
 * the canonical CSV producer. The `type` query selects the dataset and
 * the JSON request body provides the per-type filter shape:
 *
 *   type=candidates  body: { severity?: "high"|"medium"|"low",
 *                            signal?: string }
 *   type=grants      body: { sinceDays?: number, types?: string[],
 *                            lgaName?: string }
 *   type=overdue     body: { council?: string, minDaysOverdue?: number }
 *
 * Empty body is fine (`{}`); all filters are optional.
 *
 * Filename pattern: ratesassist-<type>-YYYY-MM-DD.csv (the dash form is
 * what spreadsheet apps prefer; underscores in some councils' SOEs get
 * stripped on email gateways).
 *
 * Rationale for POST not GET: filter shapes are richer than a query
 * string can carry idiomatically (signal allow-lists, etc.) and CSV
 * exports often hit dataset sizes where caching has no useful effect.
 */

import { NextResponse, type NextRequest } from "next/server";
import { findMismatches } from "@ratesassist/recovery-engine";
import type { MismatchCandidate } from "@ratesassist/contract";

import { runTool } from "@/lib/tools";
import { fail, resolveRouteSession, streamCsv } from "@/lib/api-helpers";
import { getEvaluationContextForTenant } from "@/lib/clients";
import { correlationIdFromHeaders } from "@/lib/correlation";
import { getClientIp, rateLimitComposite, retryAfterSeconds } from "@/lib/rate-limit";

const ROW_CAP = 10_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportType = "candidates" | "grants" | "overdue";

/** Minimal session shape the export helpers need for tenant scoping. */
type RouteSession = {
  readonly userId: string;
  readonly tenantId: string;
  readonly roles: ReadonlyArray<string>;
};

const VALID_TYPES: ReadonlySet<string> = new Set([
  "candidates",
  "grants",
  "overdue",
]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (text.length === 0) return {};
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  // Resolve the real session (header → cookie → dev autologin) so we can
  // tenant-scope the export. `hasSession` only proved presence — these
  // datasets carry ratepayer addresses + arrears, so we MUST scope by the
  // caller's council, not merely confirm they're logged in.
  const session = await resolveRouteSession(req);
  if (session === null) {
    return fail("unauthorized", "Authentication required.");
  }
  const ip = getClientIp(req);
  const rl = rateLimitComposite({ scope: "exports-csv", ip, tenantId: session.tenantId, max: 5 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } }
    );
  }

  const typeRaw = req.nextUrl.searchParams.get("type");
  if (typeRaw === null || !(VALID_TYPES as ReadonlySet<string>).has(typeRaw)) {
    return fail(
      "invalid_input",
      "type must be one of candidates|grants|overdue",
    );
  }
  const type = typeRaw as ExportType;
  const body = await readJsonBody(req);
  const correlationId = correlationIdFromHeaders(req.headers);

  switch (type) {
    case "candidates":
      return await exportCandidates(session, body);
    case "grants":
      return await exportGrants(session, body, correlationId);
    case "overdue":
      return await exportOverdue(session, body, correlationId);
  }
}

async function exportCandidates(
  session: RouteSession,
  filter: Record<string, unknown>,
): Promise<Response> {
  const severity =
    typeof filter.severity === "string" ? filter.severity : null;
  const signalId = typeof filter.signal === "string" ? filter.signal : null;

  // E3: per-tenant SQL-scoped context. With per-tenant ctx the
  // `council: session.tenantId` filter in findMismatches is redundant
  // but kept as an explicit safety net for platform_admin calls that
  // reuse this helper in a non-admin path.
  const ctx = await getEvaluationContextForTenant(session.tenantId);
  const isAdmin = session.roles.includes("platform_admin");
  let rows: readonly MismatchCandidate[] = isAdmin
    ? findMismatches(ctx)
    : findMismatches(ctx, { council: session.tenantId });
  if (severity !== null) rows = rows.filter((c) => c.severity === severity);
  if (signalId !== null) rows = rows.filter((c) => c.signals.some((s) => s.id === signalId));

  const csvRows = rows.map((c) => ({
    assessment_number: c.property.assessmentNumber,
    council: c.property.council,
    address: c.property.address,
    suburb: c.property.suburb,
    postcode: c.property.postcode,
    state: c.property.state,
    severity: c.severity,
    kind: c.kind,
    composite_score: c.compositeScore.toFixed(3),
    est_uplift_aud: c.estUplift,
    est_arrears_3y_aud: c.estArrears3y,
    est_annual_rates_new_aud: c.estAnnualRatesNew,
    tenement_ids: c.tenements.map((t) => t.tenementId).join(";"),
    signals: c.signals.map((s) => s.id).join(";"),
    reason: c.reason,
  }));
  const cappedRows = csvRows.slice(0, ROW_CAP);
  return streamCsv(cappedRows, `ratesassist-candidates-${todayIso()}.csv`);
}

async function exportGrants(
  session: RouteSession,
  filter: Record<string, unknown>,
  correlationId?: string,
): Promise<Response> {
  const sinceDays =
    typeof filter.sinceDays === "number" && filter.sinceDays >= 1 && filter.sinceDays <= 365
      ? filter.sinceDays
      : 30;
  const types = Array.isArray(filter.types)
    ? (filter.types as unknown[]).filter((t): t is string => typeof t === "string")
    : undefined;
  const lgaName = typeof filter.lgaName === "string" ? filter.lgaName : undefined;

  const input: Record<string, unknown> = { sinceDays };
  if (types !== undefined && types.length > 0) input.types = types;
  if (lgaName !== undefined) input.lgaName = lgaName;

  // DMIRS tenement grants are statewide public data — no tenant scoping
  // applies (every council cross-references the whole register). We still
  // attribute the actor so the export is attributable in the audit log.
  const result = await runTool("list_recent_grants", input, correlationId, {
    tenantId: session.tenantId,
    actorId: session.userId,
    actorKind: "user",
  });
  if (!result.ok) {
    return fail("upstream_error", result.error ?? "list_recent_grants failed", 502);
  }
  const data = (result.data ?? {}) as { grants?: unknown[] };
  const grants = Array.isArray(data.grants) ? data.grants : [];
  const csvRows = grants.map((raw) => {
    const g = raw as Record<string, unknown>;
    return {
      tenement_id: g.tenementId ?? "",
      type: g.type ?? "",
      status: g.status ?? "",
      holder: g.holder ?? "",
      holder_abn: g.holderAbn ?? "",
      commodity: Array.isArray(g.commodity) ? (g.commodity as string[]).join(";") : "",
      granted_date: g.grantedDate ?? "",
      area_hectares: g.areaHectares ?? "",
    };
  });
  const cappedGrants = csvRows.slice(0, ROW_CAP);
  return streamCsv(cappedGrants, `ratesassist-grants-${todayIso()}.csv`);
}

async function exportOverdue(
  session: RouteSession,
  filter: Record<string, unknown>,
  correlationId?: string,
): Promise<Response> {
  const input: Record<string, unknown> = {};
  // Tenant scope — overdue ledgers carry ratepayer arrears (PII). A
  // non-admin session is pinned to its own council; any `council` in the
  // request body is ignored so a TPS officer cannot pull KAL's arrears.
  // platform_admin may target a specific council (or all, when omitted).
  const isAdmin = session.roles.includes("platform_admin");
  if (isAdmin) {
    if (typeof filter.council === "string") input.council = filter.council;
  } else {
    input.council = session.tenantId;
  }
  if (typeof filter.minDaysOverdue === "number") input.minDaysOverdue = filter.minDaysOverdue;

  const result = await runTool("list_overdue", input, correlationId, {
    tenantId: session.tenantId,
    actorId: session.userId,
    actorKind: "user",
  });
  if (!result.ok) {
    return fail("upstream_error", result.error ?? "list_overdue failed", 502);
  }
  const data = (result.data ?? {}) as { properties?: unknown[] };
  const props = Array.isArray(data.properties) ? data.properties : [];
  const csvRows = props.map((raw) => {
    const p = raw as Record<string, unknown>;
    return {
      assessment_number: p.assessmentNumber ?? "",
      council: p.council ?? "",
      address: p.address ?? "",
      suburb: p.suburb ?? "",
      postcode: p.postcode ?? "",
      state: p.state ?? "",
      balance_aud: p.balance ?? "",
      annual_rates_aud: p.annualRates ?? "",
      last_payment_date: p.lastPaymentDate ?? "",
      last_payment_amount_aud: p.lastPaymentAmount ?? "",
    };
  });
  const cappedOverdue = csvRows.slice(0, ROW_CAP);
  return streamCsv(cappedOverdue, `ratesassist-overdue-${todayIso()}.csv`);
}
