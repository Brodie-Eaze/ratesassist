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
import { getClientIp, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { scoped } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tight public limit — verification is cheap but must not be a free oracle. */
const VERIFY_RATE_LIMIT = 10;
/** Max PDF the endpoint will hash (our PDFs are tens of KB; 8 MB is generous). */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** EP-<assessment>-<yyyymmdd> or RN-<assessment>-<yyyymmdd>. */
const DOC_ID_PATTERN = /^(EP|RN)-([A-Z]{2,5})-[A-Z0-9-]{1,40}-\d{8}$/;

type StoredReceipt = {
  readonly tenantId: string;
  readonly actorId: string;
  readonly targetType: string;
  readonly occurredAt: string;
  readonly after: {
    readonly generatedAt?: string;
    readonly pdfSha256?: string;
    readonly pdfHmac?: string;
    readonly assessmentNumber?: string;
  };
};

export async function POST(req: NextRequest): Promise<Response> {
  const correlationId = correlationIdFromHeaders(req.headers);
  const log = scoped("api/verify/pack", { correlationId });

  // ---- 1. Rate limit BEFORE any work (public endpoint). ----
  const ip = getClientIp(req);
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

  // ---- 3. Read body (the PDF bytes), size-capped. ----
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_PDF_BYTES) {
    return NextResponse.json(
      { ok: false, code: "payload_too_large", error: "PDF exceeds the verification size limit." },
      { status: 413 },
    );
  }
  let pdf: Buffer;
  try {
    const ab = await req.arrayBuffer();
    if (ab.byteLength === 0 || ab.byteLength > MAX_PDF_BYTES) {
      return NextResponse.json(
        { ok: false, code: "invalid_input", error: "Request body must be the PDF bytes." },
        { status: 400 },
      );
    }
    pdf = Buffer.from(ab);
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_input", error: "Could not read the request body." },
      { status: 400 },
    );
  }

  // ---- 4. Look up the stored receipt by docId within the derived tenant. ----
  let receipt: StoredReceipt | null;
  try {
    receipt = await loadStoredReceipt(tenant, docId);
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
    return ok({
      verified: false,
      result: "no_record",
      message: "No matching generation record was found for this document reference.",
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

  return ok({
    verified,
    result: verified ? "verified" : "modified",
    message: verified
      ? "This document is byte-for-byte the one RatesAssist generated and has not been modified since."
      : "This document does not match the record at generation time — it may have been modified.",
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
 * Load the generation receipt for `docId` within `tenant`.
 *
 * The generate routes (pdf + notice) record their integrity receipt via the
 * adapter-demo audit store's recordMutation — so verification reads from that
 * exact store, guaranteeing it sees what generation wrote. Returns null when
 * no matching row exists.
 *
 * Durability caveat: the adapter-demo store is in-process (ring-buffered,
 * per-task). For the pilot (single task) this is sufficient and matches the
 * existing pdf.generated rows' durability; a multi-task production deployment
 * would persist these receipts to a shared store — tracked as a follow-up.
 */
async function loadStoredReceipt(
  tenant: string,
  docId: string,
): Promise<StoredReceipt | null> {
  const audit = await import("@ratesassist/adapter-demo/audit");
  const rows = audit.readRecent(tenant, 5000);
  const row = rows.find(
    (r) =>
      r.targetId === docId &&
      (r.action === "pdf.generated" || r.action === "statutory_notice.drafted"),
  );
  if (row === undefined) return null;
  return {
    tenantId: row.tenantId,
    actorId: row.actorId,
    targetType: row.targetType,
    occurredAt: row.occurredAt,
    after: (row.after ?? {}) as StoredReceipt["after"],
  };
}
