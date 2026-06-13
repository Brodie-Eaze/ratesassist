/**
 * POST /api/verify/pack?docId=<EP-…|RN-…> — PUBLIC document verification.
 *
 * JD-2. A council's legal team (or a ratepayer's solicitor, or a tribunal)
 * can confirm a downloaded RatesAssist PDF is unmodified since generation by
 * posting the PDF bytes here with the document reference printed in its
 * footer. The endpoint recomputes the SHA-256 of the uploaded bytes and
 * compares it to the value stored in the append-only audit log at generation
 * time, and re-derives the identity HMAC under the server's signing key.
 *
 * Security posture (this route is UNAUTHENTICATED):
 *   - Rate-limited per-IP BEFORE any work (verify-chain precedent).
 *   - Body size capped; only the raw PDF bytes are read.
 *   - Tenant is DERIVED from the docId's embedded assessment prefix — the
 *     caller cannot point the lookup at an arbitrary tenant.
 *   - The HMAC verification IS the authenticity check; request input is
 *     never trusted for tenant scoping.
 *   - Responses carry NO PII (no owner/operator names) and never leak the
 *     secret, the stored hash, or chain internals — just a yes/no plus the
 *     document's own reference + generation date.
 *   - "no matching record" and "modified" are distinct results (a council
 *     legitimately needs the distinction); enumeration is bounded by the
 *     rate limit + the fact docIds embed a date and assessment number.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ok } from "@/lib/api-helpers";
import { correlationIdFromHeaders } from "@/lib/correlation";
import {
  verifyPdfIntegrity,
  type PdfIdentity,
} from "@/lib/pdfIntegrity";
import { loadPdfReceipt, type LoadedReceipt } from "@/lib/pdfReceiptStore";
import {
  getClientIp,
  globalRateLimit,
  rateLimit,
  retryAfterSeconds,
} from "@/lib/rate-limit";
import { scoped } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tight per-IP public limit — verification is cheap but must not be a free oracle. */
const VERIFY_RATE_LIMIT = 10;
/** Process-wide ceiling on total verify work/min (RA-L3-03 DoS backstop). */
const VERIFY_GLOBAL_LIMIT = 120;
/** Max PDF the endpoint will hash (our PDFs are tens of KB; 8 MB is generous). */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** EP-<assessment>-<yyyymmdd> or RN-<assessment>-<yyyymmdd>. */
const DOC_ID_PATTERN = /^(EP|RN)-([A-Z]{2,5})-[A-Z0-9-]{1,40}-\d{8}$/;


