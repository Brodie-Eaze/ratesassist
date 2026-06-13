/**
 * /how-it-works — the comprehensive product explainer.
 *
 * The concise top-of-funnel teaser lives at /landing. THIS page is the deep
 * read: a council CFO, IT lead, or procurement officer who wants to understand
 * exactly what RatesAssist is, how it works, the full architecture, every
 * agent that plays a part, the end-to-end flow, and which positions in the
 * rates department it covers — before they take a meeting.
 *
 * Honesty constraints (deliberate — this is a customer-facing artefact):
 *  - Every figure is grounded in RatesAssist.md or the codebase. The
 *    "$30–50M/yr" anchor is the senior configurator's *manual* recovery
 *    baseline (Exec Summary §1), not a platform-recovered claim.
 *  - The detection signals, weights, RBAC roles, two-phase commit, audit
 *    hash-chain, and 33-tool chokepoint are read from the live source
 *    (packages/recovery-engine/src/signals.ts, packages/contract/src/auth.ts,
 *    apps/web/lib/tool-tenant-scope.ts).
 *  - We claim "designed to SOC 2 / Privacy Act", never "certified". MFA and
 *    durable-DB audit deploy are described as on the path, not shipped.
 *  - Scoring is deterministic; the LLM narrates and drafts — it never invents
 *    a balance, a classification, or a dollar figure. That distinction is the
 *    product's defensibility and is stated plainly.
 *
 * Australian English throughout (council, behaviour, organisation, recognised).
 * Server component — no client interactivity; anchor links + CSS scroll only.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { PublicLayout } from "@/components/PublicLayout";

export const metadata: Metadata = {
  title: "How RatesAssist works — system, architecture, agents & flow",
  description:
    "The full explainer: what RatesAssist is, how the recovery engine and tool-grounded assistant work, the multi-tenant architecture, every detection and reasoning agent, the end-to-end flow, and the council positions it covers.",
};

const CONTACT_EMAIL = "brodie@amalafinance.com.au";
const MAILTO = `mailto:${CONTACT_EMAIL}?subject=RatesAssist%20pilot%20enquiry`;

/* Shared keyboard-focus treatment (WCAG 2.4.7). The design system uses
 * hover-only states, which leave keyboard users without a visible focus
 * indicator — these append a consistent focus-visible ring. */
const FOCUS_BTN =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2";
const FOCUS_LINK =
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2";

/* ─────────────────────────  table of contents  ───────────────────────── */

const TOC: ReadonlyArray<{ id: string; label: string }> = [
  { id: "what-it-is", label: "What it is" },
  { id: "products", label: "The four products" },
  { id: "how-it-works", label: "How it works" },
  { id: "flow", label: "The flow, end to end" },
  { id: "architecture", label: "Architecture in detail" },
  { id: "agents", label: "The agents" },
  { id: "whats-involved", label: "What's involved" },
  { id: "positions", label: "Who it's for" },
  { id: "outcome", label: "The outcome" },
  { id: "trust", label: "Trust & compliance" },
];

const HERO_STATS: ReadonlyArray<{ figure: string; label: string }> = [
  {
    figure: "$30–50M",
    label:
      "in mis-classified rates identified manually each year by the senior configurator RatesAssist productises",
  },
  {
    figure: "5–10×",
    label:
      "target throughput multiplier on that expert recovery work once systematised — a modelled, pre-pilot design goal, not yet a measured result",
  },
  {
    figure: "30+",
    label:
      "deterministic detection signals across six evidence categories, cross-referencing authoritative state and federal registers",
  },
  {
    figure: "Up to 3 yrs",
    label:
      "of statutory arrears typically recoverable, to each state's backdating limit (confirmed per council)",
  },
];

const TRUST_BADGES: ReadonlyArray<string> = [
  "AU-hosted (Sydney region)",
  "Tool-grounded — no invented facts",
  "Hash-chained, verifiable audit log",
  "Privacy Act (APP) aligned",
  "Preview-then-confirm on every write",
];

/* ─────────────────────────  the four products  ───────────────────────── */

