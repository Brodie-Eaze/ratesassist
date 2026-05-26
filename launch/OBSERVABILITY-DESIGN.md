# OBSERVABILITY-DESIGN.md

**Phase**: 2 — Council Pilot 3am observability layer
**Owner**: Brodie (on-call)
**Status**: Spec, ready to implement
**Pairs with**: `apps/web/lib/logger.ts` (pino redaction is canonical), `internal/OBSERVABILITY.md`, `INCIDENT-RESPONSE-RUNBOOK.md`

---

## 1. Vendor pick — Sentry (US region), with a documented migration path

| Vendor | Free tier | AU residency on free | Verdict |
|---|---|---|---|
| **Sentry** | 5k errors + 10k perf / mo | No (AU is paid Business+, ~US$80/mo) | **Pick** — `us.sentry.io`, gated by DPIA |
| GlitchTip | Self-host or 1k errors hosted | Self-host on Sydney VM = yes | Reject — adds an ops surface we cannot staff at one-person scale |
| Highlight.io | 1k sessions/mo | US only | Reject — session-replay risks PII capture (DOM scraping) |
| BetterStack (Logtail+Uptime) | 1GB logs, 10 monitors | EU (Frankfurt) | Reject for APM (no exception SDK); already used for log shipping |

**Decision**: Sentry US (`us.sentry.io`) for the pilot.
**Compliance gate**: data sent is exception metadata + stack traces + redacted breadcrumbs. No ratepayer PII (enforced by `beforeSend`; see §3). AU residency is *required for ratepayer records* per `DATA-CLASSIFICATION-MATRIX.md`; Sentry payloads are operational telemetry, not ratepayer data, so US transit is acceptable **iff** the `beforeSend` redactor holds. Document this in the Privacy Impact Assessment as a sub-processor under `SUB-PROCESSORS.md` before the pilot signs.
**Trigger to upgrade**: first paying council on contract → buy Sentry Business AU region (Sydney) and flip the DSN. No code change beyond `SENTRY_DSN`.

---

## 2. Wiring shape — files in install order

1. **`apps/web/package.json`** — add `@sentry/nextjs` (peer of Next 14, Node 20 OK).
2. **`apps/web/lib/sentry.ts`** *(new)* — exports `initSentry()`; reads `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`; **returns early if DSN unset** (dev + test never phone home). Wires `beforeSend` (§3) and `beforeSendTransaction` (drops `/api/health`, `/_next/static/*`).
3. **`apps/web/instrumentation.ts`** *(new — Next 14 convention)* — exports `register()`; calls `initSentry()` for both `nodejs` and `edge` runtimes. This is the *only* legal place to init the SDK at process start under App Router.
4. **`apps/web/app/global-error.tsx`** *(new)* — root-level error boundary; calls `Sentry.captureException(error)` then renders a minimal fallback. Must be a client component.
5. **`apps/web/next.config.js`** — extend `connect-src` with `https://*.sentry.io` (or the tunnel route `/api/monitoring` if you proxy to defeat ad-blockers — recommended for the council network, where corporate firewalls block `*.sentry.io`).
6. **`serverComponentsExternalPackages`** — **no change needed**. `@sentry/nextjs` ships its own webpack plugin that injects instrumentation at build time; it does not need to be marked external. (Marking it external would *break* the source-map upload step.)
7. **`apps/web/sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts`** *(thin shims)* — each imports `initSentry()` from `lib/sentry.ts`. Required by `@sentry/nextjs`'s webpack plugin convention; keeps real logic centralised.
8. **Env**: `SENTRY_DSN`, `SENTRY_ENVIRONMENT` (= `pilot|production`), `SENTRY_AUTH_TOKEN` (CI only, for source-map upload). Add to Railway and Vercel project envs.

---

## 3. Redaction policy — `beforeSend` enforces the pino contract

Canonical list lives in `apps/web/lib/logger.ts` (`REDACT_PATHS`). Sentry must mirror it. Skeleton:

