/**
 * GET /api/roll-quality route tests.
 *
 * Covers:
 *   - 401 when no session.
 *   - 200 + report shape for an authenticated officer.
 *   - TENANT ISOLATION: a non-admin officer's report (strata + outlier
 *     assessments) contains ONLY their own tenant's parcels; platform_admin
 *     sees across tenants. This is the multi-tenant boundary the route enforces
 *     by scoping properties before the IAAO dispersion runs.
 *   - invalid landUse → 400.
 *
 * Constructs NextRequest objects directly with a stubbed x-session header so the
 * route handler is exercised in isolation from middleware.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../lib/auth";

vi.resetModules();
const { GET: rollQualityGET } = await import("../app/api/roll-quality/route");

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

function freshSession(roles: Role[], tenantId = "TPS"): Session {
  const now = Date.now();
  return {
    userId: "u1",
    email: "u1@example.com",
    displayName: "User One",
    tenantId,
    roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  };
}

function reqWith(session: Session | null, url = "http://localhost/api/roll-quality"): NextRequest {
  const headers = new Headers();
  if (session) headers.set(SESSION_HEADER, JSON.stringify(session));
  return new NextRequest(new URL(url), { method: "GET", headers });
}

type Stratum = { landUse: string; suburb: string; topOutlierAssessments: string[] };
type Body = {
  ok: boolean;
  data: {
    summary: { propertiesAnalysed: number; totalStrata: number; flaggedStrata: number };
    strata: Stratum[];
    flaggedStrata: Stratum[];
    note: string;
  };
};

function allOutliers(strata: Stratum[]): string[] {
  return strata.flatMap((s) => s.topOutlierAssessments);
}

describe("GET /api/roll-quality", () => {
  it("401 when no session", async () => {
    const res = await rollQualityGET(reqWith(null));
    expect(res.status).toBe(401);
  });

  it("400 on an invalid landUse filter", async () => {
    const res = await rollQualityGET(
      reqWith(freshSession(["rates_officer"]), "http://localhost/api/roll-quality?landUse=Nope"),
    );
    expect(res.status).toBe(400);
  });

  it("200 + report shape for an authenticated officer", async () => {
    const res = await rollQualityGET(reqWith(freshSession(["rates_officer"], "TPS")));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.ok).toBe(true);
    expect(body.data.summary.propertiesAnalysed).toBeGreaterThan(0);
    expect(Array.isArray(body.data.strata)).toBe(true);
    expect(body.data.note).toMatch(/sale prices|dispersion/i);
  });

  it("scopes strata + outliers to the officer's tenant; admin sees across tenants", async () => {
    const officerRes = await rollQualityGET(reqWith(freshSession(["rates_officer"], "TPS")));
    const officer = ((await officerRes.json()) as Body).data;
    const officerOutliers = allOutliers(officer.strata);

    // every parcel the officer can see belongs to TPS — no cross-tenant leak.
    expect(officerOutliers.length).toBeGreaterThan(0);
    for (const a of officerOutliers) {
      expect(a.startsWith("TPS-")).toBe(true);
    }
    for (const s of officer.strata) {
      expect(s.topOutlierAssessments.every((a) => a.startsWith("TPS-"))).toBe(true);
    }

    // platform_admin sees more parcels and at least one non-TPS assessment.
    const adminRes = await rollQualityGET(reqWith(freshSession(["platform_admin"], "TPS")));
    const admin = ((await adminRes.json()) as Body).data;
    expect(admin.summary.propertiesAnalysed).toBeGreaterThan(officer.summary.propertiesAnalysed);
    expect(allOutliers(admin.strata).some((a) => !a.startsWith("TPS-"))).toBe(true);
  });

  it("flaggedOnly=true returns only strata over the IAAO band", async () => {
    const res = await rollQualityGET(
      reqWith(freshSession(["platform_admin"]), "http://localhost/api/roll-quality?flaggedOnly=true"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    // every returned stratum is, by definition, a flagged one.
    expect(body.data.strata.length).toBe(body.data.flaggedStrata.length);
  });
});
