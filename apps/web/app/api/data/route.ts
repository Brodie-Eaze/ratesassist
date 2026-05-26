/**
 * /api/data — recovery snapshot for the web app.
 *
 * PAYLOAD CHANGE (PERF-007): historically this endpoint shipped the full
 * PROPERTIES, OWNERS and TENEMENTS arrays alongside the recovery
 * mismatches + stats. The recovery page only needs `mismatches` + `stats`
 * + `councils`, so the heavy arrays are now opt-in via
 * `?include=properties,owners,tenements`. Other consumers (e.g. property
 * detail pages) should fetch via dedicated endpoints; if any consumer
 * legitimately needs the bulk data, request the include list explicitly.
 *
 * PERF-001: a single `findMismatches(ctx)` sweep now feeds both the
 * response payload and the stats aggregate (`recoveryStatsFor`). Previously
 * the route ran the sweep, then `recoveryStatsForWeb()` ran it a second
 * time internally.
 */

import { NextResponse } from "next/server";
import { findMismatches } from "@ratesassist/recovery-engine";
import { COUNCILS, OWNERS, PROPERTIES, TENEMENTS } from "@/lib/data";
import { getEvaluationContext, recoveryStatsFor } from "@/lib/clients";
import {
  resolveRouteSession,
  sessionMayAccessTenant,
  tenantFromAssessmentNumber,
} from "@/lib/api-helpers";

export const runtime = "nodejs";

type IncludeKey = "properties" | "owners" | "tenements";

function parseInclude(param: string | null): ReadonlySet<IncludeKey> {
  if (param === null || param.length === 0) return new Set();
  const allowed: ReadonlySet<IncludeKey> = new Set([
    "properties",
    "owners",
    "tenements",
  ]);
  const result = new Set<IncludeKey>();
  for (const raw of param.split(",")) {
    const v = raw.trim().toLowerCase();
    if ((allowed as ReadonlySet<string>).has(v)) {
      result.add(v as IncludeKey);
    }
  }
  return result;
}

export async function GET(req: Request) {
  // F-008 mitigation: pen-test flagged that `/api/data` returned the
  // full multi-tenant PROPERTIES/OWNERS/TENEMENTS arrays to any
  // authenticated session — one request was sufficient to exfiltrate
  // every council's rate book. Require a session, then scope every
  // returned array to records that belong to the session's tenant.
  // Platform admins still receive everything (the dashboard exists).
  const session = await resolveRouteSession(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, code: "unauthorized", message: "Authentication required." },
      { status: 401 },
    );
  }
  const isPlatformAdmin = session.roles.includes("platform_admin");

  const ctx = getEvaluationContext();
  const mismatches = findMismatches(ctx);

  // Scope mismatches by the tenant prefix on the candidate's
  // assessment number. This is the same shape used by every other
  // [assessmentNumber] route post-F-002.
  const scopedMismatches = isPlatformAdmin
    ? mismatches
    : mismatches.filter((m) =>
        sessionMayAccessTenant(
          session,
          tenantFromAssessmentNumber(m.property.assessmentNumber),
        ),
      );
  const stats = recoveryStatsFor(scopedMismatches);

  const include = parseInclude(new URL(req.url).searchParams.get("include"));

  // Scope each bulk array to the session's tenant.
  const scopedProperties = isPlatformAdmin
    ? PROPERTIES
    : PROPERTIES.filter((p) =>
        sessionMayAccessTenant(
          session,
          tenantFromAssessmentNumber(p.assessmentNumber),
        ),
      );
  // Owners are state-scoped (O-WA-NNN); include only those that
  // touch at least one in-scope property. PROPERTIES already has a
  // `ownerIds` field per record.
  const inScopeOwnerIds = new Set<string>();
  for (const p of scopedProperties) {
    for (const oid of (p as { ownerIds?: ReadonlyArray<string> }).ownerIds ?? []) {
      inScopeOwnerIds.add(oid);
    }
  }
  // For each owner, also compute the set of tenants they touch. If
  // they touch more than ONE, their contact PII (phone/email/postal)
  // is mixed-tenant — redact it from a non-platform-admin response
  // (F-008 council code-review follow-up). Identity fields (ownerId,
  // name, ABN) remain visible so clerks can confirm record identity.
  const ownerTenantMap = new Map<string, Set<string>>();
  for (const p of PROPERTIES) {
    const t = tenantFromAssessmentNumber(
      (p as { assessmentNumber: string }).assessmentNumber,
    );
    if (t === null) continue;
    for (const oid of (p as { ownerIds?: ReadonlyArray<string> }).ownerIds ?? []) {
      const set = ownerTenantMap.get(oid) ?? new Set<string>();
      set.add(t);
      ownerTenantMap.set(oid, set);
    }
  }
  const scopedOwners = isPlatformAdmin
    ? OWNERS
    : OWNERS.filter((o) => inScopeOwnerIds.has(o.ownerId)).map((o) => {
        const touches = ownerTenantMap.get(o.ownerId) ?? new Set();
        if (touches.size <= 1) return o;
        // Mixed-tenant owner → strip contact methods, keep identity.
        return {
          ...o,
          email: undefined,
          phone: undefined,
          mobilePhone: undefined,
          postalAddress: undefined,
          contactRedacted: true,
          contactRedactedReason: "shared_owner_cross_tenant",
        };
      });
  // Tenements aren't tenant-bound (they're a state-level dataset);
  // they remain unscoped — they're not PII.
  const scopedTenements = TENEMENTS;

  // Scope COUNCILS to the session's tenant (single entry for a
  // non-platform-admin) so the UI doesn't render selectors for
  // councils the user can't access.
  const scopedCouncils = isPlatformAdmin
    ? COUNCILS
    : COUNCILS.filter((c) =>
        (c as { code?: string }).code === session.tenantId,
      );

  return NextResponse.json({
    councils: scopedCouncils,
    mismatches: scopedMismatches,
    stats,
    ...(include.has("properties") ? { properties: scopedProperties } : {}),
    ...(include.has("owners") ? { owners: scopedOwners } : {}),
    ...(include.has("tenements") ? { tenements: scopedTenements } : {}),
  });
}