const PRODUCTS: ReadonlyArray<{
  name: string;
  tag: string;
  purpose: string;
  buyer: string;
  pricing: string;
  metric: string;
}> = [
  {
    name: "RatesAssist",
    tag: "Productivity layer",
    purpose:
      "A natural-language interface for rates officers, operating against live council data. Replaces screen-jumping with conversation — lookup, drafting, reconciliation. The foundation; everything else extends it.",
    buyer: "Director Corporate Services / CFO",
    pricing: "$99–249 per officer / month",
    metric: "Enquiry handling time (minutes per call)",
  },
  {
    name: "RatesRecovery",
    tag: "Anomaly + mismatch detection",
    purpose:
      "The headline revenue line. Cross-references council rating data against DMIRS tenements, Landgate cadastre, Nearmap imagery and ASIC ownership to surface mis-classified parcels, then ships a defensible evidence pack for each.",
    buyer: "CEO / GM / CFO",
    pricing: "10–15% success fee on net rates recovered, capped at 24 months",
    metric: "Recovered rates ($) per quarter",
  },
  {
    name: "RatesIntel",
    tag: "Executive reporting",
    purpose:
      "Manager and executive dashboards. Aggregates KPIs across the council and — with permission — anonymously across the peer group. Surfaces trend anomalies, forecasts collection, benchmarks against comparable councils.",
    buyer: "CFO / GM / elected councillors",
    pricing: "$20–60k per council / year",
    metric: "Time to produce a board report (hours → minutes)",
  },
  {
    name: "RatesChat",
    tag: "Citizen self-service",
    purpose:
      "Public-facing chat embedded in the council website. Authenticated ratepayers handle balance enquiries, direct-debit setup, rebate applications, certificate requests and dispute lodgement without staff involvement.",
    buyer: "Director Customer Service / CIO",
    pricing: "$15–40k per council / year + per-conversation pass-through",
    metric: "Call deflection rate (%)",
  },
];

/* ─────────────────────────  the three principles  ───────────────────────── */

const PRINCIPLES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Tool-grounded",
    body:
      "The assistant never asserts a balance, owner or classification it did not retrieve through a tool call in the current conversation — and every fact it returns carries the tool-call ID it came from. No retrieval, no claim.",
  },
  {
    title: "Deterministic scoring",
    body:
      "Recovery confidence is a weighted-additive sum of explainable rule-based signals — not an LLM guess. The same inputs always produce the same score. The model narrates the result; it never generates the numbers.",
  },
  {
    title: "Preview-then-confirm",
    body:
      "Every write returns a structured proposal first. A human reads it and explicitly confirms before anything commits — a two-phase token gate. No silent state changes, ever.",
  },
];

/* ─────────────────────────  the recovery flow  ───────────────────────── */

const RECOVERY_FLOW: ReadonlyArray<{ step: string; title: string; body: string }> = [
  {
    step: "1",
    title: "Ingest",
    body:
      "Scheduled workers are designed to refresh each authoritative register on its own cadence — DMIRS mining tenements, Landgate cadastre, Nearmap change-detection, ABN/ASIC entity data. In pilot these run against the public registers (DMIRS, Landgate/SLIP, the ABN register); the council supplies one thing — its TechOne rating-roll export.",
  },
  {
    step: "2",
    title: "Cross-reference",
    body:
      "The detection engine joins each rated parcel's classification against every external register, parcel by parcel — the join no single council system can perform on its own.",
  },
  {
    step: "3",
    title: "Score",
    body:
      "Each firing signal contributes its weight to a composite confidence. Mutually-exclusive groups are de-duplicated and the total is capped at 100%. Deterministic, repeatable, fully explainable.",
  },
  {
    step: "4",
    title: "Rank",
    body:
      "Candidates are ordered by confidence × estimated uplift. The cadastre-lag window — a producing lease sitting on a parcel still rated rural — is surfaced first as the highest-confidence opportunity available before any audit cycle.",
  },
  {
    step: "5",
    title: "Assemble evidence",
    body:
      "Per candidate: property identification, current vs proposed classification with the specific Act and section, authoritative external evidence, estimated annual uplift, arrears within the statutory limit, and draft reclassification + objection-rights notices. Claude assembles the prose under a strict schema; deterministic post-processing validates every required field and dollar calculation.",
  },
  {
    step: "6",
    title: "Officer review",
    body:
      "The officer — and, where needed, the council's legal team — scrutinise the pack. Nothing is sent or changed without an explicit human confirmation.",
  },
  {
    step: "7",
    title: "Reclassify & recover",
    body:
      "The council issues the reclassification notice. The outcome and the recovered dollars are tracked. The success fee applies only to what is actually collected.",
  },
];

const CHAT_LOOP: ReadonlyArray<{ actor: string; body: string }> = [
  { actor: "Officer", body: "asks a question in plain English — \"who owns 14 Mine Road and what's owing?\"" },
  { actor: "Claude", body: "selects the right tool from the catalogue and proposes the call" },
  { actor: "Chokepoint", body: "validates RBAC + tenant scope before anything runs — fails closed on anything unrecognised" },
  { actor: "Tool", body: "executes against the council's own data only, returning a structured result" },
  { actor: "Claude", body: "narrates the answer with a citation back to the tool call" },
  { actor: "Write?", body: "if the officer asks to change something, it returns a preview to confirm — never a silent commit" },
  { actor: "Audit", body: "every read and write appends a tamper-evident entry to the hash chain" },
];

/* ─────────────────────────  architecture layers  ───────────────────────── */

