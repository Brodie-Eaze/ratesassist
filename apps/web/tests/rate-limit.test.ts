/**
 * Unit tests for the rate limiter (apps/web/lib/rate-limit.ts).
 *
 * Fills the M2a gap: the limiter guarded the hot routes but had no dedicated
 * coverage. Tests the fixed-window semantics, the new per-tenant composite +
 * global backpressure limiters, key isolation (no cross-bucket bleed), the
 * window reset, body cap, retry-after, and trusted-proxy client-IP resolution.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_BODY_BYTES,
  RATE_LIMIT_WINDOW_MS,
  exceedsBodyCap,
  getClientIp,
  globalRateLimit,
  rateLimit,
  rateLimitComposite,
  retryAfterSeconds,
  __resetRateLimitBucketsForTests,
} from "@/lib/rate-limit";

// Minimal NextRequest-ish stub: getClientIp + exceedsBodyCap only read headers
// (a real Headers instance) and an optional `.ip`.
function fakeReq(headers: Record<string, string> = {}, ip?: string): never {
  const h = new Headers(headers);
  return { headers: h, ...(ip !== undefined ? { ip } : {}) } as never;
}

beforeEach(() => {
  __resetRateLimitBucketsForTests();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.RA_TRUSTED_PROXY;
});

describe("rateLimit (per-IP)", () => {
  it("allows up to max, then 429s with a resetAt in the future", () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("1.1.1.1", 3)).toEqual({ ok: true });
    }
    const blocked = rateLimit("1.1.1.1", 3);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.resetAt).toBeGreaterThan(Date.now());
  });

  it("keeps separate counters per IP", () => {
    expect(rateLimit("a", 1)).toEqual({ ok: true });
    expect(rateLimit("a", 1).ok).toBe(false); // a is now over
    expect(rateLimit("b", 1)).toEqual({ ok: true }); // b is independent
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    expect(rateLimit("ip", 1)).toEqual({ ok: true });
    expect(rateLimit("ip", 1).ok).toBe(false);
    vi.advanceTimersByTime(RATE_LIMIT_WINDOW_MS + 1);
    expect(rateLimit("ip", 1)).toEqual({ ok: true }); // window rolled over
  });
});

describe("rateLimitComposite (per scope+tenant+ip)", () => {
  it("isolates buckets by tenant", () => {
    expect(rateLimitComposite({ scope: "chat", tenantId: "TPS", ip: "x", max: 1 })).toEqual({ ok: true });
    expect(rateLimitComposite({ scope: "chat", tenantId: "TPS", ip: "x", max: 1 }).ok).toBe(false);
    // Different tenant, same scope + ip → independent allowance.
    expect(rateLimitComposite({ scope: "chat", tenantId: "KAL", ip: "x", max: 1 })).toEqual({ ok: true });
  });

  it("isolates buckets by scope", () => {
    expect(rateLimitComposite({ scope: "chat", tenantId: "TPS", ip: "x", max: 1 })).toEqual({ ok: true });
    // Same tenant + ip but a different route scope → independent.
    expect(rateLimitComposite({ scope: "export", tenantId: "TPS", ip: "x", max: 1 })).toEqual({ ok: true });
  });

  it("does not collide with raw per-IP buckets", () => {
    // Exhaust the raw-IP bucket for "x"…
    expect(rateLimit("x", 1)).toEqual({ ok: true });
    expect(rateLimit("x", 1).ok).toBe(false);
    // …the composite bucket for the same ip is namespaced, so still fresh.
    expect(rateLimitComposite({ scope: "chat", ip: "x", max: 1 })).toEqual({ ok: true });
  });
});

describe("globalRateLimit (per-instance backpressure)", () => {
  it("sheds load across all callers once over max", () => {
    expect(globalRateLimit(2)).toEqual({ ok: true });
    expect(globalRateLimit(2)).toEqual({ ok: true });
    expect(globalRateLimit(2).ok).toBe(false); // third call this window is shed
  });

  it("separates named scopes", () => {
    expect(globalRateLimit(1, "llm")).toEqual({ ok: true });
    expect(globalRateLimit(1, "llm").ok).toBe(false);
    expect(globalRateLimit(1, "spatial")).toEqual({ ok: true }); // independent scope
  });
});

describe("helpers", () => {
  it("retryAfterSeconds rounds up to whole seconds", () => {
    const resetAt = Date.now() + 4200;
    expect(Number(retryAfterSeconds(resetAt))).toBe(5);
  });

  it("exceedsBodyCap flags over-cap content-length only", () => {
    expect(exceedsBodyCap(fakeReq({ "content-length": String(MAX_BODY_BYTES + 1) }))).toBe(true);
    expect(exceedsBodyCap(fakeReq({ "content-length": String(MAX_BODY_BYTES) }))).toBe(false);
    expect(exceedsBodyCap(fakeReq({}))).toBe(false); // no header → not flagged
  });

  it("getClientIp trusts X-Forwarded-For only behind a trusted proxy", () => {
    // Untrusted: XFF ignored, falls back to req.ip.
    delete process.env.RA_TRUSTED_PROXY;
    expect(getClientIp(fakeReq({ "x-forwarded-for": "9.9.9.9" }, "2.2.2.2"))).toBe("2.2.2.2");

    // Trusted: first XFF hop wins.
    process.env.RA_TRUSTED_PROXY = "1";
    expect(getClientIp(fakeReq({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }, "2.2.2.2"))).toBe("9.9.9.9");
  });

  it("getClientIp returns 'unknown' when nothing is available", () => {
    delete process.env.RA_TRUSTED_PROXY;
    expect(getClientIp(fakeReq({}))).toBe("unknown");
  });
});
