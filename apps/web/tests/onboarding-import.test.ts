/**
 * POST /api/councils/:code/import — rating-roll ingestion route.
 *
 * Mirrors add-council's test harness: forces in-proc tool transport so the
 * route and the adapter-demo singleton share one DataStore + commit-token
 * realm. Auth flows via the `x-session` header.
 */

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
process.env["RA_TOOL_TRANSPORT"] = "inproc";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../lib/auth";

vi.resetModules();
const importRoute = await import("../app/api/councils/[code]/import/route");
const importPOST = importRoute.POST as unknown as (
  req: NextRequest,
  ctx: { params: Promise<{ code: string }> },
) => Promise<Response>;

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

beforeEach(async () => {
  const inproc = await import("@ratesassist/adapter-demo/inproc");
  inproc._resetInproc();
  const audit = await import("@ratesassist/adapter-demo/audit");
  audit._resetForTests();
});

function session(roles: Role[], tenantId = "TPS"): Session {
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

function req(body: unknown, s: Session | null, code: string = "TPS"): NextRequest {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (s) headers.set(SESSION_HEADER, JSON.stringify(s));
  return new NextRequest(new URL(`http://localhost/api/councils/${code}/import`), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function withParams(code: string) {
  return { params: Promise.resolve({ code }) };
}

const HEADER =
  "assessment_number,address,suburb,postcode,state,landuse,valuation,annual_rates,owner_name";
const SAMPLE_CSV = [
  HEADER,
  "TPS-WEB-01,1 Web Road,Tom Price,6751,WA,Residential,400000,2000,Web Tester A",
  "TPS-WEB-02,2 Web Road,Tom Price,6751,WA,Commercial,800000,6400,Web Tester B",
].join("\n");

describe("POST /api/councils/:code/import", () => {
  it("401 when no session", async () => {
    const res = await importPOST(
      req(
        { csvText: SAMPLE_CSV, mergeStrategy: "upsert", confirm: false },
        null,
      ),
      withParams("TPS"),
    );
    expect(res.status).toBe(401);
  });

  it("403 for rates_officer (write.user_management required)", async () => {
    const res = await importPOST(
      req(
        { csvText: SAMPLE_CSV, mergeStrategy: "upsert", confirm: false },
        session(["rates_officer"]),
      ),
      withParams("TPS"),
    );
    expect(res.status).toBe(403);
  });

  it("happy two-phase for council_admin", async () => {
    const s = session(["council_admin"]);
    const previewRes = await importPOST(
      req(
        { csvText: SAMPLE_CSV, mergeStrategy: "upsert", confirm: false },
        s,
      ),
      withParams("TPS"),
    );
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as {
      ok: boolean;
      commitToken?: string;
      data?: { validCount: number; errorCount: number };
    };
    expect(preview.ok).toBe(true);
    expect(typeof preview.commitToken).toBe("string");
    expect(preview.data?.validCount).toBe(2);

    const commitRes = await importPOST(
      req(
        {
          csvText: SAMPLE_CSV,
          mergeStrategy: "upsert",
          confirm: true,
          commitToken: preview.commitToken!,
        },
        s,
      ),
      withParams("TPS"),
    );
    expect(commitRes.status).toBe(200);
    const commit = (await commitRes.json()) as {
      ok: boolean;
      mutated: boolean;
    };
    expect(commit.ok).toBe(true);
    expect(commit.mutated).toBe(true);
  });

  it("returns 404 for unknown council code", async () => {
    const res = await importPOST(
      req(
        { csvText: SAMPLE_CSV, mergeStrategy: "upsert", confirm: false },
        session(["council_admin"]),
      ),
      withParams("ZZZ"),
    );
    expect(res.status).toBe(404);
  });

  it("rejects malformed council code in path", async () => {
    const res = await importPOST(
      req(
        { csvText: SAMPLE_CSV, mergeStrategy: "upsert", confirm: false },
        session(["council_admin"]),
      ),
      withParams("notacode"),
    );
    expect(res.status).toBe(400);
  });

  it("rejects missing csvText", async () => {
    const res = await importPOST(
      req(
        { csvText: "", mergeStrategy: "upsert", confirm: false },
        session(["council_admin"]),
      ),
      withParams("TPS"),
    );
    expect(res.status).toBe(400);
  });
});
