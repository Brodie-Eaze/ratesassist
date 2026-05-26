import type { NextRequest } from "next/server";

export const MAX_BODY_BYTES = 64 * 1024;
export const RATE_LIMIT_WINDOW_MS = 60_000;

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

export function rateLimit(
  ip: string,
  max: number,
): { ok: true } | { ok: false; resetAt: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }
  if (bucket.count >= max) return { ok: false, resetAt: bucket.resetAt };
  bucket.count++;
  return { ok: true };
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
