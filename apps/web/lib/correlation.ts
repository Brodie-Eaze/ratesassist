/**
 * AsyncLocalStorage-based correlation context.
 *
 * The middleware wraps every request in `runWithCorrelation` so any code
 * downstream (route handlers, lib functions, child loggers) can call
 * `getCorrelation()` to retrieve the current request's correlationId
 * without threading it through call signatures.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type CorrelationContext = {
  readonly correlationId: string;
  readonly route: string;
  readonly method: string;
  readonly ip?: string;
  readonly userAgent?: string;
  readonly tenantId?: string;
};

export const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Run `fn` with `ctx` bound as the active correlation context.
 * Any awaited code inside `fn` can recover `ctx` via `getCorrelation()`.
 */
export function runWithCorrelation<T>(
  ctx: CorrelationContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return correlationStorage.run(ctx, fn);
}

export function getCorrelation(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

/** Returns the current correlationId, or undefined if no context is active. */
export function currentCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

/**
 * Pick or generate a correlationId for an incoming request.
 * Trusts inbound `X-Request-Id` / `Trace-Id` if it looks well-formed
 * (length-bounded, ASCII-printable); otherwise mints a UUIDv4.
 */
export function correlationIdFromHeaders(
  headers: Headers | Record<string, string | undefined>,
): string {
  const get = (name: string): string | undefined => {
    if (headers instanceof Headers) {
      return headers.get(name) ?? undefined;
    }
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lower) return v ?? undefined;
    }
    return undefined;
  };

  const inbound = get("x-request-id") ?? get("trace-id") ?? get("x-correlation-id");
  if (inbound && isWellFormedId(inbound)) return inbound;
  return randomUUID();
}

function isWellFormedId(v: string): boolean {
  if (v.length === 0 || v.length > 128) return false;
  // ASCII printable, excluding control characters.
  return /^[A-Za-z0-9._\-:]+$/.test(v);
}
