# Elevation Report — Evidence Pack Generator (Backend)

**Routes:** `GET /api/evidence/[file]` · `GET /api/evidence/[file]/pdf`  
**Files:** `apps/web/app/api/evidence/[file]/route.ts` · `apps/web/app/api/evidence/[file]/pdf/route.ts` · `apps/web/lib/evidencePdf.ts` · `packages/recovery-engine/src/evidencePack.ts`  
**Score before:** 68/100  
**Potential score:** 92/100  
**Generated:** 2026-06-09

---

## Current score breakdown

| Dimension | Score | Notes |
|---|---|---|
| Correctness | 14/20 | PDF route uses global sync context; strata cross-links dead-end |
| Robustness | 11/20 | No PDF timeout; no PDF-specific rate cap; packId collision in audit |
| Speed | 15/20 | pdfkit is synchronous on main thread; no streaming path |
| Clarity (officer UX) | 12/20 | Four distinct error states collapsed to a single 404; no download confirmation |
| Delight | 7/20 | Completely absent — the feature is functional but invisible |
| Would the 0.0001% ship this? | 9/20 | No — data-isolation regression, latent XSS path, silent dead-ends |

**Total: 68/100**

---

## Weaknesses (confirmed by code reading)

### W1 — PDF route uses the global sync context (data-isolation regression)  
**Severity: Critical**  
`pdf/route.ts` line 91 calls `getEvaluationContext()` — the process-wide, tenant-agnostic, synchronous cache. The `.md`/`.html` sibling correctly calls `await getEvaluationContextForTenant(session.tenantId)` (E3 path). Under the E3 design the global cache is intentionally "stale or cross-tenant" — it is the pre-isolation fallback. A TPS officer's PDF is therefore built from a context that may include KAL property records, KAL tenements, or KAL owners that leaked into the shared in-memory snapshot before the per-tenant path was introduced. This is a verifiable data-isolation bug, not a theoretical one: `buildEvidencePack` looks up `property`, `owner`, and `tenements` in the context by assessment number alone — if KAL data is in the global cache and a KAL assessment number exists in TPS's URL namespace (unlikely but not impossible with deterministic test fixtures), the pack will silently use cross-tenant data.

**Fix:** Replace `getEvaluationContext()` with `await getEvaluationContextForTenant(session.tenantId)` on line 91 of `pdf/route.ts`. Two-line change. The route is already `async`; no signature change needed.

---

### W2 — HTML renderer re-introduces unescaped HTML fragments after escaping (latent XSS)  
**Severity: High**  
`renderHtmlPack` first HTML-escapes the entire markdown blob (`&amp;`, `&lt;`, `&gt;`). It then applies regex replacements that emit raw `<strong>`, `<em>`, `<code>` tags into the previously-escaped string. The "escape then re-introduce" pattern is safe **only** when the content that flows into the substitution positions is under full application control. Today `buildEvidencePack` controls all markdown syntax positions — owner names are interpolated into blockquote prose, not into `**...**` syntax. But the TODO comment acknowledges the renderer will be replaced before production, which means this contract can silently break during that replacement. If an owner name or address ever appears inside a `**` pair (e.g. if a future refactor adds `**${owner.name}**`), the bold regex would emit `<strong><script>…</strong>` for a name containing `<script>`.

**Fix:** Replace the hand-rolled regex pipeline with a two-dependency approach before any production deploy: use `marked` (or `micromark`) to parse markdown to HTML, then pipe the result through `DOMPurify` (server-side via `isomorphic-dompurify`) to strip any injected markup. The TODO already names this; it should be a hard deploy gate, not a comment.

---

### W3 — No render timeout on `renderEvidencePdf()`  
**Severity: Medium**  
pdfkit renders synchronously in document chunks on the Node.js main thread. The event loop is blocked for the entire duration of `doc.end()` → `done` Promise resolution. A pathological pack (thousands of signals via a future bulk import) or a corrupted pdfkit font cache can stall the route handler for an unbounded period. There is no `AbortSignal`, no `Promise.race`, and no per-request CPU budget.

**Fix:** Wrap `renderEvidencePdf()` in a `Promise.race` with a hard timeout (e.g. 15 seconds for a statutory document with reasonable signal counts). On timeout: return 503 with a `Retry-After: 30` header and log the duration so the ops team can detect regressions before they hit production.

---

