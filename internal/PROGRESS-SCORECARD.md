# RatesAssist — Progress Scorecard

| | |
|---|---|
| **Document** | Audit score before / after the five fix tracks |
| **Audience** | Board, investors, ICT auditors, the founder himself |
| **Status** | Internal. Honest. |
| **Owner** | Brodie · `engineering@ratesassist.com.au` |
| **Last reviewed** | 2026-05-15 |
| **Review cycle** | After each phase tag |

---

## Purpose

This is the document a board member who asks *"is this real?"* should
read first. It uses the CTO audit's ten-dimension scorecard, marks
where we landed before the v1.3.x + ship-readiness fix tracks, where we
land after, and the gaps that remain. No grade is inflated. No claim is
made that is not backed by code in the repo or by an explicit roadmap
tag.

## How to read the scores

- **0–40** — aspirational; the surface exists but the substance does
  not.
- **41–60** — partial; the happy path works but the edge cases and
  proof points are missing.
- **61–80** — solid; the engineering is there, the proof is there, a
  council CIO can sign off on this dimension.
- **81–95** — production-grade; passes a real Auditor-General review
  with documented evidence.
- **96–100** — best-in-class. Reserved for what you would put in a
  procurement deck.

---

## The ten dimensions

| # | Dimension | Before Tracks 1-5 | After Tracks 1-5 | Δ |
|---|---|---:|---:|---:|
| 1 | **Detection breadth** — signal catalogue + cross-register joins | 78 | 82 | +4 |
| 2 | **Math correctness** — uplift formula, backdating, statutory caveats | 70 | 88 | +18 |
| 3 | **Evidence quality** — formula trail, source URLs, caveats, audit pack | 74 | 86 | +12 |
| 4 | **Data integrity** — tamper-evident audit, deterministic IDs, dedup | 72 | 80 | +8 |
| 5 | **Observability** — structured logs, retention, alerting, query playbook | 50 | 78 | +28 |
| 6 | **Performance** — sub-2s sweeps proven against pilot-scale data | 55 | 86 | +31 |
| 7 | **Security posture** — redaction, RBAC, audit chain, AU residency | 70 | 76 | +6 |
| 8 | **Operational readiness** — runbooks, on-call, deploy gates | 68 | 76 | +8 |
| 9 | **Public-facing polish** — README, status pages, integration honesty | 55 | 82 | +27 |
| 10 | **Honest provenance** — LIVE / STUB / PLANNED labelling, no fabrication | 84 | 90 | +6 |
| | **Weighted overall** | **67.6** | **82.4** | **+14.8** |

The weighted overall is an unweighted mean — every dimension counts
equally. A weighted mean that favoured math and detection would score
higher; we deliberately don't bias the headline.

## What the five fix tracks delivered

- **Track 1 — Performance.** `scripts/perf-bench.ts` + `npm run perf`
  produces a dated report at `reports/perf-bench-<date>.md` that proves
  a synthesised 5,000-property council is processed in well under
  20 ms (budget: 2,000 ms). The bench is deterministic — pinned PRNG,
  pinned clock — so it diffs cleanly against prior runs.
- **Track 2 — Logger.** Explicit log levels, ship-to-collector switch
  (`RA_LOG_SHIP`), JSON / pretty / file transport routing
  (`RA_PINO_TRANSPORT`), structured error serializer so log analysers
  index `error.type` and `error.message` as columns.
- **Track 3 — Observability doc.** `internal/OBSERVABILITY.md` covers
  destinations (BetterStack AU, Sumo Sydney, CloudWatch ap-southeast-2,
  Datadog AP1), 7-year audit retention (LGA 1995 + State Records Act
  2000), alerting matrix with severity, recommended log queries.
- **Track 4 — Public README.** Lead with the problem statement, three
  pillars, ASCII architecture, AU-residency claim called out, LIVE /
  STUB / PLANNED integration table that mirrors the runtime
  `/connections` page.
- **Track 5 — Changelog + scorecard.** Every release from
  v0.1-prototype through v1.3.0-review-hardened captured with
  Added / Changed / Fixed / Security per release, and this document
  itself.

The math and detection numbers also moved on the back of v1.2.0 (real
WA rate tables + accurate uplift) and v1.3.0 (NaN/Infinity rejection,
lifecycle dedup, strict change-date parsing, overtaxation routing).

