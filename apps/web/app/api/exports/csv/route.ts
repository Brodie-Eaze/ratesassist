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

import type { NextRequest } from "next/server";
import { findMismatches } from "@ratesassist/recovery-engine";
import type { MismatchCandidate } from "@ratesassist/contract";

import { runTool } from "@/lib/tools";
import { fail, hasSession, streamCsv } from "@/lib/api-helpers";
import { getEvaluationContext } from "@/lib/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportType = "candidates" | "grants" | "overdue";

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
  if (!hasSession(req)) {
    return fail("unauthorized", "Authentication required.");
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

  switch (type) {
    case "candidates":
      return await exportCandidates(body);
    case "grants":
      return await exportGrants(body);
    case "overdue":
      return await exportOverdue(body);
  }
}

async function exportCandidates(filter: Record<string, unknown>): Promise<Response> {
  const severity =
    typeof filter.severity === "string" ? filter.severity : null;
  const signalId = typeof filter.signal === "string" ? filter.signal : null;

  const ctx = getEvaluationContext();
  let rows: readonly MismatchCandidate[] = findMismatches(ctx);
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
  return streamCsv(csvRows, `ratesassist-candidates-${todayIso()}.csv`);
}

async function exportGrants(filter: Record<string, unknown>): Promise<Response> {
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

  const result = await runTool("list_recent_grants", input);
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
  return streamCsv(csvRows, `ratesassist-grants-${todayIso()}.csv`);
}

async function exportOverdue(filter: Record<string, unknown>): Promise<Response> {
  const input: Record<string, unknown> = {};
  if (typeof filter.council === "string") input.council = filter.council;
  if (typeof filter.minDaysOverdue === "number") input.minDaysOverdue = filter.minDaysOverdue;

  const result = await runTool("list_overdue", input);
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
  return streamCsv(csvRows, `ratesassist-overdue-${todayIso()}.csv`);
}