const ARCH_LAYERS: ReadonlyArray<{
  layer: string;
  detail: string;
  items: ReadonlyArray<string>;
}> = [
  {
    layer: "Presentation",
    detail: "Next.js web app, AU-hosted",
    items: [
      "Officer chat",
      "Property explorer (forms, maps, document gallery)",
      "Evidence-pack viewer + editor",
      "RatesIntel dashboards",
      "Admin (tenants, users, audit)",
      "Citizen chat — separate route & brand",
    ],
  },
  {
    layer: "Orchestration",
    detail: "Node / TypeScript backend",
    items: [
      "REST API (sessions, users, billing, audit)",
      "LLM orchestration — Claude API (AU region where available)",
      "MCP tool host — connects per-council tools",
      "Tenant config + policy engine",
      "Append-only audit-log writer",
    ],
  },
  {
    layer: "Intelligence",
    detail: "Deterministic engine + Claude models",
    items: [
      "Recovery engine: signals → scoring → uplift → evidence pack",
      "Claude Sonnet — default chat",
      "Claude Opus — complex reasoning, evidence packs",
      "Claude Haiku — fast lookup, triage, citizen chat",
    ],
  },
  {
    layer: "Data",
    detail: "Postgres + object storage, AU region only",
    items: [
      "Tenant config, user accounts",
      "Append-only audit log (7-yr retention — Phase 2)",
      "Calibration + cross-council benchmarks",
      "Row-level isolation keyed on tenant_id",
      "Per-tenant credentials in Secrets Manager — never logged",
    ],
  },
  {
    layer: "Integrations",
    detail: "Systems of record + authoritative registers",
    items: [
      "TechOne CiAnywhere (OAuth) — system of record",
      "DMIRS / Landgate — mining & cadastre (public)",
      "Nearmap — aerial change detection",
      "ABN Lookup / ASIC — entity verification",
      "SMS / email gateways · council EDRMS",
    ],
  },
];

const ARCH_PILLARS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Multi-tenant isolation",
    body:
      "Tenant = council. A single REST + chat chokepoint (applyToolScope) wraps all 33 catalogue tools: it is a compile-time-exhaustive policy table, so a new tool cannot ship without a scope decision. Every call is RBAC-gated and tenant-scoped; cross-tenant reads are masked as not-found so the surface can never be an enumeration oracle. An owner who holds property across councils has their contact details redacted across tenants, and cross-council edits are refused.",
  },
  {
    title: "Authentication & authorisation",
    body:
      "Authorisation is enforced in code today: five roles — ratepayer, rates_officer, rates_supervisor, council_admin, platform_admin — map to seven granular permissions on every tool call, and sessions are signed with HMAC-SHA256. Officer sign-in is designed for Microsoft Entra SSO via WorkOS, which activates once a council provisions its SSO secrets (Phase 4); application-level MFA ships on that same path and is not yet claimed as live.",
  },
  {
    title: "Audit & evidence",
    body:
      "Every read and write produces an append-only audit entry, hash-chained (each row's prevHash links to its predecessor's rowHash) so tampering is detectable, with a verify endpoint that recomputes the chain on demand — in place today. It is designed for seven-year retention on a durable store (on the production path), and the chain is deliberately erasure-exempt — which is exactly why personal information is projected to change-shape, never written in raw.",
  },
  {
    title: "Data residency",
    body:
      "Council-supplied data is hosted in Australia — the Sydney region today, with AWS ap-southeast-2 on the production path. The language model is Anthropic Claude, accessed in an AU region where available (cross-border inference is disclosed to every council); no third-party LLMs are used. Every architectural decision is taken as if a state Auditor-General were reviewing it next week.",
  },
];

/* ─────────────────────────  the agents (3 tiers)  ───────────────────────── */

const DETECTION_CATEGORIES: ReadonlyArray<{
  name: string;
  reads: string;
  signals: ReadonlyArray<{ label: string; weight: string }>;
}> = [
  {
    name: "Register",
    reads: "DMIRS tenements · Landgate cadastre · titles · planning",
    signals: [
      { label: "Producing tenement on rural/vacant", weight: "0.55" },
      { label: "Strata parent title", weight: "0.55" },
      { label: "Cadastre lag (DMIRS ahead of Landgate)", weight: "0.50" },
      { label: "Live lease on rural/vacant", weight: "0.45" },
      { label: "Subdivision ahead of titles", weight: "0.45" },
      { label: "Recently-granted tenement", weight: "0.40" },
    ],
  },
  {
    name: "Identity",
    reads: "ABN Lookup (ATO) · ASIC",
    signals: [
      { label: "Proprietor mismatch", weight: "0.40" },
      { label: "ABN cancelled", weight: "0.30" },
      { label: "Tenement holder ≠ rated owner", weight: "0.30" },
    ],
  },
  {
    name: "Aerial",
    reads: "Nearmap change detection",
    signals: [
      { label: "Construction complete", weight: "0.40" },
      { label: "Commercial use change", weight: "0.35" },
      { label: "Aerial change since valuation", weight: "0.30" },
      { label: "Renovation", weight: "0.20" },
    ],
  },
  {
    name: "Register (planning)",
    reads: "DA registers · environmental approvals · VG feeds",
    signals: [
      { label: "Certificate of title changed", weight: "0.35" },
      { label: "Development approval granted", weight: "0.30" },
      { label: "Environmental approval active", weight: "0.30" },
      { label: "Stale GRV valuation", weight: "0.15" },
    ],
  },
  {
    name: "Corporate / Behavioural",
    reads: "Entity name heuristics · portfolio patterns",
    signals: [
      { label: "Industry-indicative entity name", weight: "0.20" },
      { label: "Known mining portfolio holder", weight: "0.20" },
    ],
  },
  {
    name: "Spatial",
    reads: "Cadastral geometry · area",
    signals: [{ label: "High-value rural parcel", weight: "0.15" }],
  },
];

