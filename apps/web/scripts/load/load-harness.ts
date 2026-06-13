#!/usr/bin/env tsx
/**
 * RatesAssist — concurrent load harness (in-process, deterministic).
 *
 * WHY
 * ---
 * The ship-readiness Performance gate needs "load tested at projected peak in
 * the last 30 days" + "p99 within SLO". We already have a single-shot
 * recovery-sweep micro-benchmark (`scripts/perf-bench.ts`). This harness adds
 * the missing piece: a CONCURRENT load baseline against the REAL
 * revenue-critical hot-path code, measured against the exact SLO targets in
 * `internal/SLO-SLI.md`.
 *
 * WHAT IT DRIVES (the SLO-scoped paths)
 * -------------------------------------
 *   - chat            POST /api/chat  → `runChat()` on the MOCK LLM path. This
 *                     exercises the full intent-router + the multi-tool
 *                     dispatch loop a chat turn fans out into (2–3 `runTool`
 *                     calls/turn), end to end, with tenant scoping applied.
 *   - properties      GET /api/properties → `runTool("list_properties")`, the
 *                     grounding read behind the property workspace.
 *   - sweep_demo      the recovery mismatch sweep as the chat surface calls it:
 *                     `runTool("find_mining_mismatches", {minSeverity:"low"})`
 *                     over the demo dataset (~115 properties).
 *   - sweep_engine    the raw recovery engine `findMismatches(ctx)` at COUNCIL
 *                     SCALE (5,000 parcels) — the worst-case CPU sweep a large
 *                     pilot council (Kalgoorlie / East Pilbara) would trigger.
 *   - verify_chain    GET /api/audit/verify-chain → the route's actual CPU
 *                     driver, `verifyChain()` from @ratesassist/audit-core over
 *                     a synthetic 1,000-row valid chain (the SLO is "< 5s for
 *                     ≤ 1,000 rows"; the F-011 note in the route confirms the
 *                     SHA-256 recompute IS the latency, not the DB read).
 *   - ready           GET /api/ready → the catalogue probe `listMcpTools()`.
 *   - health          GET /api/health → the fixed-200 handler body.
 *
 * CONCURRENCY MODEL — "projected peak" for a council pilot
 * --------------------------------------------------------
 * A single council rates department running a pilot is ~20–30 officers. We
 * size base concurrency at 25 simultaneously-active officers and apply a 3×
 * burst multiplier (Monday-morning arrears run, end-of-quarter) → ~75
 * concurrent in-flight operations. That is the documented "peak".
 *
 * The harness uses a CLOSED-LOOP model: it holds exactly N operations in
 * flight at all times for a fixed wall-clock window. Each worker picks the
 * next op, awaits it, records the wall-clock latency, then immediately issues
 * the next. This is a more honest stress than open-loop fire-and-forget on a
 * single Node event loop because it measures the latency a real caller would
 * see once the loop is saturated (queuing + CPU contention included).
 *
 * Two run shapes:
 *   1. MIXED   — all paths interleaved at peak concurrency, in the realistic
 *                traffic mix a pilot generates (mostly reads, some sweeps).
 *   2. ISOLATED— each path run alone at its own peak concurrency, so a slow
 *                path can't hide behind fast ones and each SLO is judged on a
 *                clean per-path distribution.
 *
 * HONESTY — what this does NOT simulate
 * -------------------------------------
 *   - No network: the LLM is the MOCK path (no Anthropic call), transport is
 *     inproc (no stdio child). Real chat p99 in production is dominated by the
 *     Anthropic round-trip, which the SLA explicitly EXCLUDES from the error
 *     budget (Anthropic outage). So our chat numbers measure OUR code's
 *     contribution to latency, not the model's — stated plainly in the doc.
 *   - No real DB latency: RA_USE_DB is off. `list_properties` reads the
 *     in-memory demo store; `verify_chain` hashes a synthetic in-memory chain.
 *     The route's Postgres read is NOT measured (a single PgBouncer-fronted
 *     read on an indexed `(tenant_id, occurred_at, id)` chain is ~ms, and the
 *     F-011 note attributes the latency to the SHA-256 work, which we DO
 *     measure). Real-DB numbers require a provisioned Postgres + RA_USE_DB.
 *   - Single process, single core's event loop: production runs multiple
 *     Fargate/Vercel replicas. So this is the per-replica worst case — if one
 *     replica holds at peak under SLO, the fleet does too.
 *
 * REPRODUCIBILITY
 * ---------------
 * Deterministic seeded PRNG for all synthetic data. Timing via
 * `process.hrtime.bigint()`. No wall-clock-dependent fixtures (the engine
 * clock is pinned). Re-running on the same machine yields stable percentiles
 * (± event-loop jitter).
 *
 * RUN
 * ---
 *   cd apps/web
 *   RA_TOOL_TRANSPORT=inproc npx tsx scripts/load/load-harness.ts
 *
 * Optional env:
 *   LOAD_PEAK=75         concurrent in-flight ops at peak (default 75)
 *   LOAD_DURATION_MS     per-scenario wall-clock window (default 4000)
 *   LOAD_WARMUP_MS       warmup before measuring (default 750)
 *   LOAD_SWEEP_PARCELS   council-scale parcel count for sweep_engine (default 5000)
 *   LOAD_JSON=1          emit machine-readable JSON summary to stdout tail
 *
 * The harness sets RA_TOOL_TRANSPORT=inproc and clears ANTHROPIC_API_KEY
 * itself if not already set, so the command above works even without the env
 * prefix — but we keep the prefix in docs for explicitness.
 */

