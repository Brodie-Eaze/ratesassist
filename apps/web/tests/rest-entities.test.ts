/**
 * Round 4B REST entity routes — happy + error paths.
 *
 * Each route handler is invoked directly with a `NextRequest`; we don't
 * spin up a Next dev server. Auth is satisfied via the dev autologin
 * fallback (`RA_DEV_AUTOLOGIN_SESSION`) — Round 4A's `x-session` header
 * still wins when present, but we exercise the unauth path explicitly
 * by clearing the env var.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

// Stable autologin marker for the duration of these tests; set BEFORE the
// route handlers (and therefore api-helpers) load. NODE_ENV remains "test"
// (vitest sets it) which is enough for the dev-fallback branch in
// `readSession` to engage.
// SEC-F003 ship-ready iter1: `parseDevAutologin` now refuses arbitrary
// string identifiers — autologin must be "default", "1", "true", a
// JSON blob, or one of the allowlisted role names. Use "default" so
// the existing tests resolve a TPS-tenant rates_officer session.
process.env["RA_DEV_AUTOLOGIN_SESSION"] = "default";

import { closeMcpClient } from "../lib/mcp-client";
import { PROPERTIES, OWNERS } from "../lib/data";

import { GET as getProperty } from "../app/api/properties/[assessmentNumber]/route";
import { GET as getOwner } from "../app/api/owners/[ownerId]/route";
import { GET as getTenement } from "../app/api/tenements/[tenementId]/route";
import { GET as listCandidates } from "../app/api/recovery/candidates/route";
import { GET as getCandidate } from "../app/api/recovery/candidates/[assessmentNumber]/route";
import { POST as postCsv } from "../app/api/exports/csv/route";

function makeReq(url: string, init: RequestInit = {}): NextRequest {
  // NextRequest's RequestInit type expects `signal?: AbortSignal | undefined`
  // (no null), so cast through `unknown` to bypass the structural mismatch.
  return new NextRequest(
    new URL(url, "http://localhost:3000"),
    init as unknown as ConstructorParameters<typeof NextRequest>[1],
  );
}

describe("REST entity routes — auth", () => {
  it("returns 401 with no session header and no dev fallback", async () => {
    const prev = process.env["RA_DEV_AUTOLOGIN_SESSION"];
    delete process.env["RA_DEV_AUTOLOGIN_SESSION"];
    try {
      const sample = PROPERTIES[0]!;
      const res = await getProperty(
        makeReq(`/api/properties/${sample.assessmentNumber}`),
        { params: Promise.resolve({ assessmentNumber: sample.assessmentNumber }) },
      );
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe("unauthorized");
    } finally {
      if (prev !== undefined) process.env["RA_DEV_AUTOLOGIN_SESSION"] = prev;
    }
  });
});

describe("GET /api/properties/[assessmentNumber]", () => {
  afterAll(async () => {
    await closeMcpClient();
  });

  it("returns property+owners for a known assessment number", async () => {
    const sample = PROPERTIES[0]!;
    const res = await getProperty(
      makeReq(`/api/properties/${sample.assessmentNumber}`),
      { params: Promise.resolve({ assessmentNumber: sample.assessmentNumber }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.property.assessmentNumber).toBe(sample.assessmentNumber);
    expect(Array.isArray(body.data.owners)).toBe(true);
    expect(Array.isArray(body.data.tenements)).toBe(true);
    expect(res.headers.get("etag")).toMatch(/^W\/"[a-f0-9]+"$/);
  });

  it("honours include=transactions,signals", async () => {
    const sample = PROPERTIES[0]!;
    const res = await getProperty(
      makeReq(
        `/api/properties/${sample.assessmentNumber}?include=transactions,signals`,
      ),
      { params: Promise.resolve({ assessmentNumber: sample.assessmentNumber }) },
    );
    const body = await res.json();
    expect(Array.isArray(body.data.transactions)).toBe(true);
    expect(Array.isArray(body.data.signals)).toBe(true);
  });

  it("returns 304 when If-None-Match matches the ETag", async () => {
    const sample = PROPERTIES[0]!;
    const first = await getProperty(
      makeReq(`/api/properties/${sample.assessmentNumber}`),
      { params: Promise.resolve({ assessmentNumber: sample.assessmentNumber }) },
    );
    const etag = first.headers.get("etag");
    expect(etag).not.toBeNull();
    const second = await getProperty(
      makeReq(`/api/properties/${sample.assessmentNumber}`, {
        headers: { "if-none-match": etag! },
      }),
      { params: Promise.resolve({ assessmentNumber: sample.assessmentNumber }) },
    );
    expect(second.status).toBe(304);
  });

  it("returns 404 for an unknown assessment number", async () => {
    const res = await getProperty(
      makeReq(`/api/properties/ZZZZ-NOT-REAL`),
      { params: Promise.resolve({ assessmentNumber: "ZZZZ-NOT-REAL" }) },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("not_found");
  });
});

describe("GET /api/owners/[ownerId]", () => {
  it("returns owner + portfolio for a known owner", async () => {
    const owner = OWNERS[0]!;
    const res = await getOwner(makeReq(`/api/owners/${owner.ownerId}`), {
      params: Promise.resolve({ ownerId: owner.ownerId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect((body.data.owner as { ownerId: string }).ownerId).toBe(owner.ownerId);
    expect(Array.isArray(body.data.portfolio)).toBe(true);
  });

  it("returns 404 for an unknown owner", async () => {
    const res = await getOwner(makeReq(`/api/owners/owner-does-not-exist`), {
      params: Promise.resolve({ ownerId: "owner-does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/tenements/[tenementId]", () => {
  it("rejects sinceDays out of range", async () => {
    const res = await getTenement(
      makeReq(`/api/tenements/M%20%204701569?sinceDays=9999`),
      { params: Promise.resolve({ tenementId: "M%20%204701569" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_input");
  });

  it("returns either ok+payload or 404 for the seeded tenement", async () => {
    const res = await getTenement(
      makeReq(`/api/tenements/M%20%204701569?sinceDays=365`),
      { params: Promise.resolve({ tenementId: "M%20%204701569" }) },
    );
    expect([200, 404]).toContain(res.status);
    const body = await res.json();
    if (res.status === 200) {
      expect(body.ok).toBe(true);
      expect(typeof body.data.minedexUrl).toBe("string");
      expect(body.data.minedexUrl).toContain("minedex");
    } else {
      expect(body.code).toBe("not_found");
    }
  });
});

describe("GET /api/recovery/candidates", () => {
  it("returns paginated candidates with stats", async () => {
    const res = await listCandidates(makeReq(`/api/recovery/candidates`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.candidates)).toBe(true);
    expect(typeof body.data.stats.total).toBe("number");
    expect(body.pagination).toBeDefined();
    expect(body.pagination.limit).toBeLessThanOrEqual(200);
  });

  it("rejects an invalid severity", async () => {
    const res = await listCandidates(
      makeReq(`/api/recovery/candidates?severity=BOGUS`),
    );
    expect(res.status).toBe(400);
  });

  it("clamps limit to MAX_LIMIT", async () => {
    const res = await listCandidates(
      makeReq(`/api/recovery/candidates?limit=99999`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.limit).toBe(200);
  });
});

describe("GET /api/recovery/candidates/[assessmentNumber]", () => {
  it("404s for a non-candidate assessment number", async () => {
    const res = await getCandidate(
      makeReq(`/api/recovery/candidates/NOT-A-REAL-ID`),
      { params: Promise.resolve({ assessmentNumber: "NOT-A-REAL-ID" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/exports/csv", () => {
  it("rejects an unknown type", async () => {
    const res = await postCsv(
      makeReq(`/api/exports/csv?type=zzz`, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("emits text/csv for type=candidates", async () => {
    const res = await postCsv(
      makeReq(`/api/exports/csv?type=candidates`, {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/csv");
    const body = await res.text();
    // Either an empty body (no candidates) or a header row + data.
    if (body.length > 0) {
      expect(body.split("\r\n")[0]).toContain("assessment_number");
    }
  });
});

afterEach(() => {
  // Restore env between blocks.
  // SEC-F003 ship-ready iter1: `parseDevAutologin` now refuses arbitrary
// string identifiers — autologin must be "default", "1", "true", a
// JSON blob, or one of the allowlisted role names. Use "default" so
// the existing tests resolve a TPS-tenant rates_officer session.
process.env["RA_DEV_AUTOLOGIN_SESSION"] = "default";
});

beforeAll(() => {
  // SEC-F003 ship-ready iter1: `parseDevAutologin` now refuses arbitrary
// string identifiers — autologin must be "default", "1", "true", a
// JSON blob, or one of the allowlisted role names. Use "default" so
// the existing tests resolve a TPS-tenant rates_officer session.
process.env["RA_DEV_AUTOLOGIN_SESSION"] = "default";
});
