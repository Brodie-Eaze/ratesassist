# RatesAssist — Sub-processors

| | |
|---|---|
| **Document** | Current sub-processor list |
| **Audience** | Council privacy officers, ICT, procurement |
| **Status** | Pre-pilot. Living document. |
| **Owner** | Brodie · `privacy@ratesassist.com.au` |
| **Version** | 1.0 |
| **Last reviewed** | 2026-05-08 |
| **Review cycle** | On change, and at minimum quarterly |

---

## What is a sub-processor?

A sub-processor is any third-party organisation that processes council-supplied or council-derived personal information on RatesAssist's behalf. Public-data sources (DMIRS, Landgate / SLIP, ABR) are **not** sub-processors — they are the upstream providers of public registers, and personal information is not transferred to them.

This document lists every sub-processor RatesAssist currently uses, every sub-processor planned for an explicit upcoming phase, and every sub-processor under evaluation.

---

## Current sub-processors (in production for the pilot)

| # | Provider | Role | Data classes processed | Data residency | Contract type | Status |
|---|---|---|---|---|---|---|
| 1 | **Anthropic, PBC** | LLM inference (Claude API) | Up to OFFICIAL:Sensitive (role-redacted prompts; tool-call results) | United States; AU-region pinned where Anthropic offers it | Commercial Terms (Anthropic API) — no training on API content per published policy | Active |
| 2 | **Vercel, Inc.** | Application hosting (edge functions, static assets) | All classes in transit; OFFICIAL at rest in platform storage | Sydney edge region (`syd1`) pinned for execution; global CDN for static assets | Vercel DPA + standard terms | Active |
| 3 | **Cloudflare, Inc.** | CDN / DDoS / WAF for public web tier | OFFICIAL only — no PROTECTED traffic routed through Cloudflare edge | Global edge; AU PoPs preferred | Cloudflare DPA + standard terms | Active |
| 4 | **GitHub (Microsoft)** | Source-code hosting and CI | No production personal data; configuration and code only | United States | GitHub DPA + standard terms | Active |

---

## Planned sub-processors (committed for an upcoming phase)

| # | Provider | Role | Data classes (planned) | Residency (planned) | Phase | Status |
|---|---|---|---|---|---|---|
| 5 | **AWS (ap-southeast-2, Sydney)** | Production hosting (compute, RDS Postgres, S3, KMS) | All classes including PROTECTED | AU-only (Sydney) | Phase 6 — Production Hardening | Planned |
| 6 | **WorkOS, Inc.** | Enterprise SSO (Microsoft Entra / SAML / OIDC) | Authentication metadata; not council operational data | US; SCC-equivalent contractual arrangements | Phase 4 — Officer SSO | Planned |
| 7 | **Render.com (alternate)** | Alternate application hosting under evaluation | All classes in transit; OFFICIAL at rest | AU-region offering required before adoption | Phase 6 (if AWS migration is deferred) | Under evaluation; not currently active |

---

## Public-data sources (not sub-processors)

For completeness, RatesAssist ingests data from the following public sources. These are upstream data providers, not sub-processors, because no personal information is transferred to them by RatesAssist.

- **DMIRS** — Western Australian Department of Mines, Industry Regulation and Safety (mining tenements).
- **Landgate / SLIP** — Western Australian land information service (cadastre, valuations, ownership of public-record properties).
- **Australian Business Register (ABR)** — Australian Taxation Office.
- **Commonwealth and state grant feeds** — published grant programmes used by the Recovery / grant-alert features.

---

## Adding or changing sub-processors

RatesAssist will:

1. Notify each council customer in writing **at least 30 days before** any new sub-processor begins processing council-supplied personal information.
2. Provide the proposed sub-processor's role, data classes, residency, and contract basis in that notice.
3. Honour a council's right to object on reasonable grounds.
4. Update this document on the same day a new sub-processor goes live.

Councils may request the **current** sub-processor list at any time by emailing `privacy@ratesassist.com.au`.

---

## Removing sub-processors

When a sub-processor is removed, this document records the removal date and the verified deletion / return of any council data held by that sub-processor. Removal records are retained for 7 years.

---

*Last reviewed: 2026-05-08 · Next review: 2026-08-08 · Review cycle: on-change + quarterly.*
