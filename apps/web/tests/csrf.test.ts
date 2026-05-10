/**
 * SEC-014: Origin/CSRF check on mutating verbs in middleware.ts.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "../middleware";

function makeReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(new URL(url), {
    method,
    headers: new Headers(headers),
  });
}

describe("CSRF / Origin check (SEC-014)", () => {
  beforeEach(() => {
    delete process.env.RA_CSRF_EXEMPT_PATHS;
  });

  it("POST with no Origin header → 403 csrf_origin_mismatch", async () => {
    const req = makeReq("POST", "https://app.example.com/api/chat", {
      host: "app.example.com",
    });
    const res = middleware(req);
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({
      ok: false,
      code: "csrf_origin_mismatch",
    });
  });

  it("POST with mismatched Origin → 403", async () => {
    const req = makeReq("POST", "https://app.example.com/api/chat", {
      host: "app.example.com",
      origin: "https://evil.example.org",
    });
    const res = middleware(req);
    expect(res.status).toBe(403);
  });

  it("POST with matching Origin → passes through (no 403)", async () => {
    const req = makeReq("POST", "https://app.example.com/api/chat", {
      host: "app.example.com",
      origin: "https://app.example.com",
    });
    const res = middleware(req);
    expect(res.status).not.toBe(403);
  });

  it("GET with no Origin → unaffected (no 403)", async () => {
    const req = makeReq("GET", "https://app.example.com/api/health", {
      host: "app.example.com",
    });
    const res = middleware(req);
    expect(res.status).not.toBe(403);
  });

  it("DELETE with mismatched Origin → 403", async () => {
    const req = makeReq("DELETE", "https://app.example.com/api/foo", {
      host: "app.example.com",
      origin: "https://attacker.test",
    });
    const res = middleware(req);
    expect(res.status).toBe(403);
  });

  it("RA_CSRF_EXEMPT_PATHS exempts a path prefix", async () => {
    process.env.RA_CSRF_EXEMPT_PATHS = "/api/webhook";
    try {
      const req = makeReq("POST", "https://app.example.com/api/webhook/x", {
        host: "app.example.com",
      });
      const res = middleware(req);
      expect(res.status).not.toBe(403);
    } finally {
      delete process.env.RA_CSRF_EXEMPT_PATHS;
    }
  });

  it("/api/tools/* is NOT exempt by default", async () => {
    const req = makeReq("POST", "https://app.example.com/api/tools/run", {
      host: "app.example.com",
    });
    const res = middleware(req);
    expect(res.status).toBe(403);
  });
});
