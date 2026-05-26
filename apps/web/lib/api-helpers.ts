/**
 * REST-API helpers — Round 4B.
 *
 * Standardised response envelope + small utilities used by the new
 * /api/properties, /api/owners, /api/tenements, /api/recovery and
 * /api/exports routes. Existing routes (/api/chat, /api/tools/*,
 * /api/grants/*, /api/spatial/*, /api/evidence/*, /api/activity/*,
 * /api/discovery, /api/signals, /api/tenants, /api/integrations,
 * /api/reconciliation, /api/data) continue to use their per-route shapes
 * for the moment; they will be migrated incrementally in a follow-up
 * round.
 *
 * Envelope (success):
 *   { ok: true, data: T, pagination?: { total, limit, offset } }
 *
 * Envelope (failure):
 *   { ok: false, code: ErrorCode, message: string }
 *
 * Where `code` is the same enum already used by the contract's
 * `toolResult` discriminated union (see packages/contract/src/schemas.ts),
 * so REST clients and MCP clients see identical error codes.
 *
 * Australian-English notes are deliberate; don't "fix" "serialiser",
 * "behaviour", "council finance teams universally request CSV exports", etc.
 */

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";

import { currentCorrelationId } from "./correlation";

// ===== Error codes (mirror packages/contract/src/schemas.ts) =====

export type ErrorCode =
  | "not_found"
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "commit_token_invalid"
  | "commit_token_expired"
  | "rate_limited"
  | "upstream_error"
  | "timeout"
  | "internal_error";

// ===== Response envelope =====

export type Pagination = {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
};

export type OkBody<T> = {
  readonly ok: true;
  readonly data: T;
  readonly pagination?: Pagination;
};

export type FailBody = {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly message: string;
};

type InitOpts = {
  readonly headers?: Record<string, string>;
  readonly status?: number;
};

function withCorrelation(headers: Record<string, string>): Record<string, string> {
  const cid = currentCorrelationId();
  if (cid !== undefined && headers["x-correlation-id"] === undefined) {
    return { ...headers, "x-correlation-id": cid };
  }
  return headers;
}

/** Successful envelope. Optional headers are merged onto the response. */
export function ok<T>(
  data: T,
  init: InitOpts & { pagination?: Pagination } = {},
): NextResponse {
  const body: OkBody<T> =
    init.pagination !== undefined
      ? { ok: true, data, pagination: init.pagination }
      : { ok: true, data };
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: withCorrelation(init.headers ?? {}),
  });
}

/** Failure envelope. Status defaults are picked to match the error code. */
export function fail(
  code: ErrorCode,
  message: string,
  status?: number,
  init: InitOpts = {},
): NextResponse {
  const body: FailBody = { ok: false, code, message };
  return NextResponse.json(body, {
    status: status ?? defaultStatusFor(code),
    headers: withCorrelation(init.headers ?? {}),
  });
}

function defaultStatusFor(code: ErrorCode): number {
  switch (code) {
    case "not_found":
      return 404;
    case "invalid_input":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "conflict":
      return 409;
    case "commit_token_invalid":
    case "commit_token_expired":
      return 409;
    case "rate_limited":
      return 429;
    case "upstream_error":
      return 502;
    case "timeout":
      return 504;
    case "internal_error":
    default:
      return 500;
  }
}

// ===== Pagination =====

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export type PageOpts = {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
};

/** Paginated success envelope. Adds an X-Total-Count header. */
export function paginated<T>(items: readonly T[], opts: PageOpts): NextResponse {
  const body = {
    ok: true as const,
    data: items,
    pagination: { total: opts.total, limit: opts.limit, offset: opts.offset },
  };
  return NextResponse.json(body, {
    status: 200,
    headers: withCorrelation({
      "x-total-count": String(opts.total),
    }),
  });
}

/**
 * Apply limit/offset to an in-memory array. Caller owns sorting/filtering;
 * this helper only slices.
 */