### W4 — Deterministic packId creates audit ambiguity  
**Severity: Medium**  
`packId = EP-<assessment>-<YYYYMMDD>`. Two officers downloading the same assessment on the same day produce an identical `packId`, which becomes the `target.id` of the `pdf.generated` audit row. A naive query `SELECT count(*) WHERE target_id = 'EP-TPS-1102-91-20260609'` cannot distinguish whether one officer downloaded the pack twice, or two officers each downloaded it once. The `operatorName` is in `after`, but the audit primary key collision means JOIN-based reporting is ambiguous.

**Fix:** Append a 6-character random hex suffix to the packId: `EP-<assessment>-<YYYYMMDD>-<hex6>`. The pack is still date-traceable and per-day groupable, but each download is individually addressable in the audit log. Alternatively, generate the audit row's own UUID and record `packId` as metadata rather than the target id — but the suffix approach requires a smaller blast radius.

---

### W5 — No PDF-specific rate limiting  
**Severity: Medium**  
The general rate limiter runs on IP. Generating a statutory PDF is O(n signals) in pdfkit time and O(signals × signal_data) in memory. A burst of 20 concurrent PDF requests for different assessments will each build a full `EvidenceContext`, run `renderEvidencePdf`, and hold the resulting ~500KB Buffer in memory before the response flushes. At serverless concurrency limits (e.g. 10 concurrent Lambda functions at 512MB each), this can exhaust available memory before the IP rate limiter notices. The PDF path is also more expensive than the `.md`/`.html` path by an order of magnitude.

**Fix:** Add a dedicated PDF rate-limit bucket keyed on `(tenantId, userId)` with a tight max — e.g. 5 PDFs/minute per user. Council officers produce at most a handful of PDFs per session; a rate of 5/min is generous. Reuse the existing `rateLimitComposite` helper which already supports composite keys.

---

## Flow gaps (confirmed by code reading)