// --- Force the deterministic, network-free configuration BEFORE any app
// --- module is imported (mcp-client resolves the transport at module load).
process.env["RA_TOOL_TRANSPORT"] = "inproc";
delete process.env["ANTHROPIC_API_KEY"]; // guarantee the MOCK LLM path
delete process.env["RA_USE_DB"]; // no DB
// Quiet the per-tool-call pino logs during the run so the report is readable.
// The SLIs are derived from these logs in production; here we're MEASURING
// wall-clock latency directly with hrtime, so the info-level log lines are
// pure noise. "fatal" is the quietest level the app logger accepts
// (resolveLevel() rejects "silent"); genuine errors still surface.
if (process.env["LOG_LEVEL"] === undefined) process.env["LOG_LEVEL"] = "fatal";

import {
  computeRowHash,
  genesisHash,
  verifyChain,
  type AuditRowWithHashes,
} from "@ratesassist/audit-core";
import type {
  LandUse,
  Owner,
  Property,
  RateTable,
  Tenement,
  TenementType,
} from "@ratesassist/contract";
import { WA_RATE_TABLES } from "@ratesassist/contract";
import {
  findMismatches,
  type ChangeDetectionEntry,
  type EvaluationContext,
} from "@ratesassist/recovery-engine";

import { runChat } from "@/lib/llm";
import { listMcpTools } from "@/lib/mcp-client";
import { runTool } from "@/lib/tools";
import type { ToolScope } from "@/lib/tool-tenant-scope";

// ========================= Config =========================

const PEAK = intEnv("LOAD_PEAK", 75);
const DURATION_MS = intEnv("LOAD_DURATION_MS", 4_000);
const WARMUP_MS = intEnv("LOAD_WARMUP_MS", 750);
const SWEEP_PARCELS = intEnv("LOAD_SWEEP_PARCELS", 5_000);
const EMIT_JSON = process.env["LOAD_JSON"] === "1";

// Pilot tenant scope: a rates supervisor in one council. Mirrors the scope
// the chat route builds from the session. NOTE: `tenantId` here is the council
// CODE (e.g. "TPS" — Shire of Tom Price), because the tenant-scope layer
// force-injects `input.council = scope.tenantId` for read tools, and the
// adapter validates `council` against the known council codes. A non-code
// value (e.g. "tenant-tps") is correctly rejected as `invalid_input`.
const COUNCIL_CODE = process.env["LOAD_COUNCIL"] ?? "TPS";
const SCOPE: ToolScope = {
  tenantId: COUNCIL_CODE,
  roles: ["rates_supervisor"],
};

// SLO targets transcribed verbatim from internal/SLO-SLI.md §2 (PILOT tier).
// p99 latency is the SLO GATE; availability is the second gate.
type SloTarget = {
  readonly label: string;
  readonly p99Ms: number;
  readonly availability: number; // fraction, e.g. 0.99
  readonly note: string;
};