```ts
// apps/web/lib/sentry.ts (excerpt)
const PII_KEYS = new Set([
  "email", "phone", "name", "firstName", "lastName",
  "address", "streetAddress", "suburb", "postcode",
  "abn", "tfn", "password", "token", "apiKey",
  "authorization", "cookie",
]);
// assessmentNumber: KEEP (with sub-prefix redaction). It is the join key
// for every audit trail; losing it makes Sentry events un-correlatable
// with pino logs. Truncate to last-4 only: "****1234".
//
// FLAG FOR DECISION: confirm with DPO before pilot. If they say strip it
// entirely, add to PII_KEYS and accept the correlation loss.

function scrub(obj: unknown, depth = 0): unknown {
  if (depth > 8 || obj == null) return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrub(v, depth + 1));
  if (typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if (PII_KEYS.has(lk)) { out[k] = "[REDACTED]"; continue; }
    if (lk === "assessmentnumber" && typeof v === "string") {
      out[k] = v.length > 4 ? `****${v.slice(-4)}` : "[REDACTED]";
      continue;
    }
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT,
  tracesSampleRate: 0.2,           // 20% to stay under 10k/mo at pilot scale
  sendDefaultPii: false,           // belt + braces
  beforeSend(event) {
    event.request = scrub(event.request) as Sentry.Request;
    event.extra   = scrub(event.extra)   as Record<string, unknown>;
    event.contexts = scrub(event.contexts) as Sentry.Contexts;
    event.breadcrumbs = event.breadcrumbs?.map((b) => ({
      ...b, data: scrub(b.data) as Record<string, unknown>,
    }));
    // URL query-string scrub — assessment numbers leak via ?q=
    if (event.request?.url) {
      event.request.url = event.request.url.replace(/([?&])(q|search|email|phone)=[^&]+/gi, "$1$2=[REDACTED]");
    }
    return event;
  },
});
```

Test: add `apps/web/tests/sentry-redact.test.ts` asserting every key in `PII_KEYS` is `"[REDACTED]"` in the post-scrub event. Block CI on it.

---

## 4. Custom events — audit-grade signals as `captureMessage`, not exceptions

These are **not bugs**; they are security/operational signals. Exception clustering would mis-rank them. Use `captureMessage` with an explicit fingerprint so each clusters into one issue per tenant.

```ts
// On tool refusal (tools/[name]/route.ts)
Sentry.captureMessage("tool.tenant_override_refused", {
  level: "warning",
  fingerprint: ["tenant_override_refused", councilCode],
  tags: { signal: "audit", councilCode, toolId },
});

Sentry.captureMessage("cross_tenant_refused", {
  level: "warning",
  fingerprint: ["cross_tenant_refused", councilCode],
  tags: { signal: "audit", councilCode, sourceTenant, targetTenant: "[REDACTED]" },
});

// Sentinel2LiveLayer CustomEvent → server beacon
// Client listener in app/layout.tsx posts to /api/observability/beacon,
// which calls:
Sentry.captureMessage("ratesassist:imagery_degraded", {
  level: "info",
  fingerprint: ["imagery_degraded", upstreamName],
  tags: { signal: "upstream", upstream: upstreamName, councilCode },
});
```

All three: **no body, no PII, just the signal + tags**. Tags are bounded (council codes are a known set, ≤200).

---

## 5. Four-golden-signals dashboard (Sentry Discover)

Create dashboard `RatesAssist — Pilot Council` with four panels:

| Panel | Signal | Discover query |
|---|---|---|
| **Latency p99** | Latency | `event.type:transaction has:transaction.duration` → visualise `p99(transaction.duration)` grouped by `transaction` (route), 1h buckets |
| **Error rate** | Errors | `event.type:error !tags[signal]:audit` → `count() / count_if(event.type:transaction)` as % over 5m, grouped by `transaction` |
| **Tool throughput** | Traffic | `event.type:transaction transaction:"POST /api/tools/*"` → `count()` grouped by `tags[toolId]`, 5m buckets |
| **MCP child health** | Saturation | `message:"mcp.child.heartbeat" OR message:"mcp.child.timeout"` → `count_if(message:"mcp.child.timeout") / count()` as % over 5m, grouped by `tags[childId]` |