### F1 — `no_owner` surfaces as an opaque 404  
Both routes return `{ error: "no pack", reason: "no_owner" }` (the reason field is set by `buildEvidencePack`'s discriminated union) but the HTTP status is 404 and the message is the generic "Evidence pack not available." The officer-facing UI at `/recovery/[assessment]` cannot distinguish "property not found" from "signals fired but owner record is missing — please reconcile the rating roll before generating the pack." This produces unnecessary support cycles during the pilot: a clerk will assume the assessment number is wrong, not that the owner table needs an update.

**Fix:** Map `no_owner` to HTTP 422 (Unprocessable Entity) with a structured body: `{ code: "owner_missing", actionRequired: "Reconcile owner record in the rating system before generating this pack." }`. Separate HTTP status codes make the UI branch trivially.

---

### F2 — `no_state_template` collapses into the same 404 as "property not found"  
A council officer in Victoria or South Australia trying to generate a pack sees `{ error: "no pack", reason: "no_state_template" }` returned as a 404 — indistinguishable from the property simply not existing in the system. There is no message explaining that the property exists, signals fired, but the jurisdiction is not yet supported by the evidence template engine. A non-WA/NSW/QLD council would experience a confusing dead-end with no recovery path.

**Fix:** Map `no_state_template` to HTTP 501 (Not Implemented) with `{ code: "jurisdiction_unsupported", state: result.state, supportedStates: ["WA", "NSW", "QLD"] }`. The UI can then display a constructive message: "Evidence packs are not yet available for [state] properties. Contact RatesAssist to request jurisdiction support."

---

### F3 — No download confirmation after PDF save  
After a successful PDF download, the response is a file-save — a silent browser event. Council officers whose internal audit processes require them to log that a statutory document was generated and reviewed have no in-app acknowledgement. There is no "You downloaded EP-TPS-1102-91-20260609 at 14:32 AWST — this has been recorded" confirmation on screen. The audit row IS written server-side, but the officer never sees evidence of it.

**Fix:** After the PDF download initiates, the page should display a timestamped download confirmation toast or modal: "Pack EP-TPS-1102-91-20260609 downloaded at [time]. This event has been recorded in the audit log." This requires a client-side event (the download link fires a fetch, the response triggers the confirmation), not a server-side change.

---

### F4 — Data version drift between HTML preview and PDF download  
The per-tenant context TTL is 5 minutes. An officer opens the evidence pack page, reads for 6 minutes, then clicks Download PDF. If a concurrent roll import completed in that window, the PDF is built from a new context snapshot — it may silently differ from what was displayed on screen. No version indicator, no content hash, no "data refreshed while you were reading" warning.

**Fix:** Embed a `contextHash` (a short SHA256 of the context's property + signal fingerprint) in both the HTML render and the PDF. When the officer requests the PDF, compare hashes; if they differ, return the PDF but add a response header `X-Context-Refreshed: true` and show a client-side banner: "The underlying data was refreshed while this page was open. The downloaded PDF reflects the latest data."

---

### F5 — Strata cross-links dead-end silently  
In `renderStrataChildren`, children are rendered as `Volume X Folio Y` text only (in the markdown). The HTML renderer does not link them. The feature map notes that the evidence pack page at `/recovery/[assessment]` generates links to `/recovery/<volume>-<folio>` for strata children. The `/recovery/[assessment]` route expects `<PREFIX>-<NN>-<NN>` format (e.g. `TPS-1102-91`). A volume-folio slug like `3801-211` will match no assessment and silently render the "not found" empty state. The cross-link promises navigation but delivers a dead-end.

**Fix:** Do not generate links from volume-folio. Instead, when a property has strata children, resolve their assessment numbers at pack-build time (via a `ctVolumeAndFolioToAssessment` lookup in the evaluation context) and emit links using resolved assessment numbers. If the assessment number cannot be resolved from the CT volume/folio, render the volume-folio as plain text with a note: "(assessment number not on file — search by CT volume/folio in the rating system)."

---

## Ambitious recommendations

### R1 — Sign every PDF with an officer-keyed cryptographic hash (non-repudiation layer)

**The leap:** Every PDF downloaded should embed a unique, verifiable digital fingerprint that binds the document to the officer's session and the exact data snapshot used. Concretely: SHA-256 hash the entire PDF byte buffer after rendering, sign it with an HMAC keyed on `(tenantId + packId + userId + timestamp)`, and embed both the hash and HMAC signature in the PDF's `Custom` info dict and as a visible footer field ("Document integrity hash: abc12345…"). A council's legal team can verify the document hasn't been tampered with post-download. The audit row stores the hash. Future verification can replay: "was the document that was lodged with the council's rates complaint tribunal identical to the one we generated?"

**Why this jaw-drops a council director:** This makes RatesAssist the first council rates platform where every statutory evidence document is independently verifiable without trusting the vendor. When a ratepayer's solicitor challenges the evidence, the council can produce the original document AND its hash, and show they match. No other LGA software does this. A council director forwarding this to peers would call it "statutory-grade evidentiary integrity that survives a rates tribunal challenge."

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 9 | 3 | 3.0 | 1.5 |

---

### R2 — Async PDF generation with push notification (eliminate the UI spinner)

**The leap:** pdfkit blocks the event loop. Instead of making the officer wait for synchronous rendering, accept the PDF request immediately (202 Accepted), enqueue a generation job, and push a notification (toast + browser notification if permission granted) when the PDF is ready. The officer continues working. The completed PDF is stored for 24 hours in a signed ephemeral URL (S3 presigned or Railway volume). This also decouples concurrency pressure from the PDF endpoint.

**Why this is elite:** Stripe's async invoice generation pattern. Linear's background export pattern. Apple's "Processing…" AirDrop model. No tool in the LGA software market has ever told a rates officer "keep working — your pack will be ready in seconds." The interaction shift from "wait for the spinner" to "it's ready, here's your link" is the single biggest UX leap this feature can make.

This also solves W3 (timeout), W5 (rate limiting), and F3 (download confirmation) in one architectural move.

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 9 | 6 | 1.5 | 4 |

---

### R3 — Version-stamped, reproducible evidence snapshots (immutable pack ledger)

**The leap:** Replace the daily-deterministic packId with a content-addressed pack ledger. When a pack is generated, serialise the full `EvidencePack` struct (properties, signals, owner, uplift figures) to JSON, hash it, and store `(tenantId, assessmentNumber, contentHash, generatedAt, operatorId)` in a `evidence_pack_versions` table. The packId becomes `EP-<assessment>-<hash8>` — unique per content state. Re-generating the pack with identical data produces the same packId (deterministic, cheap idempotency check). Generating it after a data change produces a new packId and a new row, automatically creating a version history.

**Outcome:** An officer can see "Version 3 of this pack — data changed on 2026-05-14 when the DMIRS tenement record was updated." A legal team can retrieve any historical version. F4 (data drift) is solved structurally: the "current" version is always the hash of today's data, and the UI can show "you last viewed v2; v3 is now available."

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 9 | 5 | 1.8 | 3.5 |

---

### R4 — Fix the PDF context isolation bug (W1 — two-line critical fix)

**The fix:** Replace `getEvaluationContext()` with `await getEvaluationContextForTenant(session.tenantId)` in `pdf/route.ts:91`. This is the highest ratio item on this list.

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 10 | 1 | 10.0 | 0.25 |

---

### R5 — Discriminated error responses for `no_owner`, `no_state_template`, `no_signals` (F1, F2)

**The fix:** Map each `EvidencePackResult` kind to a distinct HTTP status and structured body. `no_owner` → 422 with `actionRequired`. `no_state_template` → 501 with `supportedStates`. `no_signals` → 404 with a descriptive message distinguishing "property not found" from "property exists but no signals fired." Three-branch addition to the result handler.

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 8 | 1 | 8.0 | 0.5 |

---

### R6 — PDF-specific rate limit keyed on `(tenantId, userId)` (W5)

**The fix:** Add a `rateLimitComposite({ tenantId, userId })` check at the top of the PDF route handler, before context hydration. Max 5 requests/minute. Reuse the existing `rateLimitComposite` helper — zero new infrastructure.

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 7 | 1 | 7.0 | 0.25 |

---

### R7 — Replace hand-rolled HTML renderer with `marked` + `isomorphic-dompurify` (W2)

**The fix:** Swap out `renderHtmlPack`'s regex pipeline for `marked.parse(markdown)` piped through `DOMPurify.sanitize()`. Eliminates the XSS latency and removes ~130 lines of fragile regex code. The TODO comment already calls for this — promote it from comment to deploy gate.

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 8 | 2 | 4.0 | 1 |

---

### R8 — PDF render timeout with 503 + Retry-After (W3)

**The fix:** Wrap `renderEvidencePdf()` in `Promise.race([renderEvidencePdf(input), rejectAfter(15_000)])`. On timeout: return 503 with `Retry-After: 30`. Log duration on every render so P95 can be tracked over time.

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 6 | 1 | 6.0 | 0.5 |

---

### R9 — Unique packId (hex suffix) to fix audit row collision (W4)

**The fix:** Append 6 bytes of `crypto.randomBytes(3).toString('hex')` to the packId at generation time. `EP-TPS-1102-91-20260609-a3f7c2`. Each download gets a unique audit target id. The daily-groupable date component is preserved.

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 6 | 1 | 6.0 | 0.25 |

---

### R10 — Resolve strata CT cross-references to assessment numbers (F5)

**The fix:** In `buildEvidencePack` (or its markdown renderer), add a `ctToAssessment` Map to the `EvaluationContext` (derived from the existing `properties` array by indexing on `ctVolume + ctFolio`). When rendering strata children, resolve `(volume, folio)` → `assessmentNumber`. Emit an internal link when resolvable; emit plain text when not. This makes strata navigation functional for every property in the tenant's data set.

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 6 | 2 | 3.0 | 1.5 |

---

### R11 — "Pack is ready" download confirmation + audit acknowledgement UI (F3)

**The leap:** After the officer downloads the PDF, display a persistent timestamped banner on the evidence pack page:

> "EP-TPS-1102-91-20260609-a3f7c2 downloaded at 14:32 AWST. This event has been recorded in the council audit log."

The banner persists until the officer navigates away. A secondary CTA: "Add case note" — opens a text field that writes a case note to the audit log alongside the pdf.generated row. This turns a silent file-save into an explicit, documented act. Council directors care deeply about this for rates tribunal defence.

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 7 | 2 | 3.5 | 1 |

---

### R12 — Inline "officer attestation" checkbox before PDF download (delight + compliance)

**The leap:** Before the PDF download starts, show a one-line modal:

> "By downloading this pack I confirm I have reviewed the evidence and will apply independent professional judgement before issuing any notice. [ Download pack ]"

This isn't a legal disclaimer — it's an officer workflow trigger. It forces the officer to pause and confirm they've read the evidence (not just mass-downloading packs). The attestation is logged alongside the `pdf.generated` audit row. This is the interaction that makes every council compliance officer stand up straight: it shifts the product from "AI that outputs documents" to "AI that supports officer judgement." Linear does this for destructive actions. Apple does this for App Store purchases. It should be the default for any action that results in a statutory document.

| Impact | Effort | Ratio | Effort days |
|---|---|---|---|
| 8 | 2 | 4.0 | 1 |

---

## What to remove (simplicity gains)

| Item | Why remove |
|---|---|
| The `renderHtmlPack` regex pipeline (~130 lines) | Replace entirely with `marked` + DOMPurify. The TODO already says so. Remove the function, not just the TODO. |
| The `buildEvidenceUrl` `nextUrl.origin` fallback branch | The F-014 lockdown already throws in production. The dev fallback adds a code path that can never be tested in production; inline it into the test helper instead. |
| `sanitisePdfOperatorName` regex `[ -\\()<>]` stripping spaces | The regex `[ -\\()]` strips spaces from the operator name, turning "Jane Smith" into "JaneSmith" in the PDF Info dict. Either fix the regex character class or use a dedicated sanitise-for-pdf-info function from a library. Leaving broken sanitisation in place for a statutory document is worse than no sanitisation — it makes the PDF wrong AND unsafe. |
| Duplicate cross-tenant guard comments in both routes | The comment block in `pdf/route.ts` lines 10–29 and the equivalent in `[file]/route.ts` lines 17–23 say the same thing in different words. Extract a single `TENANT_GATE_RATIONALE` constant or collapse into the shared `api-helpers` module. |

---

## Ranked recommendations (by impact/effort ratio)

| Rank | Ref | Title | Impact | Effort | Ratio | Days |
|---|---|---|---|---|---|---|
| 1 | R4 | Fix PDF context isolation (W1) | 10 | 1 | 10.0 | 0.25 |
| 2 | R5 | Discriminated error responses (F1, F2) | 8 | 1 | 8.0 | 0.5 |
| 3 | R6 | PDF-specific rate limit | 7 | 1 | 7.0 | 0.25 |
| 4 | R8 | PDF render timeout + 503 | 6 | 1 | 6.0 | 0.5 |
| 5 | R9 | Unique packId hex suffix | 6 | 1 | 6.0 | 0.25 |
| 6 | R7 | Replace HTML renderer with marked + DOMPurify | 8 | 2 | 4.0 | 1 |
| 7 | R12 | Officer attestation checkpoint before download | 8 | 2 | 4.0 | 1 |
| 8 | R11 | Download confirmation + "Add case note" | 7 | 2 | 3.5 | 1 |
| 9 | R1 | Cryptographic PDF signing (non-repudiation) | 9 | 3 | 3.0 | 1.5 |
| 10 | R10 | Resolve strata CT to assessment numbers | 6 | 2 | 3.0 | 1.5 |
| 11 | R3 | Content-addressed pack ledger (versioning) | 9 | 5 | 1.8 | 3.5 |
| 12 | R2 | Async PDF generation + push notification | 9 | 6 | 1.5 | 4 |

---

## The jaw-drop moment

**Async PDF delivery + cryptographic non-repudiation in one motion.**

An officer clicks "Generate PDF." The route returns immediately (202). A push notification arrives 3 seconds later: "Your pack is ready." The officer opens it and sees at the bottom:

> "Document integrity hash: a3f7c2d8 · Signed by RatesAssist on behalf of City of Kalgoorlie-Boulder · Verifiable against audit log ref AU-2026-06-09-a3f7c2d8"

When a ratepayer's solicitor challenges the evidence six months later, the council produces the PDF, runs it through the verification endpoint, and the hash matches the audit log. No other LGA software has ever done this. A council director seeing this demo for the first time will forward it to every rates officer in the state.

---

## Score projection after high-ratio items (R4, R5, R6, R7, R8, R9)

Implementing R4 + R5 + R6 + R8 + R9 (all ratio ≥ 6, total ~1.75 days effort) closes the critical correctness and robustness gaps:

| Dimension | Before | After high-ratio fixes | After R1+R2+R3+R12 |
|---|---|---|---|
| Correctness | 14/20 | 19/20 | 20/20 |
| Robustness | 11/20 | 17/20 | 19/20 |
| Speed | 15/20 | 16/20 | 20/20 |
| Clarity | 12/20 | 16/20 | 18/20 |
| Delight | 7/20 | 9/20 | 17/20 |
| 0.0001% | 9/20 | 14/20 | 19/20 |
| **Total** | **68/100** | **91/100** | **113/120** |

High-ratio fixes alone clear the 90/100 elite bar. The ambitious items (R1, R2, R3, R12) push the feature from elite to category-defining.

---

*Generated by /elevate — dry run. No code was changed. All recommendations require Brodie's selection before implementation begins on a feature branch.*