const SLO: Record<string, SloTarget> = {
  chat: {
    label: "POST /api/chat",
    p99Ms: 20_000,
    availability: 0.99,
    note: "SLA §2/§3 pilot: p99 < 20s, 99.0% avail. p95 < 8s tracked too.",
  },
  properties: {
    label: "GET /api/properties",
    p99Ms: 1_500,
    availability: 0.995,
    note: "Internal: DB read, not an LLM call.",
  },
  verify_chain: {
    label: "GET /api/audit/verify-chain",
    p99Ms: 5_000,
    availability: 0.995,
    note: "p99 < 5s for ≤ 1,000 rows; integrity (zero genuine breaks) is separate & hard.",
  },
  ready: {
    label: "GET /api/ready",
    p99Ms: 2_500,
    availability: 0.999,
    note: "Bounded by the 2s MCP-connect budget.",
  },
  health: {
    label: "GET /api/health",
    p99Ms: 250,
    availability: 0.9995,
    note: "No external deps; process-up.",
  },
};

// The recovery sweep isn't a discrete SLO row, but it is a chat tool-call: its
// latency contributes to the chat p99. We judge it against the chat budget and
// surface the council-scale engine sweep separately as a stress finding.
const SWEEP_BUDGET_MS = 2_000; // matches scripts/perf-bench.ts FULL_SWEEP_BUDGET_MS

// ========================= Deterministic PRNG =========================

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x10ad7e57);
function choice<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)] as T;
}
function randint(lo: number, hi: number): number {
  return Math.floor(rand() * (hi - lo + 1)) + lo;
}

// ========================= Council-scale synthesis (sweep_engine) =========================
// Self-contained, deterministic. Mirrors scripts/perf-bench.ts so the engine
// sweep stresses the same realistic shape (mining/rural mix + tenement stack +
// change-detection candidates) at 5k parcels.

const COUNCIL_CODES = Object.keys(WA_RATE_TABLES);
const LAND_USES: LandUse[] = [
  "Residential",
  "Commercial",
  "Industrial",
  "Rural",
  "Vacant",
  "Mining",
];
const PINNED_NOW_MS = Date.parse("2026-05-29T00:00:00Z");

function synthOwners(n: number): Owner[] {
  const owners: Owner[] = [];
  const words = ["Iron", "Resources", "Minerals", "Mining", "Gold", "Lithium", "Pastoral", "Exploration"];
  for (let i = 0; i < n; i++) {
    const useIndustry = i % 4 === 0;
    const cancelled = i % 25 === 0;
    const name = useIndustry
      ? `${choice(words)} ${choice(["Holdings", "Group", "Co", "Pty Ltd"])} ${i}`
      : `Generic Ratepayer ${i}`;
    owners.push({
      ownerId: `O-${i.toString().padStart(4, "0")}`,
      name,
      abn: useIndustry ? `${10_000_000_000 + i}` : null,
      abnCheck: useIndustry
        ? { kind: "checked", status: cancelled ? "Cancelled" : "Active", checkedAt: "2026-05-01" }
        : { kind: "unchecked" },
      postalAddress: `PO Box ${100 + i}`,
      email: null,
      phone: null,
      ownerSince: "2020-01-01",
      previousOwners: [],
    });
  }
  return owners;
}

function synthProps(owners: readonly Owner[], n: number): Property[] {
  const props: Property[] = [];
  for (let i = 0; i < n; i++) {
    const council = choice(COUNCIL_CODES);
    const landUse = choice(LAND_USES);
    const owner = owners[i % owners.length]!;
    const grv = landUse === "Rural" || landUse === "Mining" ? undefined : randint(150_000, 2_500_000);
    const uv = landUse === "Rural" || landUse === "Mining" ? randint(20_000, 800_000) : undefined;
    const annualRates = (grv ?? uv ?? 100_000) * 0.012;
    props.push({
      assessmentNumber: `${council}-LOAD-${i.toString().padStart(5, "0")}`,
      council,
      address: `Lot ${i} Sample Road`,
      suburb: `LoadSuburb${i % 30}`,
      postcode: "0000",
      state: "WA",
      landUse,
      valuation: grv ?? uv ?? 250_000,
      annualRates: Math.round(annualRates),
      balance: 0,
      lastPaymentDate: null,
      lastPaymentAmount: null,
      paymentMethod: null,
      pensionerRebate: false,
      paymentArrangement: false,
      ownerIds: [owner.ownerId],
      notes: [],
      lat: -22 + rand() * 8,
      lng: 115 + rand() * 8,
      grv,
      uv,
    });
  }
  return props;
}

