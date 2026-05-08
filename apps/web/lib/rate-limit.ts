import type { NextRequest } from "next/server";

export const MAX_BODY_BYTES = 64 * 1024;
export const RATE_LIMIT_WINDOW_MS = 60_000;

const buckets = new Map<string, { count: number; resetAt: number }>();

export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
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