const REASONING_AGENTS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Chat orchestrator",
    body:
      "Interprets the officer's request, selects the correct tool, and narrates the grounded result with citations. Claude Sonnet by default; never scores, never invents a fact.",
  },
  {
    title: "Evidence-pack assembler",
    body:
      "Turns a scored candidate into the council-ready document — current vs proposed classification, statutory basis, draft notices — as structured output, then hands it to deterministic validation. Claude Opus for the long-context reasoning.",
  },
  {
    title: "Communications drafter",
    body:
      "Drafts payment reminders (friendly / firm / final), triages inbound enquiry email, and prepares batch chase previews — always returned for human review before sending.",
  },
  {
    title: "Citizen self-service",
    body:
      "Handles authenticated ratepayer enquiries on RatesChat — balance, direct debit, rebates, certificates — on Haiku for cost, escalating to Sonnet and then to a human officer with full transcript.",
  },
];

const GUARDIAN_AGENTS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Tenant + RBAC chokepoint",
    body:
      "The single policy layer (applyToolScope) every chat tool call passes through. Force-injects the caller's council into reads, refuses cross-tenant identifiers, and fails closed on any unknown tool.",
  },
  {
    title: "Two-phase commit gate",
    body:
      "Mutations return a preview and a commit token. A rates_officer can draft; a rates_supervisor commits — separation of duties enforced server-side, not trusted to the model.",
  },
  {
    title: "Audit-chain writer + verifier",
    body:
      "Appends the hash-chained entry for every read and write, and exposes a verifier that recomputes the whole chain to prove no row was altered or removed.",
  },
  {
    title: "Ingestion & refresh workers",
    body:
      "The scheduled jobs that keep DMIRS, Landgate, Nearmap and ABN/ASIC current — the freshness the detection engine depends on.",
  },
  {
    title: "PII redaction transforms",
    body:
      "Post-dispatch transforms and recursive scrubbing strip contact details from shared-owner results and keep personal information out of logs, traces and the immutable chain.",
  },
];

/* ─────────────────────────  what's involved  ───────────────────────── */

const INTEGRATIONS: ReadonlyArray<{ category: string; systems: string }> = [
  { category: "System of record", systems: "TechnologyOne CiAnywhere (OneCouncil) · Civica Authority" },
  { category: "Mining / land use", systems: "DMIRS MINEDEX / GeoVIEW.WA · MinView (NSW) · GeoVic (Vic)" },
  { category: "Cadastral / spatial", systems: "Landgate SLIP · NSW Spatial Services · Vicmap · Geoscape G-NAF" },
  { category: "Aerial imagery", systems: "Nearmap · Metromap · Geoscape Buildings & Surfaces" },
  { category: "Identity / entity", systems: "ABN Lookup (ATO) · ASIC Connect · PEXA transfer notices" },
  { category: "Communications", systems: "Twilio · MessageMedia · SendGrid / SES · council Microsoft 365" },
  { category: "Identity & access", systems: "Microsoft Entra SSO via WorkOS · MyGovID (citizen)" },
];

const COUNCIL_PROVIDES: ReadonlyArray<string> = [
  "A rating-roll export from TechOne (or read access where available)",
  "Microsoft Entra SSO for officer sign-in",
  "An executive sponsor and one rates contact for calibration",
];

/* ─────────────────────────  positions / RBAC  ───────────────────────── */

const POSITIONS: ReadonlyArray<{
  position: string;
  role: string;
  gets: string;
}> = [
  {
    position: "Frontline Rates Officer",
    role: "rates_officer",
    gets: "Conversational lookup, drafted comms, fewer screens. Reads council data and drafts mutations — but cannot commit them.",
  },
  {
    position: "Senior Rates Officer",
    role: "rates_officer → rates_supervisor",
    gets: "Complex cases, statutory certificates, hardship. Generates evidence packs and, as supervisor, commits approved changes.",
  },
  {
    position: "Rates Coordinator / Team Lead",
    role: "rates_supervisor",
    gets: "Approves and commits two-phase mutations, runs daily briefings and exception lists, and reads the audit log.",
  },
  {
    position: "Revenue / Finance Manager",
    role: "rates_supervisor → council_admin",
    gets: "RatesIntel dashboards — collection rate, arrears aging, cash forecast — plus audit-log visibility.",
  },
  {
    position: "Director Corporate Services / CFO",
    role: "council_admin",
    gets: "User management for the council, recovery ROI proof, and cross-council benchmarking.",
  },
  {
    position: "GM / CEO",
    role: "council_admin",
    gets: "The recovery success summary and peer comparison — the board-facing view.",
  },
  {
    position: "Ratepayer (citizen)",
    role: "ratepayer",
    gets: "RatesChat self-service against their own property only — public data, no council-internal access.",
  },
  {
    position: "External auditor",
    role: "read-only export",
    gets: "Tamper-evident audit-trail exports for statutory audit (Audit Office of WA / NSW Audit Office / equivalent).",
  },
];