function synthTenements(properties: readonly Property[], n: number): Tenement[] {
  const tenements: Tenement[] = [];
  const types: TenementType[] = ["M", "E", "P", "G", "L"];
  const eligible = properties.filter((p) => p.landUse === "Rural" || p.landUse === "Vacant");
  if (eligible.length === 0) return tenements;
  for (let i = 0; i < n; i++) {
    const target = eligible[i % eligible.length]!;
    const intersects = [target.assessmentNumber];
    for (let k = 1; k < 3; k++) {
      intersects.push(eligible[(i + k * 7) % eligible.length]!.assessmentNumber);
    }
    tenements.push({
      tenementId: `M ${50 + i}/${1000 + i}`,
      type: types[i % types.length]!,
      status: "Live",
      holder: `Synth Resources ${i}`,
      holderAbn: null,
      commodity: ["iron"],
      grantedDate: i % 8 === 0
        ? new Date(PINNED_NOW_MS - 30 * 24 * 3600_000).toISOString().slice(0, 10)
        : "2018-06-01",
      expiryDate: "2030-01-01",
      areaHectares: 200,
      intersectsAssessmentNumbers: intersects,
      isProducing: i % 3 === 0,
      lastWorkProgramYear: 2024,
      polygon: [],
    });
  }
  return tenements;
}

function synthChangeDetection(
  properties: readonly Property[],
  n: number,
): ReadonlyMap<string, readonly ChangeDetectionEntry[]> {
  const map = new Map<string, readonly ChangeDetectionEntry[]>();
  for (let i = 0; i < n; i++) {
    const p = properties[(i * 47) % properties.length]!;
    const correct: ChangeDetectionEntry["correctLandUse"] =
      p.landUse === "Rural" || p.landUse === "Vacant" ? "Mining" : "Commercial";
    map.set(p.assessmentNumber, [
      {
        kind: "commercial_use_observed",
        detectedAt: "2024-02-15",
        correctLandUse: correct,
        reasoning: `Load-harness change-detection entry for ${p.assessmentNumber}.`,
      },
    ]);
  }
  return map;
}

function buildEngineCtx(parcels: number): EvaluationContext {
  const owners = synthOwners(Math.max(50, Math.floor(parcels / 25)));
  const properties = synthProps(owners, parcels);
  const tenements = synthTenements(properties, Math.max(20, Math.floor(parcels / 100)));
  const changeDetection = synthChangeDetection(properties, Math.max(50, Math.floor(parcels / 50)));

  const ownersById = new Map(owners.map((o) => [o.ownerId, o]));
  const tenementsByAssessment = new Map<string, Tenement[]>();
  for (const t of tenements) {
    for (const a of t.intersectsAssessmentNumbers) {
      const b = tenementsByAssessment.get(a);
      if (b === undefined) tenementsByAssessment.set(a, [t]);
      else b.push(t);
    }
  }
  const propertiesByOwnerId = new Map<string, Property[]>();
  const ruralBySuburb = new Map<string, Property[]>();
  for (const p of properties) {
    for (const oid of p.ownerIds) {
      const b = propertiesByOwnerId.get(oid);
      if (b === undefined) propertiesByOwnerId.set(oid, [p]);
      else b.push(p);
    }
    if (p.landUse === "Rural") {
      const b = ruralBySuburb.get(p.suburb);
      if (b === undefined) ruralBySuburb.set(p.suburb, [p]);
      else b.push(p);
    }
  }
  const rateTablesByCouncil: ReadonlyMap<string, RateTable> = new Map(
    Object.entries(WA_RATE_TABLES),
  );
  return {
    properties,
    ownersById,
    tenementsByAssessment,
    propertiesByOwnerId,
    ruralBySuburb,
    changeDetectionByAssessment: changeDetection,
    rateTablesByCouncil,
    targetStateScope: "WA",
    now: () => PINNED_NOW_MS,
  };
}

// ========================= Synthetic audit chain (verify_chain) =========================
// Build a VALID 1,000-row hash chain using audit-core's own canonicaliser, so
// `verifyChain()` does the exact SHA-256 work the route does. We build it ONCE
// and verify it repeatedly under load (the route re-reads + re-verifies per
// request).

