/**
 * /api/verify/pack route tests (JD-2 — public document integrity).
 *
 * The verification round-trip is the cryptographic heart of the feature:
 *
 *   - generate an evidence PDF (writes the integrity receipt to the audit
 *     log) → POST the exact bytes back → verified: true.
 *   - flip a single byte → verified: false, result "modified".
 *   - unknown docId → result "no_record" (never falsely verifies).
 *   - malformed docId → 400.
 *
 * Generate + verify run in the same module realm, so the verify endpoint
 * reads the receipt the generate route wrote to the in-process audit buffer.
 */

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
process.env["RA_PDF_SIGNING_SECRET"] = "test-pdf-signing-secret-32chars!";
process.env["RA_TOOL_TRANSPORT"] = "inproc";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../lib/auth";
import { _resetPdfSigningSecretCacheForTests } from "../lib/pdfIntegrity";

vi.resetModules();
const { GET: pdfGET } = await import("../app/api/evidence/[file]/pdf/route");
const { POST: verifyPOST } = await import("../app/api/verify/pack/route");

beforeAll(() => {
  _resetAuthSecretCacheForTests();
  _resetPdfSigningSecretCacheForTests();
});

beforeEach(async () => {
  const inproc = await import("@ratesassist/adapter-demo/inproc");
  inproc._resetInproc();
  const audit = await import("@ratesassist/adapter-demo/audit");
  audit._resetForTests();
  const rl = await import("../lib/rate-limit");
  rl.__resetRateLimitBucketsForTests();
});

function freshSession(roles: Role[], tenantId = "TPS"): Session {
  const now = Date.now();
  return {
    userId: "u-verify-1",
    email: "u-verify-1@example.com",
    displayName: "Verify Test Officer",
    tenantId,
    roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
  };
}

function pdfReq(session: Session): NextRequest {
  const headers = new Headers();
  headers.set(SESSION_HEADER, JSON.stringify(session));
  return new NextRequest(
    new URL("http://localhost/api/evidence/TPS-1102-91/pdf"),
    { method: "GET", headers },
  );
}

function verifyReq(docId: string, body: Buffer): NextRequest {
  const headers = new Headers();
  headers.set("content-type", "application/pdf");
  return new NextRequest(
    new URL(`http://localhost/api/verify/pack?docId=${encodeURIComponent(docId)}`),
    { method: "POST", headers, body: new Uint8Array(body) },
  );
}

/** Generate a PDF + return its bytes and the docId from the audit receipt. */
async function generatePdf(): Promise<{ bytes: Buffer; docId: string }> {
  const res = await pdfGET(pdfReq(freshSession(["rates_officer"])), {
    params: Promise.resolve({ file: "TPS-1102-91" }),
  });
  expect(res.status).toBe(200);
  const bytes = Buffer.from(await res.arrayBuffer());
  const audit = await import("@ratesassist/adapter-demo/audit");
  const rows = audit.readRecent("TPS", 50);
  const row = rows.find((r) => r.action === "pdf.generated");
  expect(row).toBeDefined();
  return { bytes, docId: row!.targetId };
}

describe("POST /api/verify/pack", () => {
  it("verifies an unmodified generated PDF (verified: true)", async () => {
    const { bytes, docId } = await generatePdf();
    const res = await verifyPOST(verifyReq(docId, bytes));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { verified: boolean; result: string; document: { ref: string; generatedAt?: string } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.verified).toBe(true);
    expect(body.data.result).toBe("verified");
    expect(body.data.document.ref).toBe(docId);
    expect(typeof body.data.document.generatedAt).toBe("string");
  });

  it("rejects a tampered PDF (verified: false, modified)", async () => {
    const { bytes, docId } = await generatePdf();
    // Flip one byte in the middle of the document.
    const tampered = Buffer.from(bytes);
    const mid = Math.floor(tampered.length / 2);
    tampered[mid] = tampered[mid]! ^ 0xff;
    const res = await verifyPOST(verifyReq(docId, tampered));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { verified: boolean; result: string } };
    expect(body.data.verified).toBe(false);
    expect(body.data.result).toBe("modified");
  });

  it("returns no_record for an unknown (but well-formed) docId", async () => {
    const res = await verifyPOST(
      verifyReq("EP-TPS-9999-99-20260101", Buffer.from("%PDF-1.4 fake")),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { verified: boolean; result: string } };
    expect(body.data.verified).toBe(false);
    expect(body.data.result).toBe("no_record");
  });

  it("400s on a malformed docId", async () => {
    const res = await verifyPOST(verifyReq("not-a-valid-ref", Buffer.from("x")));
    expect(res.status).toBe(400);
  });

  it("400s on an empty body", async () => {
    const res = await verifyPOST(
      verifyReq("EP-TPS-1102-91-20260101", Buffer.alloc(0)),
    );
    expect(res.status).toBe(400);
  });

  it("does not verify a genuine PDF posted under a different document's ref", async () => {
    // Generate a real PDF, then claim it is a *notice* (RN-) it is not.
    const { bytes } = await generatePdf();
    const res = await verifyPOST(
      verifyReq("RN-TPS-1102-91-20260101", bytes),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { verified: boolean } };
    // No notice with that ref was generated → no_record, never verified.
    expect(body.data.verified).toBe(false);
  });
});
