/**
 * Sentry wiring for apps/web — error + audit-grade signal capture.
 *
 * **Vendor**: Sentry US (`us.sentry.io`) for the pilot, migrated to AU
 * (Sydney) on council #1 contract sign. The DSN is the only thing that
 * changes — code paths here stay identical. See
 * `launch/OBSERVABILITY-DESIGN.md` for the full design.
 *
 * Init contract:
 *
 *   - **No-op when `SENTRY_DSN` is unset.** The pilot ships without a
 *     Sentry account; dev and test never phone home. Every export below
 *     short-circuits when `Sentry.init()` was never called.
 *   - **Replays disabled entirely.** DOM capture is a PII-leak surface
 *     we cannot accept under the AU `Privacy Act` (DOM contains
 *     ratepayer names + assessment numbers). Both
 *     `replaysSessionSampleRate` and `replaysOnErrorSampleRate` are 0,
 *     and the replay integration is never added.
 *   - **`tracesSampleRate: 0.2`** keeps pilot-scale traffic
 *     (~15k tx/mo) under the 10k/mo free perf tier with 3× headroom.
 *   - **`beforeSend` mirrors the pino redaction policy.** Every key in
 *     `apps/web/lib/logger.ts`'s redact list is also scrubbed here, plus
 *     `assessmentNumber` is truncated to last-4 only (`****1234`) so the
 *     pino<->Sentry correlation key survives.
 *
 * Audit-grade events (`captureTenantOverrideRefused`,
 * `captureCrossTenantRefused`, `captureImageryDegraded`) wrap
 * `Sentry.captureMessage` with a deterministic fingerprint per tenant
 * (so each clusters into one issue per council, not one per event).
 * These are **not exceptions** — they are expected signals on attacker
 * probes and upstream degradation. Exception clustering would mis-rank
 * them and dilute the bug-triage feed.
 */

import * as Sentry from "@sentry/nextjs";

/**
 * Mirror of `apps/web/lib/logger.ts` `REDACT_PATHS` — the pino contract
 * is canonical; this set must stay in sync. PII keys here are
 * case-insensitive (we lowercase the field name before lookup) because
 * Sentry payloads bring keys with their original casing
 * (`Authorization`, `Cookie`, third-party SDK headers).
 *
 * `assessmentNumber` is **not** in this set — see header comment; it
 * is preserved with sub-prefix redaction as the join key for audit
 * trails.
 */
const PII_KEYS: ReadonlySet<string> = new Set([
  "password",
  "token",
  "apikey",
  "email",
  "phone",
  "abn",
  "tfn",
  "name",
  "displayname",
  "firstname",
  "lastname",
  "address",
  "postaladdress",
  "streetaddress",
  "suburb",
  "postcode",
  "authorization",
  "cookie",
]);

/** Marker so we know `init()` actually wired Sentry (DSN was present). */
let initialised = false;

/**
 * Recursive scrubber. Walks an arbitrary object tree replacing values
 * whose lowercase key is in `PII_KEYS`. `assessmentNumber` is truncated
 * to last-4 with a `****` prefix.
 *
 * Depth cap of 8 guards against pathological self-referential payloads
 * (Sentry's own breadcrumbs can nest deeply when an HTTP integration
 * captures request/response bodies); the redact contract still holds at
 * every level shallower than the cap.
 */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1));
  }
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if (PII_KEYS.has(lk)) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (lk === "assessmentnumber" && typeof v === "string") {
      out[k] = v.length > 4 ? `****${v.slice(-4)}` : "[REDACTED]";
      continue;
    }
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

/**
 * Strip query-string values that commonly leak ratepayer identifiers
 * (`?q=...`, `?email=...`, `?phone=...`, `?assessmentNumber=...`). The
 * key name is preserved so dashboards can still group by route shape.
 *
 * Exported for the redaction test — call sites use `scrubEvent`.
 */
function scrubUrl(url: string): string {
  return url.replace(
    /([?&])(q|search|email|phone|abn|tfn|assessmentNumber)=[^&]+/gi,
    "$1$2=[REDACTED]",
  );
}

/**
 * Apply the redaction policy to a Sentry event in place. Exported only
 * for the unit test; production code uses it via the `beforeSend` hook
 * registered in `init()`.
 */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request !== undefined) {
    event.request = scrub(event.request) as Sentry.ErrorEvent["request"];
    if (event.request?.url) {
      event.request.url = scrubUrl(event.request.url);
    }
  }
  if (event.extra !== undefined) {
    event.extra = scrub(event.extra) as Sentry.ErrorEvent["extra"];
  }
  if (event.contexts !== undefined) {
    event.contexts = scrub(event.contexts) as Sentry.ErrorEvent["contexts"];
  }
  if (event.breadcrumbs !== undefined) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      data: scrub(b.data) as Record<string, unknown> | undefined,
    }));
  }
  if (event.tags !== undefined) {
    event.tags = scrub(event.tags) as Sentry.ErrorEvent["tags"];
  }
  return event;
}