export function applyPagination<T>(
  rows: readonly T[],
  limit: number,
  offset: number,
): { readonly slice: readonly T[]; readonly total: number } {
  return { slice: rows.slice(offset, offset + limit), total: rows.length };
}

/**
 * Parse `?limit=N&offset=M` from a URL with safe defaults and clamping.
 */
export function readPageParams(url: URL): { limit: number; offset: number } {
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");
  let limit = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
  let offset = offsetRaw === null ? 0 : Number(offsetRaw);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  return { limit, offset };
}

// ===== ETag =====

/**
 * Compute a weak ETag from the canonical JSON of `data`. We use SHA-256 and
 * keep the first 16 hex chars — collision risk is negligible at this scale
 * and the shorter value keeps response headers tidy.
 *
 * Returns the full ETag value including quotes and the `W/` weak marker, so
 * callers can write `headers: { etag: weakEtag(payload) }` directly.
 */
export function weakEtag(data: unknown): string {
  const json = canonicalJson(data);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 16);
  return `W/"${hash}"`;
}

/**
 * If the request's `If-None-Match` header matches `etag`, return a 304
 * response (with the ETag echoed back). Otherwise return null and the
 * caller should produce the normal payload.
 */
export function maybeNotModified(
  req: NextRequest | Request,
  etag: string,
): NextResponse | null {
  const inm = req.headers.get("if-none-match");
  if (inm !== null && inm === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: withCorrelation({ etag }),
    });
  }
  return null;
}

/** Stable JSON for ETag hashing — sorted keys, no whitespace. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, sortKeysReplacer);
}

function sortKeysReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return sorted;
}

// ===== CSV =====

/**
 * Serialise rows of plain objects to RFC 4180-ish CSV. The header row is
 * derived from the union of keys in `rows` (stable order: insertion order
 * of the first row, then any new keys appended in row order).
 *
 * Values are coerced as follows:
 *   - undefined / null  -> empty string
 *   - Date              -> ISO-8601
 *   - object/array      -> JSON.stringify
 *   - everything else   -> String(v)
 *
 * Quoting follows RFC 4180: every field is wrapped in double quotes and
 * any embedded `"` is doubled. CRLF line endings.
 */
export function toCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }
  const lines: string[] = [];
  lines.push(headers.map(quoteField).join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => quoteField(coerce(row[h]))).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function coerce(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function quoteField(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Build a `text/csv` Response with a Content-Disposition that prompts a
 * download with `filename` (sanitised — only alnum, dash, dot, underscore).
 */
export function streamCsv(
  rows: readonly Record<string, unknown>[],
  filename: string,
): NextResponse {
  const body = toCsv(rows);
  const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  return new NextResponse(body, {
    status: 200,
    headers: withCorrelation({
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName}"`,
    }),
  });
}

// ===== Query-param parsing =====

/**
 * Safe-parse a URL's search params against a Zod schema. The flat
 * `Record<string,string>` is built first; `coerce` schemas in the caller
 * are responsible for turning string-typed numeric / boolean params into
 * their TypeScript shapes.
 */
export function parseQueryParams<T>(
  url: URL,
  schema: z.ZodSchema<T>,
): { ok: true; value: T } | { ok: false; message: string } {
  const flat: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    flat[k] = v;
  });
  const r = schema.safeParse(flat);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, message: r.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ") };
}

// ===== Session helper =====

/**
 * Read the pre-validated session blob from the inbound request.
 *
 * Round 4A's middleware injects an `x-session` header (JSON-encoded
 * Session) for authenticated requests after validating the cookie. If
 * the header is absent in real traffic, callers see `null`. In
 * development a dev-mode fallback (`RA_DEV_AUTOLOGIN_SESSION`) is
 * honoured so devs can hit the routes without a working auth pipeline.
 * Production deployments MUST set `NODE_ENV=production`, which disables
 * the autologin fallback.
 */