function buildAuditChain(tenantId: string, rows: number): AuditRowWithHashes[] {
  const out: AuditRowWithHashes[] = [];
  let prev = genesisHash(tenantId);
  const base = Date.parse("2026-01-01T00:00:00Z");
  for (let i = 0; i < rows; i++) {
    const body = {
      id: `audit-${i.toString().padStart(6, "0")}`,
      tenantId,
      actorId: `officer-${i % 25}`,
      actorKind: "user",
      action: i % 3 === 0 ? "property.note.add" : "recovery.sweep.run",
      targetType: "property",
      targetId: `TPS-${1000 + (i % 500)}-${i % 99}`,
      before: null,
      after: { seq: i },
      correlationId: `corr-${i}`,
      ip: "203.0.113.7",
      userAgent: "load-harness",
      occurredAt: new Date(base + i * 1000).toISOString(),
    };
    const rowHash = computeRowHash(prev, body);
    out.push({ ...body, prevHash: prev, rowHash });
    prev = rowHash;
  }
  return out;
}

// ========================= Measurement core =========================

type Sample = number; // latency ms

type Op = {
  readonly name: string;
  readonly run: () => Promise<void>;
};

type Result = {
  readonly name: string;
  readonly count: number;
  readonly errors: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
  readonly throughput: number; // ops/sec
  readonly windowMs: number;
};