---

## Top 5 remaining gaps

These are real. We hold them open rather than paper over them.

1. **No real council pilot has been run yet.** Every number in the
   evidence packs is computed against synthesised or mocked data
   (mocked change-detection + the WA rate tables, all flagged
   `verified: false` because live council pages 404'd during the
   build window). The product is pilot-ready; pilot-validated is the
   next bar.
2. **IRAP / ISM certification not started.** Required for federal +
   state-government workloads at scale. Today's posture (Vercel
   Sydney edge + AWS Sydney target) is consistent with IRAP-PROTECTED,
   but the formal assessment, gap analysis, and remediation plan are
   not in place.
3. **Production AWS Sydney deploy not stood up.** The current pilot
   runs on Vercel `syd1`. The Phase 6 AWS migration (VPC, KMS, WAF,
   CSP/HSTS, AWS Shield Standard, RDS Postgres for the persistent
   audit chain) is documented in `PRODUCTION-PLAN.md` but not built.
4. **Audit chain runs against an in-memory ring buffer.** The
   tamper-evident hash chain is cryptographically real, but the
   storage layer (a 10,000-row FIFO) will lose old chain state by
   design. Phase 6 swaps in AWS QLDB or S3 Object Lock. Until then,
   the chain is honest about its eviction policy in the
   implementation comments and in `SECURITY.md`.
5. **Rate tables show `verified: false`.** Six WA councils' 2025-26
   rate-in-dollar / minimum-payment lines are carried forward from the
   2024-25 published schedules (with one Sandstone row labelled
   "Pilbara/Goldfields average"). The UI flags this on every formula.
   `scripts/refresh-rate-tables.ts` (planned) is the path to
   `verified: true`.

## Top 5 strengths

The headline strengths a council CIO or board member can verify by
reading the code:

1. **Honest provenance throughout.** LIVE / STUB / PLANNED labels live
   on the integrations table, the `/connections` UI, the recovery
   candidate `rateFormula` field, the source URLs in evidence packs,
   and the README. No silent fallback to mock data.
2. **The math is defensible.** `calculateUplift` runs the same
   formula a council CFO would on the back of a napkin —
   `max(value × rate, minimum)` — with full audit trail in the
   `formula` field, basis routing (GRV vs UV), and explicit
   3-year-conservative + 5-year-statutory backdating brackets.
3. **22 calibrated signals with exclusive groups enforced both at
   evaluation and at composition** — no signal double-counts; no
   exclusive-group constraint is implicit.
4. **Sub-20 ms 5,000-property sweep** — proven, dated,
   reproducible. The headline number ("a 5,000-property council in
   under 20 ms") is real measured data, not marketing.
5. **7-year audit retention with a tamper-evident hash chain** — the
   stronger guarantee a council can ask for short of a notarial
   timestamping service. Verification surfaced at
   `/api/audit/verify-chain` with RBAC.

---

## What's left to hit 95+

A 95+ score requires the following — none of which are software
fixes. They're real-world deliveries.

| Item | Phase | Why it matters |
|---|---|---|
| **First real council pilot** complete with at least one issued reclassification notice and one collected backdated arrears payment | 7 | Moves us from "the math is defensible" to "the math has been defended in front of an actual ratepayer". |
| **IRAP-PROTECTED assessment** passed and remediation closed | 8 | Required for state and federal-government workloads beyond pilot. |
| **Production AWS Sydney deploy** with VPC + KMS + WAF + persistent audit storage | 6 | Removes the "Vercel edge / in-memory chain" caveat from the security posture. |
| **Rate tables flipped to `verified: true`** for all six WA councils | 6 | Removes the `[unverified — see caveats]` badge from every formula. |
| **OAIC privacy impact assessment** filed and reviewed against APP 1-13 | 7 | Required for any council touching personal information across boundaries. |
| **Real Landgate restricted-tier integration** live (replaces the STUB) | 6 | Closes the parcel-PIN precision gap on the headline cadastre-lag signal. |
| **First customer reference quote** in writing | 7 | The thing every other procurement bar requires. |
| **An independent code review** by a credentialed third party | 8 | The 3-agent in-tree review is good; an external review is better. |

---

*Last reviewed: 2026-05-15 · Owner: Brodie · `engineering@ratesassist.com.au`.*
