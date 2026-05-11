/**
 * LiveGrantsWidget — characterization tests.
 *
 * The widget is a client component; apps/web's vitest harness runs Node-
 * only with no DOM, so we exercise the underlying contract here:
 *   - the /api/grants endpoint returns the shape the widget expects
 *     (happy path);
 *   - error envelopes are surfaced through the same envelope;
 *   - an empty `grants` array is a valid response.
 *
 * This pins the integration so a regression in the route would fail here
 * before reaching the dashboard.
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
process.env["RA_DEV_AUTOLOGIN_SESSION"] = "default";

vi.resetModules();
const { GET: grantsGET } = await import("../app/api/grants/route");
const { closeMcpClient } = await import("../lib/mcp-client");

afterAll(async () => {
  await closeMcpClient();
});

function req(qs: string): NextRequest {
  return new NextRequest(new URL(`http://localhost/api/grants${qs}`));
}

describe("LiveGrantsWidget contract — /api/grants?sinceDays=14", () => {
  it("happy path: returns { ok:true, data:{ grants, source } }", async () => {
    const res = await grantsGET(req("?sinceDays=14"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { grants?: unknown[]; source?: string };
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data?.grants)).toBe(true);
    expect(typeof body.data?.source).toBe("string");
  });

  it("empty-state-friendly: sinceDays=1 always returns an array, possibly empty", async () => {
    const res = await grantsGET(req("?sinceDays=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { grants?: unknown[] };
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data?.grants)).toBe(true);
  });

  it("error path: invalid sinceDays surfaces invalid_input", async () => {
    const res = await grantsGET(req("?sinceDays=9999"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("invalid_input");
  });
});