function percentile(sorted: readonly Sample[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function summarise(name: string, samples: Sample[], errors: number, windowMs: number): Result {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((s, v) => s + v, 0);
  return {
    name,
    count: samples.length,
    errors,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
    mean: samples.length > 0 ? sum / samples.length : 0,
    throughput: (samples.length / windowMs) * 1000,
    windowMs,
  };
}

/**
 * Closed-loop driver: hold exactly `concurrency` operations in flight for
 * `durationMs`. Each worker loops: pick next op (round-robins the weighted
 * pool), time it with hrtime, record latency, repeat until the deadline.
 * A short warmup primes module imports / JIT and is NOT measured.
 */
async function drive(
  pool: readonly Op[],
  concurrency: number,
  durationMs: number,
  warmupMs: number,
): Promise<Map<string, { samples: Sample[]; errors: number }>> {
  const buckets = new Map<string, { samples: Sample[]; errors: number }>();
  for (const op of pool) {
    if (!buckets.has(op.name)) buckets.set(op.name, { samples: [], errors: 0 });
  }

  const warmupDeadline = now() + warmupMs;
  const measureDeadline = warmupDeadline + durationMs;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (now() < measureDeadline) {
      const op = pool[cursor % pool.length]!;
      cursor++;
      const measuring = now() >= warmupDeadline;
      const t0 = process.hrtime.bigint();
      try {
        await op.run();
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        if (measuring) buckets.get(op.name)!.samples.push(ms);
      } catch {
        if (measuring) buckets.get(op.name)!.errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return buckets;
}

function now(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

// ========================= Op definitions =========================

// Pre-build the heavy, reusable fixtures ONCE (a real deployment builds the
// engine ctx per sweep from the live store, but the synthesis cost is not the
// thing under test — the sweep is. The audit chain is read once per request in
// the route; we reuse the same valid chain).
let ENGINE_CTX: EvaluationContext;
let AUDIT_CHAIN: AuditRowWithHashes[];

// Representative chat prompts that fan out to different tool sets in the mock
// router — mirrors the spread of what officers type.
const CHAT_PROMPTS = [
  "run a mining mismatch audit",
  "pull up TPS-1102-44",
  "list overdue accounts",
  "what's the recovery position?",
  "find Pilbara Iron",
  "today's briefing",
];
let chatCursor = 0;

function makeOps(): {
  chat: Op;
  properties: Op;
  sweep_demo: Op;
  sweep_engine: Op;
  verify_chain: Op;
  ready: Op;
  health: Op;
} {
  return {
    chat: {
      name: "chat",
      run: async () => {
        const prompt = CHAT_PROMPTS[chatCursor++ % CHAT_PROMPTS.length]!;
        const r = await runChat([], prompt, undefined, SCOPE);
        if (!r.content) throw new Error("empty chat content");
      },
    },
    properties: {
      name: "properties",
      run: async () => {
        const r = await runTool("list_properties", { limit: 50 }, undefined, undefined, SCOPE);
        if (!r.ok) throw new Error(`properties ${r.code}`);
      },
    },
    sweep_demo: {
      name: "sweep_demo",
      run: async () => {
        const r = await runTool(
          "find_mining_mismatches",
          { minSeverity: "low" },
          undefined,
          undefined,
          SCOPE,
        );
        if (!r.ok) throw new Error(`sweep_demo ${r.code}`);
      },
    },
    sweep_engine: {
      name: "sweep_engine",
      run: async () => {
        // Pure CPU sweep over council-scale data. Yield to the event loop
        // afterwards so the closed-loop scheduler stays fair under contention.
        const res = findMismatches(ENGINE_CTX);
        if (res.length < 0) throw new Error("impossible");
        await Promise.resolve();
      },
    },
    verify_chain: {
      name: "verify_chain",
      run: async () => {
        const verdict = verifyChain(AUDIT_CHAIN);
        if (!verdict.ok) throw new Error(`chain broke at ${verdict.firstBreakIndex}`);
        await Promise.resolve();
      },
    },
    ready: {
      name: "ready",
      run: async () => {
        const tools = await listMcpTools();
        if (tools.length === 0) throw new Error("no tools catalogued");
      },
    },
    health: {
      name: "health",
      run: async () => {
        // Mirror the fixed-200 handler body — a JSON build, no deps.
        const body = JSON.stringify({ ok: true, name: "ratesassist-web", ts: new Date().toISOString() });
        if (body.length === 0) throw new Error("empty");
        await Promise.resolve();
      },
    },
  };
}

// ========================= Reporting =========================

function fmt(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

function verdictFor(name: string, r: Result): { pass: boolean; reason: string } {
  const slo = SLO[name];
  const availability = r.count + r.errors > 0 ? r.count / (r.count + r.errors) : 1;
  if (!slo) {
    // sweep_demo / sweep_engine: judge against the sweep budget + chat avail.
    const pass = r.p99 < SWEEP_BUDGET_MS && availability >= 0.99;
    return {
      pass,
      reason: `p99 ${fmt(r.p99)}ms vs ${SWEEP_BUDGET_MS}ms budget · avail ${(availability * 100).toFixed(2)}%`,
    };
  }
  const latPass = r.p99 < slo.p99Ms;
  const availPass = availability >= slo.availability;
  return {
    pass: latPass && availPass,
    reason: `p99 ${fmt(r.p99)}ms vs <${slo.p99Ms}ms [${latPass ? "PASS" : "FAIL"}] · avail ${(availability * 100).toFixed(3)}% vs ≥${(slo.availability * 100).toFixed(2)}% [${availPass ? "PASS" : "FAIL"}]`,
  };
}

function printTable(title: string, results: readonly Result[]): void {
  // eslint-disable-next-line no-console
  console.log(`\n## ${title}\n`);
  const header =
    "path".padEnd(14) +
    "n".padStart(7) +
    "err".padStart(5) +
    "p50".padStart(10) +
    "p95".padStart(10) +
    "p99".padStart(10) +
    "max".padStart(10) +
    "thru/s".padStart(10) +
    "  verdict";
  // eslint-disable-next-line no-console
  console.log(header);
  // eslint-disable-next-line no-console
  console.log("-".repeat(header.length + 24));
  for (const r of results) {
    const v = verdictFor(r.name, r);
    // eslint-disable-next-line no-console
    console.log(
      r.name.padEnd(14) +
        String(r.count).padStart(7) +
        String(r.errors).padStart(5) +
        `${fmt(r.p50)}ms`.padStart(10) +
        `${fmt(r.p95)}ms`.padStart(10) +
        `${fmt(r.p99)}ms`.padStart(10) +
        `${fmt(r.max)}ms`.padStart(10) +
        fmt(r.throughput).padStart(10) +
        `  ${v.pass ? "PASS" : "FAIL"}  ${v.reason}`,
    );
  }
}

// ========================= Main =========================

async function main(): Promise<void> {
  /* eslint-disable no-console */
  console.log("RatesAssist — concurrent load harness");
  console.log(
    `transport=inproc  llm=mock  peak=${PEAK} in-flight  window=${DURATION_MS}ms  warmup=${WARMUP_MS}ms  sweep_parcels=${SWEEP_PARCELS}`,
  );
  console.log(`node=${process.version}  platform=${process.platform} ${process.arch}`);

  console.log("\nBuilding fixtures (council-scale engine ctx + 1,000-row audit chain)…");
  const tBuild = process.hrtime.bigint();
  ENGINE_CTX = buildEngineCtx(SWEEP_PARCELS);
  AUDIT_CHAIN = buildAuditChain(SCOPE.tenantId, 1_000);
  // Prime the inproc transport + catalogue so first-call import cost doesn't
  // pollute warmup of every scenario.
  await listMcpTools();
  await runTool("list_properties", { limit: 1 }, undefined, undefined, SCOPE);
  console.log(
    `  ready in ${(Number(process.hrtime.bigint() - tBuild) / 1e6).toFixed(0)}ms  · engine_ctx=${ENGINE_CTX.properties.length} parcels · audit_chain=${AUDIT_CHAIN.length} rows`,
  );

  const ops = makeOps();
  const allResults: Result[] = [];

  // ---- Scenario 1: MIXED at peak ----
  // Realistic pilot traffic mix. Reads dominate; sweeps + verify are rarer but
  // heavy. Weighting via repetition in the pool (round-robined by the driver).
  const mixedPool: Op[] = [
    ops.health,
    ops.properties,
    ops.properties,
    ops.properties,
    ops.chat,
    ops.chat,
    ops.ready,
    ops.sweep_demo,
    ops.verify_chain,
    ops.sweep_engine,
  ];
  console.log(`\n[1/3] MIXED workload @ ${PEAK} concurrent …`);
  const mixedBuckets = await drive(mixedPool, PEAK, DURATION_MS, WARMUP_MS);
  const mixedResults: Result[] = [];
  for (const [name, b] of mixedBuckets) {
    mixedResults.push(summarise(name, b.samples, b.errors, DURATION_MS));
  }
  mixedResults.sort((a, b) => a.name.localeCompare(b.name));
  printTable(`Scenario 1 — MIXED workload @ ${PEAK} concurrent`, mixedResults);

  // ---- Scenario 2: ISOLATED per path at peak ----
  console.log(`\n[2/3] ISOLATED per-path @ ${PEAK} concurrent …`);
  const isolated: Op[] = [
    ops.health,
    ops.ready,
    ops.properties,
    ops.chat,
    ops.sweep_demo,
    ops.verify_chain,
    ops.sweep_engine,
  ];
  const isolatedResults: Result[] = [];
  for (const op of isolated) {
    const buckets = await drive([op], PEAK, DURATION_MS, Math.min(WARMUP_MS, 400));
    const b = buckets.get(op.name)!;
    isolatedResults.push(summarise(op.name, b.samples, b.errors, DURATION_MS));
  }
  printTable(`Scenario 2 — ISOLATED per-path @ ${PEAK} concurrent`, isolatedResults);
  allResults.push(...isolatedResults);

  // ---- Scenario 3: OVERLOAD probe (10× burst) on the cheap read path ----
  // Proves headroom: drive /api/properties at 10× peak to find the cliff.
  const overloadConc = PEAK * 10;
  console.log(`\n[3/3] OVERLOAD probe — properties @ ${overloadConc} concurrent (10× peak) …`);
  const overloadBuckets = await drive([ops.properties], overloadConc, DURATION_MS, 400);
  const ob = overloadBuckets.get("properties")!;
  const overloadResult = summarise("properties", ob.samples, ob.errors, DURATION_MS);
  printTable(`Scenario 3 — OVERLOAD properties @ ${overloadConc} concurrent`, [overloadResult]);

  // ---- Overall verdict (judged on ISOLATED, the clean per-path distribution) ----
  console.log("\n## SLO verdict (judged on ISOLATED per-path distributions)\n");
  let allPass = true;
  for (const r of isolatedResults) {
    const v = verdictFor(r.name, r);
    if (!v.pass) allPass = false;
    const slo = SLO[r.name];
    const label = slo ? slo.label : `${r.name} (recovery sweep)`;
    console.log(`${v.pass ? "PASS" : "FAIL"}  ${label.padEnd(30)} ${v.reason}`);
  }
  console.log(`\nOVERALL: ${allPass ? "PASS — all measured paths within pilot SLO" : "FAIL — see paths above"}`);

  if (EMIT_JSON) {
    console.log("\n---JSON---");
    console.log(
      JSON.stringify(
        {
          config: { peak: PEAK, durationMs: DURATION_MS, warmupMs: WARMUP_MS, sweepParcels: SWEEP_PARCELS, node: process.version },
          mixed: mixedResults,
          isolated: isolatedResults,
          overload: overloadResult,
          allPass,
        },
        null,
        2,
      ),
    );
  }
  /* eslint-enable no-console */
}

function intEnv(name: string, dflt: number): number {
  const v = process.env[name];
  if (v === undefined) return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("load-harness failed:", e);
  process.exit(1);
});
