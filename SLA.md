# RatesAssist — Service Level Agreement

| | |
|---|---|
| **Document** | Service level agreement (pilot + production targets) |
| **Audience** | Council ICT, finance, procurement |
| **Status** | Pre-pilot. Living document. |
| **Owner** | Brodie · `oncall@ratesassist.com.au` |
| **Version** | 1.0 |
| **Last reviewed** | 2026-05-08 |
| **Review cycle** | Quarterly during pilot; annual once production SLA is in force |

---

## 1. Scope

This SLA applies to the RatesAssist service used by a council under a signed pilot or production agreement. It does **not** apply to:

- Demonstration environments not under contract.
- Free trials.
- Beta features explicitly marked as such.

---

## 2. Pilot SLA (current)

The pilot is delivered on a **best-effort, single-replica** architecture by a single-founder business. The pilot SLA reflects that reality.

| Metric | Pilot target |
|---|---|
| Chat availability (monthly) | **99.0%** best-effort |
| Chat latency, p95 | **< 8 seconds** |
| Chat latency, p99 | **< 20 seconds** |
| On-call acknowledgement, P1 | **1 hour**, 24/7 |
| On-call acknowledgement, P2 | **4 hours**, within pager hours (`ON-CALL.md`) |
| Incident communications cadence (P1) | **Hourly** updates until containment |
| Maintenance window | AWST **23:00–01:00 Tuesdays**, opt-out on request with 5 business days' notice |
| NDB Scheme assessment | **72 hours** internal target (statutory max 30 days) |

---

## 3. Production SLA (post-Phase 6)

After the Phase 6 production-hardening rollout (AWS migration, multi-replica deployment, on-call rotation), targets tighten:

| Metric | Production target |
|---|---|
| Chat availability (monthly) | **99.5%** |
| Chat latency, p95 | **< 4 seconds** |
| Chat latency, p99 | **< 10 seconds** |
| On-call acknowledgement, P1 | **30 minutes**, 24/7 |
| On-call acknowledgement, P2 | **2 hours**, 24/7 |
| Incident communications cadence (P1) | **30-minute** updates until containment |
| Maintenance window | AWST **23:00–01:00 Tuesdays** |
| Status page | Public status page, real-time |

These targets will not be represented to a council as **in force** until Phase 6 is delivered.

---

## 4. Definition of "down"

"Down" means: the chat interface is unreachable, returns 5xx, or fails to render any tool-grounded response within p99 latency, **for more than 5 consecutive minutes**, as observed from at least one Australian-based synthetic monitor.

Partial degradations (a single non-critical feature unavailable) are **not** counted as downtime against the availability metric, but **are** logged and reported.

---

## 5. Exclusions

The following are **excluded** from availability calculations and from latency targets:

- **Anthropic API outage** beyond 30 seconds. RatesAssist depends on Anthropic for narration; an upstream LLM outage will degrade the chat surface. We disclose this dependency openly.
- **DMIRS / Landgate / SLIP / ABR upstream outage.** RatesAssist depends on these public sources for ingest. Existing data remains queryable; new ingest is paused.
- **Vercel platform outage** (or, post-Phase 6, AWS regional outage in `ap-southeast-2`).
- **Cloudflare global outage.**
- **Council-side network outage**, including council VPN, council DNS, council firewall changes.
- **Force majeure** as defined in the pilot agreement.
- **Scheduled maintenance** within the agreed window in §2 / §3.
- **Beta features** explicitly marked as such.

Excluded incidents are still reported in monthly service reviews; they just do not count against the availability metric.

---

## 6. Service credits

For the **pilot**, service credits are **not** offered. This is consistent with the best-effort posture and the pilot's nominal commercial value.

For **production**, the following credit formula will apply (illustrative — final values per signed production agreement):

| Monthly availability | Service credit (% of monthly fee) |
|---|---|
| ≥ 99.5% | 0% |
| 99.0% to 99.49% | 5% |
| 95.0% to 98.99% | 15% |
| < 95.0% | 30% |

Credits are claimed by the council in writing within 30 days of the relevant month and applied as a credit against the next invoice. Credits are the council's exclusive remedy for availability shortfalls.

---

## 7. Reporting

- **Pilot:** monthly written service review covering availability, latency, incidents, and on-call activity. Delivered to the council primary contact within 5 business days of month-end.
- **Production:** the same monthly review plus a public status page and a real-time observability dashboard for the council privacy and ICT contacts.

---

## 8. Change management

Any change to this SLA requires written agreement of the council. RatesAssist will not retrospectively reduce a target without explicit consent.

---

*Last reviewed: 2026-05-08 · Next review: 2026-08-08 · Review cycle: quarterly during pilot.*