(Worker process must emit `mcp.child.heartbeat` breadcrumbs every 10s for the saturation panel to function — wire that into the existing adapter-demo child supervisor; ≤2k events/mo at 10s × 1 child × 8h-day.)

---

## 6. Alert rules — exactly three, all email-paged to `brodie@amalafinance.com.au`

| # | Rule | Sentry Alert config | Severity |
|---|---|---|---|
| 1 | Error rate > 1% over 5 min | Metric alert: `count_if(event.type:error) / count_if(event.type:transaction) > 0.01`, window 5m, threshold 1, environment `pilot` | **P1** |
| 2 | Any audit-grade event | Issue alert: condition `the event's tags.signal equals audit`, action: email; **frequency: every occurrence**, no `1 per hour` cap | **P0** |
| 3 | MCP child unresponsive > 30s | Metric alert: `count_if(message:"mcp.child.timeout") >= 1` in last 30s, environment `pilot` | **P1** |

Each rule links to a runbook section in `INCIDENT-RESPONSE-RUNBOOK.md`:
- Rule 1 → §"5xx Spike"
- Rule 2 → §"Tenant Isolation Breach Attempt" *(NEW — write before pilot)*
- Rule 3 → §"MCP Child Supervisor"

**No runbook = no page** (per ops doctrine). Rule 2's runbook is the only one missing; add it as a launch blocker.

---

## 7. Cost projection

Pilot scale: 1 council × 5 clerks × ~500 reqs/day × 30d = **15,000 transactions/mo**.

- **Errors** (5k free): healthy app should produce <50 unhandled errors/mo. Audit-grade events fingerprint to 1 issue/tenant/type → ≤10/mo. Headroom: 10×.
- **Performance** (10k free): 15k txn × 0.2 sample rate = **3,000/mo**. Headroom: 3×.
- **Replays**: **disabled** (DOM capture risks PII leak; explicitly off in `initSentry()`).

**Paid trigger**: second council onboarded (×2 traffic = ~6k perf events, still free) **or** first prod incident with replay needed. Realistic paid date: **council #3** at ~9k perf/mo, or earlier if AU residency is required by contract (which it will be — budget Sentry Business AU at ~US$80/mo from council #1 signing).

---

## 8. Migration when Vercel-syd lands

**No code changes.** `@sentry/nextjs` already speaks Vercel natively. Specific deltas:

1. **Env vars on Vercel** — set `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. The auth token unlocks **source-map upload at build time** (the killer Vercel feature — stack traces de-minified automatically).
2. **Release tagging** — Vercel exposes `VERCEL_GIT_COMMIT_SHA`; pass it to `Sentry.init({ release: process.env.VERCEL_GIT_COMMIT_SHA })`. Already supported by `initSentry()`.
3. **Tunnel route** — keep `/api/monitoring` proxy; Vercel Edge supports it and it survives council-network ad-blockers.
4. **AU region** — if Vercel `syd1` is live and Sentry is still US, that is the *new* compliance gate. Either (a) Sentry AU paid, or (b) self-hosted GlitchTip on a Sydney VPS as a fallback. Decide before flipping prod DNS to Vercel.
5. **Edge runtime** — `sentry.edge.config.ts` already covers it; no extra work.

---

## Verdict

**FIX FIRST**. Three launch blockers:

1. Tenant-isolation runbook section missing (referenced by Alert Rule 2).
2. DPO sign-off on `assessmentNumber` redaction policy (last-4 vs full strip).
3. Sub-processor entry for Sentry in `SUB-PROCESSORS.md` + PIA update.

Implementation order once unblocked: §2 wiring (1 day) → §3 redactor + test (½ day) → §4 custom events at call sites (½ day) → §5 dashboard (1 hr in UI) → §6 alerts (1 hr in UI). **Total: 2.5 engineer-days to launch-ready.**