/* ─────────────────────────  outcomes  ───────────────────────── */

const OUTCOMES: ReadonlyArray<{ product: string; outcome: string }> = [
  { product: "RatesAssist", outcome: "Designed to cut repetitive-workflow admin time materially — the saving is quantified per council during the pilot." },
  { product: "RatesRecovery", outcome: "Systematic recovery of under-collected rates, with a defensible evidence pack for every candidate." },
  { product: "RatesIntel", outcome: "Board reports in minutes instead of hours; anomalies surfaced before the auditor sees them." },
  { product: "RatesChat", outcome: "Built to deflect a substantial share of routine rates calls (target 30–50%, validated in deployment)." },
];

/* ─────────────────────────  small presentational helpers  ───────────────────────── */

function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <div id={id} className="scroll-mt-24">
      <p className="text-xs uppercase tracking-widest text-accent-600">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900 md:text-3xl">
        {title}
      </h2>
    </div>
  );
}

/* ─────────────────────────  page  ───────────────────────── */

export default function HowItWorksPage() {
  return (
    <PublicLayout>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="border-b border-ink-100 bg-gradient-to-b from-white to-ink-50">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <p className="text-xs uppercase tracking-widest text-accent-600">
            AI-native rates administration & revenue recovery
          </p>
          <h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-tight md:text-5xl">
            The intelligence layer for Australian council rates departments
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-ink-700">
            RatesAssist overlays the systems councils already run — TechnologyOne
            CiAnywhere, Civica Authority — and a curated set of authoritative
            registers to cut officer admin time and systematically recover
            under-collected rate revenue. One backbone, four products, built for
            the public sector from day one.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HERO_STATS.map((s) => (
              <div
                key={s.figure}
                className="rounded-2xl border border-ink-100 bg-white p-5 shadow-sm"
              >
                <p className="text-3xl font-semibold text-accent-700">{s.figure}</p>
                <p className="mt-2 text-sm text-ink-600">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {TRUST_BADGES.map((b) => (
              <span
                key={b}
                className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs text-ink-700"
              >
                {b}
              </span>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <a
              href={MAILTO}
              className={`inline-flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-3 text-white shadow-sm hover:bg-accent-700 ${FOCUS_BTN}`}
            >
              Talk to us about a pilot <span aria-hidden="true">→</span>
            </a>
            <a
              href="#what-it-is"
              className={`inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-5 py-3 text-ink-800 hover:bg-ink-50 ${FOCUS_BTN}`}
            >
              Read how it works <span aria-hidden="true">↓</span>
            </a>
          </div>
          <p className="mt-6 max-w-2xl text-xs text-ink-500">
            The $30–50M figure is the manual recovery baseline of the senior
            rates configurator the platform is built around — the expertise
            RatesAssist productises and multiplies, not a platform-recovered
            total.
          </p>
        </div>
      </section>

      {/* ── Body: sticky TOC + content ───────────────────────── */}
      <div className="mx-auto max-w-6xl px-6">
        <div className="gap-12 py-16 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
          {/* TOC */}
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-8">
              <p className="text-xs uppercase tracking-widest text-ink-500">
                On this page
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {TOC.map((t) => (
                  <li key={t.id}>
                    <a
                      href={`#${t.id}`}
                      className={`text-ink-600 hover:text-accent-700 ${FOCUS_LINK}`}
                    >
                      {t.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          {/* Content */}
          <div className="space-y-20">
            {/* §1 What it is */}
            <section className="space-y-6">
              <SectionHeading id="what-it-is" eyebrow="The system" title="What RatesAssist is" />
              <p className="text-ink-700">
                RatesAssist is an AI-native software platform for Australian
                council rates departments. It sits on top of the council's
                existing system of record and stitches it together with
                authoritative external datasets — DMIRS mining tenements,
                Landgate cadastre, Nearmap aerial imagery, ASIC and the ATO ABN
                Lookup — to produce intelligence no single council platform can
                deliver on its own.
              </p>
              <p className="text-ink-700">
                It does two jobs. It makes the officer's day faster — turning
                screen-jumping into a conversation grounded in live data. And it
                finds money the council is owed — systematically detecting
                mis-classified parcels and packaging each into a defensible
                recovery case. The reason a council can trust both is the same:
                the numbers are produced by deterministic, explainable rules, and
                the AI only ever narrates what a tool actually returned.
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                {PRINCIPLES.map((p) => (
                  <div
                    key={p.title}
                    className="rounded-xl border border-ink-100 bg-white p-5 shadow-sm"
                  >
                    <h3 className="font-semibold text-ink-900">{p.title}</h3>
                    <p className="mt-2 text-sm text-ink-700">{p.body}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* §2 Products */}
            <section className="space-y-6">
              <SectionHeading id="products" eyebrow="One backbone" title="The four products" />
              <p className="text-ink-700">
                These are not independent SKUs. They share an MCP tool backbone,
                a multi-tenant data layer, and a single compliance posture. A
                council typically starts with whichever resonates with the buyer,
                then expands within twelve months.
              </p>
              <div className="grid gap-5 md:grid-cols-2">
                {PRODUCTS.map((p) => (
                  <article
                    key={p.name}
                    className="flex flex-col rounded-xl border border-ink-100 bg-white p-6 shadow-sm"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-lg font-semibold">
                        <span className="text-ink-900">Rates</span>
                        <span className="text-accent-600">{p.name.replace("Rates", "")}</span>
                      </h3>
                      <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-[11px] uppercase tracking-wide text-ink-600">
                        {p.tag}
                      </span>
                    </div>
                    <p className="mt-3 flex-1 text-sm text-ink-700">{p.purpose}</p>
                    <dl className="mt-4 space-y-1 border-t border-ink-100 pt-4 text-xs text-ink-600">
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-500">Buyer</dt>
                        <dd className="text-right text-ink-800">{p.buyer}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-500">Pricing</dt>
                        <dd className="text-right text-ink-800">{p.pricing}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-500">Anchor metric</dt>
                        <dd className="text-right text-ink-800">{p.metric}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </section>

            {/* §3 How it works */}
            <section className="space-y-6">
              <SectionHeading id="how-it-works" eyebrow="The model" title="How it works" />
              <p className="text-ink-700">
                Two engines run on one backbone. The{" "}
                <strong className="font-semibold text-ink-900">recovery engine</strong>{" "}
                is deterministic: it joins the council's rating roll against the
                authoritative registers and scores each mismatch with explainable,
                weighted rules. The{" "}
                <strong className="font-semibold text-ink-900">assistant</strong>{" "}
                is a tool-grounded Claude layer: it interprets an officer's plain
                language, calls the right tool, and narrates the result — bounded
                by the three principles above.
              </p>
              <div className="rounded-xl border border-accent-100 bg-accent-50 p-6">
                <p className="text-sm text-ink-800">
                  The distinction matters for defensibility. A reclassification
                  has to stand up at the State Administrative Tribunal. So the
                  evidence — the classification, the statutory basis, the dollar
                  figures — is computed deterministically and validated by code.
                  The language model assembles the prose around it and never
                  authors the facts.
                </p>
              </div>
            </section>

            {/* §4 The flow */}
            <section className="space-y-6">
              <SectionHeading id="flow" eyebrow="End to end" title="The flow" />
              <p className="text-ink-700">
                Two flows matter: how a recovery candidate is found and proven,
                and how an officer gets an answer day-to-day.
              </p>

              <h3 className="text-lg font-semibold text-ink-900">
                A · The recovery flow
              </h3>
              <ol className="space-y-3">
                {RECOVERY_FLOW.map((s) => (
                  <li
                    key={s.step}
                    className="flex gap-4 rounded-xl border border-ink-100 bg-white p-5 shadow-sm"
                  >
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent-600 text-sm font-semibold text-white">
                      {s.step}
                    </span>
                    <div>
                      <h4 className="font-semibold text-ink-900">{s.title}</h4>
                      <p className="mt-1 text-sm text-ink-700">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <h3 className="pt-4 text-lg font-semibold text-ink-900">
                B · The officer chat loop
              </h3>
              <ol className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm">
                {CHAT_LOOP.map((c, i) => (
                  <li
                    key={`${i}-${c.actor}`}
                    className={`flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:gap-4 ${
                      i === 0 ? "" : "border-t border-ink-100"
                    }`}
                  >
                    <span className="flex w-28 flex-none items-baseline gap-2 text-sm font-semibold text-accent-700">
                      <span aria-hidden="true" className="text-ink-500">
                        {i + 1}
                      </span>
                      {c.actor}
                    </span>
                    <span className="text-sm text-ink-700">{c.body}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* §5 Architecture */}
            <section className="space-y-6">
              <SectionHeading id="architecture" eyebrow="In detail" title="The architecture" />
              <p className="text-ink-700">
                Five layers, every one AU-hosted. Requests flow top to bottom;
                the data layer never talks to the outside world directly, and
                the integration credentials never leave Secrets Manager.
              </p>
              <div className="space-y-3">
                {ARCH_LAYERS.map((l, i) => (
                  <div
                    key={l.layer}
                    className="rounded-xl border border-ink-100 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-semibold text-ink-900">
                        <span aria-hidden="true" className="mr-2 text-ink-500">
                          {i + 1}.
                        </span>
                        {l.layer}
                      </h3>
                      <span className="text-xs text-ink-500">{l.detail}</span>
                    </div>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {l.items.map((it) => (
                        <li
                          key={it}
                          className="rounded-md bg-ink-50 px-2.5 py-1 text-xs text-ink-700"
                        >
                          {it}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {ARCH_PILLARS.map((p) => (
                  <div
                    key={p.title}
                    className="rounded-xl border border-ink-100 bg-white p-5 shadow-sm"
                  >
                    <h3 className="font-semibold text-ink-900">{p.title}</h3>
                    <p className="mt-2 text-sm text-ink-700">{p.body}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* §6 Agents */}
            <section className="space-y-6">
              <SectionHeading id="agents" eyebrow="What does the work" title="The agents" />
              <p className="text-ink-700">
                It helps to be precise about what is doing the work, because the
                honesty is the product. RatesAssist runs three tiers of agent:
                deterministic detectors that find the money, reasoning agents
                that explain and draft, and guardian agents that keep it safe.
              </p>

              {/* Tier 1 — detection */}
              <div>
                <h3 className="text-lg font-semibold text-ink-900">
                  1 · Detection agents{" "}
                  <span className="font-normal text-ink-500">(deterministic)</span>
                </h3>
                <p className="mt-2 text-sm text-ink-700">
                  More than thirty weighted signals across six evidence
                  categories — a representative selection is shown below, grouped
                  by evidence type. Each one reads an authoritative register,
                  fires on an explainable condition, and contributes a fixed
                  weight to the composite confidence score. No machine-learning
                  black box, no LLM — the same inputs always produce the same
                  result, which is what makes a recovery defensible.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {DETECTION_CATEGORIES.map((c) => (
                    <div
                      key={c.name}
                      className="rounded-xl border border-ink-100 bg-white p-5 shadow-sm"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <h4 className="font-semibold text-ink-900">{c.name}</h4>
                      </div>
                      <p className="mt-1 text-xs text-ink-500">Reads: {c.reads}</p>
                      <ul className="mt-3 space-y-1.5">
                        {c.signals.map((s) => (
                          <li
                            key={s.label}
                            className="flex items-center justify-between gap-3 text-sm"
                          >
                            <span className="text-ink-700">{s.label}</span>
                            <span className="flex-none rounded bg-accent-50 px-1.5 py-0.5 font-mono text-xs text-accent-700">
                              {s.weight}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tier 2 — reasoning */}
              <div>
                <h3 className="text-lg font-semibold text-ink-900">
                  2 · Reasoning agents{" "}
                  <span className="font-normal text-ink-500">(Claude)</span>
                </h3>
                <p className="mt-2 text-sm text-ink-700">
                  Language models do the language work — interpreting, narrating,
                  drafting, assembling. They are tool-grounded and citation-bound,
                  and they never produce a score or a dollar figure.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {REASONING_AGENTS.map((a) => (
                    <div
                      key={a.title}
                      className="rounded-xl border border-ink-100 bg-white p-5 shadow-sm"
                    >
                      <h4 className="font-semibold text-ink-900">{a.title}</h4>
                      <p className="mt-2 text-sm text-ink-700">{a.body}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tier 3 — guardian */}
              <div>
                <h3 className="text-lg font-semibold text-ink-900">
                  3 · Guardian agents{" "}
                  <span className="font-normal text-ink-500">(always-on controls)</span>
                </h3>
                <p className="mt-2 text-sm text-ink-700">
                  The components that make the other two tiers safe to run against
                  real council data. They are not optional and they cannot be
                  bypassed from the chat surface.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {GUARDIAN_AGENTS.map((a) => (
                    <div
                      key={a.title}
                      className="rounded-xl border border-ink-100 bg-white p-5 shadow-sm"
                    >
                      <h4 className="font-semibold text-ink-900">{a.title}</h4>
                      <p className="mt-2 text-sm text-ink-700">{a.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* §7 What's involved */}
            <section className="space-y-6">
              <SectionHeading id="whats-involved" eyebrow="To get started" title="What's involved" />
              <p className="text-ink-700">
                The platform connects to the systems and registers below. The
                council's lift to start a pilot is deliberately small.
              </p>
              <dl className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm">
                {INTEGRATIONS.map((row, i) => (
                  <div
                    key={row.category}
                    className={`flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:gap-4 ${
                      i === 0 ? "" : "border-t border-ink-100"
                    }`}
                  >
                    <dt className="w-44 flex-none text-sm font-semibold text-ink-900">
                      {row.category}
                    </dt>
                    <dd className="text-sm text-ink-700">{row.systems}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-ink-500">
                In a pilot, the live connections are the public registers — DMIRS,
                Landgate / SLIP and the ABN register — plus the council's own
                TechOne rating-roll export. Write-back to TechOne, Civica
                Authority, Nearmap, PEXA and citizen MyGovID are staged for later
                phases and disclosed up front.
              </p>
              <div className="rounded-xl border border-ink-100 bg-ink-50 p-6">
                <h3 className="font-semibold text-ink-900">
                  What the council provides
                </h3>
                <ul className="mt-3 space-y-2">
                  {COUNCIL_PROVIDES.map((c) => (
                    <li key={c} className="flex gap-2 text-sm text-ink-700">
                      <span aria-hidden="true" className="text-accent-600">
                        ✓
                      </span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm text-ink-600">
                  Everything else — the mining, cadastral, imagery and entity
                  data — RatesAssist brings. The recovery tier carries no upfront
                  cost; you see the candidates before any commitment.
                </p>
              </div>
            </section>

            {/* §8 Positions */}
            <section className="space-y-6">
              <SectionHeading id="positions" eyebrow="Who it's for" title="The positions it covers" />
              <p className="text-ink-700">
                Access maps to five roles in a permission matrix, and those roles
                map to the real positions in a rates department. The two-phase
                commit means drafting and committing are separated — an officer
                proposes, a supervisor approves — so separation of duties is
                built in, not bolted on.
              </p>
              <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white shadow-sm">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">
                    Department positions mapped to their platform role and what
                    each role can access
                  </caption>
                  <thead>
                    <tr className="border-b border-ink-100 bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                      <th scope="col" className="px-4 py-3 font-medium">
                        Department position
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Platform role
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        What they get
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {POSITIONS.map((p) => (
                      <tr key={p.position} className="border-b border-ink-100 last:border-0">
                        <th
                          scope="row"
                          className="px-4 py-3 text-left font-medium text-ink-900"
                        >
                          {p.position}
                        </th>
                        <td className="px-4 py-3">
                          <span className="rounded bg-ink-100 px-2 py-0.5 font-mono text-xs text-ink-700">
                            {p.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-ink-700">{p.gets}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* §9 Outcome */}
            <section className="space-y-6">
              <SectionHeading id="outcome" eyebrow="The point" title="The outcome" />
              <div className="grid gap-4 md:grid-cols-2">
                {OUTCOMES.map((o) => (
                  <div
                    key={o.product}
                    className="rounded-xl border border-ink-100 bg-white p-5 shadow-sm"
                  >
                    <h3 className="font-semibold text-accent-700">{o.product}</h3>
                    <p className="mt-2 text-sm text-ink-700">{o.outcome}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-accent-100 bg-accent-50 p-6">
                <h3 className="font-semibold text-ink-900">
                  The recovery economics
                </h3>
                <p className="mt-2 text-sm text-ink-800">
                  Where a parcel has been mis-classified, councils can lawfully
                  reclassify it and recover backdated arrears — up to roughly
                  three years, within each state's statutory limits. RatesAssist
                  charges a success fee of 10–15% on the net additional rates the
                  council actually collects, capped at 24 months from the
                  correction date. No upfront cost, no subscription required for
                  the recovery tier, and the incentives are aligned — RatesAssist
                  earns only when the council does.
                </p>
              </div>
            </section>

            {/* §10 Trust */}
            <section className="space-y-6">
              <SectionHeading id="trust" eyebrow="Built for the public sector" title="Trust & compliance" />
              <p className="text-ink-700">
                Every decision is taken as if a state Auditor-General were
                reviewing it next week. The platform is designed to the SOC 2
                Trust Services Criteria and the Australian Privacy Act
                (Australian Privacy Principles); council data is hosted in
                Australia; the audit trail is hash-chained and independently
                verifiable; and the AI is grounded so it cannot fabricate a fact.
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  "AU-hosted (Sydney region)",
                  "Hash-chained audit log (compute + verify in place)",
                  "Privacy Act / APP aligned",
                  "Designed to SOC 2 TSC",
                  "Tool-grounded — citation required",
                  "Preview-then-confirm writes",
                  "Row-level multi-tenant isolation",
                  "Designed for 7-year retention (Phase 2)",
                ].map((b) => (
                  <span
                    key={b}
                    className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs text-ink-700"
                  >
                    {b}
                  </span>
                ))}
              </div>
              <p className="text-sm text-ink-600">
                Independent SOC 2 attestation and external penetration testing
                are part of our path to production rather than claims we make
                today. The full posture — security, status, changelog, privacy,
                sub-processors — is published in the{" "}
                <Link
                  href="/trust"
                  className={`text-accent-700 underline hover:text-accent-800 ${FOCUS_LINK}`}
                >
                  trust centre
                </Link>
                .
              </p>
            </section>
          </div>
        </div>
      </div>

      {/* ── CTA ─────────────────────────────────────────────── */}
      <section className="border-t border-ink-100 bg-ink-50">
        <div className="mx-auto max-w-6xl px-6 py-14 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-ink-900">
            See what your council is owed
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-ink-700">
            A no-obligation 30-day pilot. We bring the data, find the candidates,
            and show you the evidence packs before any commitment.
          </p>
          <a
            href={MAILTO}
            className={`mt-6 inline-flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-3 text-white shadow-sm hover:bg-accent-700 ${FOCUS_BTN}`}
          >
            Email {CONTACT_EMAIL} <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>
    </PublicLayout>
  );
}