/**
 * Initialise Sentry. No-op when `SENTRY_DSN` is unset (pilot ships
 * without an account; dev and test never phone home). Safe to call
 * multiple times — the underlying SDK guards against double-init, and
 * our `initialised` flag is idempotent.
 *
 * Wired from `apps/web/instrumentation.ts` for Node + Edge runtimes
 * (Next.js 14 App Router convention).
 */
export function initSentry(): void {
  const dsn = process.env["SENTRY_DSN"];
  if (dsn === undefined || dsn === "") return;
  if (initialised) return;
  Sentry.init({
    dsn,
    environment: process.env["SENTRY_ENVIRONMENT"] ?? process.env["NODE_ENV"],
    release: process.env["SENTRY_RELEASE"] ?? process.env["VERCEL_GIT_COMMIT_SHA"],
    tracesSampleRate: 0.2,
    // Replays are DOM-capture and risk PII leak (ratepayer names +
    // assessment numbers render into the DOM). Off, fully.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event);
    },
  });
  initialised = true;
}

/** Whether `initSentry()` actually wired the SDK (DSN was present). */
export function isSentryEnabled(): boolean {
  return initialised;
}

/**
 * Audit-grade event: a signed-in clerk attempted to coerce the MCP
 * dispatcher into a different tenant via a tool-input override. The
 * pino warn (`tool.tenant_override_refused` in
 * `app/api/tools/[name]/route.ts`) is the canonical record; this
 * Sentry capture pages the on-call.
 *
 * Fingerprint clusters one issue **per `sessionTenant`** — so a council
 * that suddenly produces dozens of these (i.e. someone's testing the
 * fence) shows up as one growing issue, not a flood that drowns the
 * triage queue.
 */
export function captureTenantOverrideRefused(args: {
  readonly actorId: string;
  readonly sessionTenant: string;
  readonly attemptedPath: string;
  readonly attemptedValue: string;
}): void {
  if (!initialised) return;
  Sentry.captureMessage("tool.tenant_override_refused", {
    level: "warning",
    fingerprint: ["audit", "tenant_override_refused", args.sessionTenant],
    tags: {
      signal: "audit",
      sessionTenant: args.sessionTenant,
      attemptedPath: args.attemptedPath,
    },
    extra: {
      actorId: args.actorId,
      // Truncate the attempted value to last-4 in case it was an
      // assessmentNumber (the most common override key after tenantId).
      attemptedValue:
        args.attemptedValue.length > 4
          ? `****${args.attemptedValue.slice(-4)}`
          : args.attemptedValue,
    },
  });
}

/**
 * Audit-grade event: a clerk in tenant A attempted to mutate tenant B's
 * data via a tenant-bound route (strata conversion, council import).
 * The route returns 403/404 and emits the pino log; this Sentry capture
 * pages the on-call so we can rotate the actor's session and audit
 * lateral movement.
 */
export function captureCrossTenantRefused(args: {
  readonly actorId: string;
  readonly sessionTenant: string;
  readonly attemptedTenant: string;
  readonly route: string;
}): void {
  if (!initialised) return;
  Sentry.captureMessage("cross_tenant_refused", {
    level: "warning",
    fingerprint: ["audit", "cross_tenant_refused", args.sessionTenant],
    tags: {
      signal: "audit",
      sessionTenant: args.sessionTenant,
      // attemptedTenant is bounded (≤200 council codes) so it's safe as
      // a tag (tag cardinality cap is per-project; we're well under).
      attemptedTenant: args.attemptedTenant,
      route: args.route,
    },
    extra: {
      actorId: args.actorId,
    },
  });
}

/**
 * Operational signal: a client-side basemap layer (currently only
 * Sentinel-2 via Esri's exportImage) saw a tile load fail. Indicates
 * upstream degradation rather than a bug — the route still works, but
 * the imagery is stale or missing for the clerk's session. Surfaces
 * as an `info`-level Sentry issue so the on-call sees correlated
 * upstream outages without paging the duty engineer.
 */
export function captureImageryDegraded(args: {
  readonly source: string;
}): void {
  if (!initialised) return;
  Sentry.captureMessage("ratesassist:imagery_degraded", {
    level: "info",
    fingerprint: ["audit", "imagery_degraded", args.source],
    tags: {
      signal: "upstream",
      source: args.source,
    },
  });
}