export function readSession(req: NextRequest | Request): unknown | null {
  const header = req.headers.get("x-session");
  if (header !== null && header.length > 0) {
    try {
      return JSON.parse(header);
    } catch {
      return header; // tolerate plain-string sessions in tests
    }
  }
  if (process.env.NODE_ENV !== "production") {
    const dev = process.env["RA_DEV_AUTOLOGIN_SESSION"];
    if (dev !== undefined && dev.length > 0) return { id: dev };
  }
  return null;
}

/** True if the request has a session (or the dev autologin is active). */
export function hasSession(req: NextRequest | Request): boolean {
  return readSession(req) !== null;
}

/**
 * Derive the owning tenant from a RatesAssist assessment number.
 *
 * Assessment numbers follow the format `<TENANT_CODE>-<NN>-<NN>` (e.g.
 * `TPS-1102-91`, `KAL-4401-12`, `ESH-7011-08`, `ASH-9911-22`). The
 * tenant code prefix is the source of truth for which council the
 * record belongs to in the current demo data model.
 *
 * Returns `null` for strings that don't match the prefix shape — those
 * are treated as missing-tenant and the caller MUST reject (404), not
 * fall through to "any tenant".
 *
 * Long term this helper becomes obsolete once Property/Owner records
 * carry an explicit `tenantId` column (see internal/PHASE-1B-DATA-
 * MODEL.md tracking). It exists today because the pen-test surfaced
 * cross-tenant IDOR on every `[assessmentNumber]` route and the data
 * model rewrite is a separate workstream.
 */
export function tenantFromAssessmentNumber(
  assessmentNumber: string,
): string | null {
  const m = assessmentNumber.match(/^([A-Z]{2,5})-/);
  return m ? m[1] : null;
}

/**
 * Returns true when the session's `tenantId` matches the tenant derived
 * from the asset identifier. Platform admins bypass — they legitimately
 * read across tenants for support and audit.
 *
 * Callers handle the 404 themselves so the rejection looks identical
 * to "asset doesn't exist" — refusing to be an enumeration oracle for
 * which assessment numbers exist on other tenants.
 */
export function sessionMayAccessTenant(
  session: { tenantId: string; roles: ReadonlyArray<string> },
  assetTenant: string | null,
): boolean {
  if (assetTenant === null) return false;
  if (session.roles.includes("platform_admin")) return true;
  return assetTenant === session.tenantId;
}

/**
 * Resolve a session for a route handler from any supported path:
 *
 *   1. `x-session` header (middleware-injected — fast path in prod).
 *   2. `Authorization: Bearer <token>` or `Cookie: ra_session=<token>`
 *      (cookie verification — works for direct requests that don't go
 *      through middleware).
 *   3. Dev/test autologin via `parseDevAutologin()` (only fires when
 *      `RA_DEV_AUTOLOGIN_SESSION` is set AND we're outside production
 *      OR `RA_DEMO_AUTOLOGIN=1`).
 *
 * Route handlers should call this in place of `getSessionFromRequest`
 * so unit tests that exercise the handler directly still resolve a
 * principal via the env-var path that middleware would have used.
 *
 * Returns null only when ALL three paths fail — that's the authentic
 * "no session" response.
 */
export async function resolveRouteSession(
  req: NextRequest | Request,
): Promise<{
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  roles: ReadonlyArray<string>;
  issuedAt: string;
  expiresAt: string;
} | null> {
  // Lazy-load auth + auth-stub to avoid a top-of-module circular dep
  // with logger/middleware imports.
  const { getSessionFromRequest, getSession } = await import("./auth.js");
  const fromHeader = getSessionFromRequest(req);
  if (fromHeader) return fromHeader;
  const fromCookie = await getSession(req);
  if (fromCookie) return fromCookie;

  // Test/dev fallback — the autologin path that middleware would have
  // taken before reaching the route handler.
  const { parseDevAutologin, issueStubSession } = await import("./auth-stub.js");
  const stub = parseDevAutologin();
  if (!stub) return null;
  const { session } = await issueStubSession(stub);
  return session;
}
