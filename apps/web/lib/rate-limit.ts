import type { NextRequest } from "next/server";

export const MAX_BODY_BYTES = 64 * 1024;
export const RATE_LIMIT_WINDOW_MS = 60_000;

// In-memory token buckets. NOTE: this state is PER PROCESS (per ECS task), not
// shared across the fleet. With N autoscaled tasks the effective ceiling for a
// given key is N × max — intentional COARSE backpressure: every instance
// protects itself from a flood without a network round-trip on the hot path.
// EXACT cross-fleet limits (one global counter) require a shared store
// (Redis/ElastiCache) — tracked in the M2b caching/throughput design. For
// per-instance backpressure under officer-scale burst, in-memory is the right
// default: fast, dependency-free, fail-open if the map is cold.
const buckets = new Map<string, { count: number; resetAt: number }>();

// SEC-008: only trust X-Forwarded-For when running behind a known proxy.
// On Vercel that's the deployment edge; elsewhere XFF is spoofable. The
// VERCEL=1 environment variable is set by the platform on every Vercel
// deploy; we treat that as an implicit trusted-proxy signal. Operators on
// other PaaS platforms must opt in explicitly via RA_TRUSTED_PROXY=1.
function trustsForwardedFor(): boolean {
  if (process.env.RA_TRUSTED_PROXY === "1") return true;
  if (process.env.VERCEL === "1") return true;
  return false;
}

export function getClientIp(req: NextRequest): string {
  if (trustsForwardedFor()) {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
    const realIp = req.headers.get("x-real-ip");
    if (realIp) return realIp;
  }
  // NextRequest exposes `ip` on Vercel and some adapters.
  const reqIp = (req as unknown as { ip?: string }).ip;
  if (reqIp && reqIp.length > 0) return reqIp;
  return "unknown";
}

export type RateLimitResult = { ok: true } | { ok: false; resetAt: number };

// Shared fixed-window bucket logic. All three public limiters key into the same
// Map through this, so they share the window + reset semantics and the test
// reset helper clears every variant at once.
function consume(key: string, max: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }
  if (bucket.count >= max) return { ok: false, resetAt: bucket.resetAt };
  bucket.count++;
  return { ok: true };
}

/** Per-IP limiter (unchanged signature/behaviour — used by existing routes). */
export function rateLimit(ip: string, max: number): RateLimitResult {
  return consume(ip, max);
}

/**
 * Composite limiter — one bucket per (scope, tenant, ip). Enforces a PER-ROUTE
 * + PER-TENANT + PER-IP limit in a single call, so one council's (or one
 * officer's) burst can't starve another tenant on the same instance — the
 * fairness dimension the raw per-IP limiter misses. Keys are namespaced (`c|`)
 * so they never collide with raw-IP `rateLimit` buckets or `globalRateLimit`.
 */
export function rateLimitComposite(parts: {
  scope: string;
  ip: string;
  tenantId?: string;
  max: number;
}): RateLimitResult {
  const key = `c|${parts.scope}|${parts.tenantId ?? "-"}|${parts.ip}`;
  return consume(key, parts.max);
}

/**
 * Process-wide backpressure ceiling: a single shared bucket per `scope` that
 * sheds load with 429 once THIS instance is over `max` requests/min, regardless
 * of caller. Coarse by design (per-instance — see the buckets note above); the
 * point is to keep one wedged dependency (e.g. the LLM) from taking the whole
 * task down under a burst.
 */
export function globalRateLimit(
  max: number,
  scope = "__global__",
): RateLimitResult {
  return consume(`g|${scope}`, max);
}

export function exceedsBodyCap(req: NextRequest): boolean {
  const cl = req.headers.get("content-length");
  return cl !== null && Number(cl) > MAX_BODY_BYTES;
}

export function retryAfterSeconds(resetAt: number): string {
  return String(Math.ceil((resetAt - Date.now()) / 1000));
}

/**
 * Test helper — clears the in-memory rate-limit buckets so tests can
 * exercise the rate-limit path without coupling across `it()` blocks.
 *
 * Added in iter4 alongside the new verify-chain rate limit (F-011);
 * existing tool-dispatcher tests dodged the issue by spreading calls
 * across the 60-second window, but the new audit-chain-verify-route
 * test fires 7 requests in &lt;1s and trips the 6/min cap. Test files
 * call this in `beforeEach`.
 */
export function __resetRateLimitBucketsForTests(): void {
  buckets.clear();
}