export async function POST(req: NextRequest): Promise<Response> {
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api/verify/pack", { correlationId });

  // ---- 1. Rate limit BEFORE any work (public, unauthenticated endpoint). ----
  // Two limiters: per-IP fairness AND a process-wide ceiling. RA-L3-03: the
  // per-IP limiter alone is insufficient on an unauthenticated endpoint that
  // does an 8 MB SHA-256 + an audit scan per call — a distributed caller (or
  // anyone who can still rotate IPs) could otherwise saturate the task. The
  // global limiter caps total verify work per process regardless of source.
  const ip = getClientIp(req);
  const gl = globalRateLimit(VERIFY_GLOBAL_LIMIT, "verify-pack");
  if (!gl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Verification is busy, try again shortly." },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(gl.resetAt) } },
    );
  }
  const rl = rateLimit(`verify-pack|${ip}`, VERIFY_RATE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } },
    );
  }

  // ---- 2. Validate docId. ----
  const docId = req.nextUrl.searchParams.get("docId") ?? "";
  const m = DOC_ID_PATTERN.exec(docId);
  if (m === null) {
    return NextResponse.json(
      { ok: false, code: "invalid_input", error: "A valid docId query param is required (the reference printed in the document footer)." },
      { status: 400 },
    );
  }
  const docType = m[1] === "EP" ? "evidence_pack" : "statutory_notice";
  // The tenant is derived from the assessment prefix embedded in the docId —
  // never from caller-supplied input. m[2] is the 2-5 letter council code.
  const tenant = m[2];

  // ---- 3. Read body (the PDF bytes), size-capped DURING the read. ----
  // The Content-Length pre-check is a cheap early-out only — it is absent on
  // chunked transfers and trivially spoofable, so it must NOT be the real
  // cap. We stream the body and abort the moment the running total crosses
  // MAX_PDF_BYTES, so an unauthenticated caller cannot OOM the task by
  // streaming gigabytes (the App Router applies no default body limit).
  const declaredLen = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLen) && declaredLen > MAX_PDF_BYTES) {
    return NextResponse.json(
      { ok: false, code: "payload_too_large", error: "PDF exceeds the verification size limit." },
      { status: 413 },
    );
  }
  let pdf: Buffer;
  try {
    const capped = await readBodyCapped(req, MAX_PDF_BYTES);
    if (capped === "too_large") {
      return NextResponse.json(
        { ok: false, code: "payload_too_large", error: "PDF exceeds the verification size limit." },
        { status: 413 },
      );
    }
    if (capped.length === 0) {
      return NextResponse.json(
        { ok: false, code: "invalid_input", error: "Request body must be the PDF bytes." },
        { status: 400 },
      );
    }
    pdf = capped;
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_input", error: "Could not read the request body." },
      { status: 400 },
    );
  }

  // ---- 4. Look up the stored receipt by docId within the derived tenant. ----
  // RA-L3-01: reads the DURABLE shared store when a DB is wired (correct across
  // ECS tasks + restarts), falling back to the in-memory buffer for no-DB runs.
  let receipt: LoadedReceipt | null;
  try {
    receipt = await loadPdfReceipt(tenant, docId);
  } catch (e) {
    log.error({ msg: "verify.lookup_failed", error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json(
      { ok: false, code: "internal_error", error: "Verification temporarily unavailable." },
      { status: 500 },
    );
  }

  if (
    receipt === null ||
    receipt.after.pdfSha256 === undefined ||
    receipt.after.pdfHmac === undefined ||
    receipt.after.generatedAt === undefined
  ) {
    log.info({ msg: "verify.no_record", docId });
    // Same opaque shape as a byte-mismatch — an unauthenticated caller must
    // not be able to tell "never generated" from "generated but altered".
    return ok({
      verified: false,
      result: "not_verified",
      message:
        "This document could not be verified against the record at generation time.",
      document: { ref: docId, type: docType },
    });
  }

  // ---- 5. Verify bytes + authenticity from the STORED identity. ----
  const identity: PdfIdentity = {
    tenantId: receipt.tenantId,
    docId,
    userId: receipt.actorId,
    timestamp: receipt.after.generatedAt,
  };
  const { bytesMatch, authentic } = verifyPdfIntegrity({
    pdf,
    id: identity,
    storedSha256: receipt.after.pdfSha256,
    storedHmac: receipt.after.pdfHmac,
  });
  const verified = bytesMatch && authentic;

  log.info({ msg: "verify.result", docId, verified, bytesMatch, authentic });

  if (!verified) {
    // Do NOT distinguish "modified" from "no_record" to an unauthenticated
    // caller, and do NOT leak generatedAt/assessmentNumber — only a caller
    // who actually holds the genuine bytes (verified=true) learns those.
    return ok({
      verified: false,
      result: "not_verified",
      message:
        "This document could not be verified against the record at generation time.",
      document: { ref: docId, type: docType },
    });
  }

  return ok({
    verified: true,
    result: "verified",
    // Integrity / tamper-evidence claim only — NOT a legal attestation of
    // authorship (a symmetric HMAC under our own key cannot prove that).
    message:
      "These bytes match the SHA-256 RatesAssist recorded for this document at generation time, indicating it has not been altered since. This confirms document integrity; it is not a legal attestation of authorship.",
    document: {
      ref: docId,
      type: docType,
      generatedAt: receipt.after.generatedAt,
      ...(receipt.after.assessmentNumber !== undefined
        ? { assessmentNumber: receipt.after.assessmentNumber }
        : {}),
    },
  });
}

/**
 * Read the request body into a Buffer, aborting as soon as the cumulative
 * size exceeds `max`. Returns "too_large" rather than buffering the rest, so
 * an oversized (or unbounded chunked) upload can never be fully materialised
 * in memory. Empty/absent body yields a zero-length Buffer.
 */
async function readBodyCapped(
  req: NextRequest,
  max: number,
): Promise<Buffer | "too_large"> {
  const body = req.body;
  if (body === null) {
    // No stream — fall back to the (already-cheap) arrayBuffer path; the
    // Content-Length guard above bounded it, and a null body is empty.
    const ab = await req.arrayBuffer();
    if (ab.byteLength > max) return "too_large";
    return Buffer.from(ab);
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) {
        try {
          await reader.cancel();
        } catch {
          /* best-effort */
        }
        return "too_large";
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

