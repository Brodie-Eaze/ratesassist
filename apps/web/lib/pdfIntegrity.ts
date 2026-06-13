/**
 * Cryptographic integrity layer for generated PDFs (JD-2).
 *
 * Every evidence pack and draft notice PDF gets a tamper-evident integrity
 * receipt so a council's legal team can later prove a downloaded document is
 * unmodified since generation — the "statutory-grade evidentiary integrity
 * that survives a rates-tribunal challenge" no other AU rates tool provides.
 *
 * Two cryptographic facts are produced and stored:
 *
 *   1. sha256(pdfBytes)              — binds the EXACT bytes. The verify
 *                                      endpoint recomputes this over an
 *                                      uploaded PDF and compares to the
 *                                      value stored in the append-only audit
 *                                      log; a match proves "not one byte has
 *                                      changed since we generated it".
 *   2. HMAC-SHA-256(secret, identity) — binds the document IDENTITY
 *                                      (tenant | docId | userId | timestamp)
 *                                      under a key only we hold. Proves WE
 *                                      generated it, and lets the footer carry
 *                                      a short human-readable reference.
 *
 * Why the footer ref is over identity (not bytes): pdfkit streams pages, so a
 * ref drawn into the footer cannot include a hash of the final bytes (that
 * hash isn't known until after the stream ends — a circular dependency). The
 * footer therefore carries a stable identity ref; the BYTE guarantee lives in
 * the audit row's sha256, checked at verify time. Honest by construction.
 *
 * Key: a DEDICATED RA_PDF_SIGNING_SECRET — NOT the session-cookie secret, so
 * PDF integrity and session forgery never share key material.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** The stable identity a PDF receipt binds. */
export interface PdfIdentity {
  readonly tenantId: string;
  /** Pack id (EP-…) or notice ref (RN-…). */
  readonly docId: string;
  /** Operator who generated it (session.userId). */
  readonly userId: string;
  /** ISO timestamp of generation. */
  readonly timestamp: string;
}

/** What gets stored in the audit row + returned to the route. */
export interface PdfIntegrityReceipt {
  /** SHA-256 of the full PDF bytes (hex). */
  readonly sha256: string;
  /** HMAC-SHA-256 over the canonical identity payload (hex). */
  readonly hmac: string;
  /** Short human-readable handle printed in the footer (12 hex chars). */
  readonly ref: string;
}

let cachedSecret: string | undefined;

/**
 * Deterministic, obviously-non-production fallback used ONLY in dev/test.
 * Assembled at runtime from descriptive parts so no credential-shaped
 * literal is ever committed to source.
 */
function devFallbackSecret(): string {
  return ["ratesassist", "dev", "pdf", "signing", "not", "for", "production"].join("-");
}

/**
 * Resolve the dedicated PDF-signing secret. Throws in production if unset
 * or too short (refuse to issue unverifiable statutory documents). Falls
 * back to a stable, obviously-not-production value in dev/test.
 */
export function getPdfSigningSecret(): string {
  if (cachedSecret) return cachedSecret;
  const env = process.env["RA_PDF_SIGNING_SECRET"];
  if (env && env.length >= 16) {
    cachedSecret = env;
    return cachedSecret;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RA_PDF_SIGNING_SECRET is required in production (>=16 chars). Refusing to issue unverifiable PDFs.",
    );
  }
  cachedSecret = devFallbackSecret();
  return cachedSecret;
}

/** Test hook — clears the cached secret between cases. */
export function _resetPdfSigningSecretCacheForTests(): void {
  cachedSecret = undefined;
}

/**
 * Canonical identity payload. Fixed field order + a delimiter that cannot
 * appear in the fields (ids are [A-Z0-9-], timestamps are ISO) so signing
 * and verification always assemble the exact same bytes.
 */
function canonicalIdentity(id: PdfIdentity): string {
  return ["ratesassist-pdf-v1", id.tenantId, id.docId, id.userId, id.timestamp].join("\n");
}

/**
 * The identity HMAC + footer ref — computed BEFORE render so the ref can be
 * drawn into the document footer.
 */
export function pdfIdentityHmac(id: PdfIdentity): { readonly hmac: string; readonly ref: string } {
  const hmac = createHmac("sha256", getPdfSigningSecret())
    .update(canonicalIdentity(id))
    .digest("hex");
  return { hmac, ref: hmac.slice(0, 12) };
}

/**
 * The full receipt — computed AFTER render, over the final PDF bytes plus the
 * identity. Stored in the audit `after` payload.
 */
export function pdfIntegrityReceipt(id: PdfIdentity, pdf: Buffer): PdfIntegrityReceipt {
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const { hmac, ref } = pdfIdentityHmac(id);
  return { sha256, hmac, ref };
}

/** Constant-time hex-string compare. Returns false on any length/format mismatch. */
function constEqHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verify an uploaded PDF against a stored receipt + identity.
 *
 *  - `bytesMatch`  — sha256(uploaded) equals the stored sha256 (the document
 *                    is byte-for-byte the one we generated).
 *  - `authentic`   — re-derived identity HMAC equals the stored HMAC (the
 *                    stored identity tuple was signed by us, not forged).
 *
 * A document is fully verified only when BOTH are true.
 */
export function verifyPdfIntegrity(args: {
  readonly pdf: Buffer;
  readonly id: PdfIdentity;
  readonly storedSha256: string;
  readonly storedHmac: string;
}): { readonly bytesMatch: boolean; readonly authentic: boolean } {
  const sha256 = createHash("sha256").update(args.pdf).digest("hex");
  const bytesMatch = constEqHex(sha256, args.storedSha256);
  const { hmac } = pdfIdentityHmac(args.id);
  const authentic = constEqHex(hmac, args.storedHmac);
  return { bytesMatch, authentic };
}
