/**
 * Durable PDF integrity-receipt store (JD-2 / RA-L3-01, RA-L3-04).
 *
 * The JD-2 receipt (SHA-256 of the PDF bytes + identity HMAC) must be readable
 * by ANY task that serves a /api/verify/pack request, not just the task that
 * generated the PDF. The earlier implementation wrote it only to the per-task
 * in-memory audit buffer, so in the production ECS topology (desired=2,
 * autoscale 2..8) a verify request load-balanced to a different task found no
 * receipt and reported a genuine document as `not_verified` — branding an
 * authentic statutory document as forged. It also lost every receipt on
 * restart and FIFO-evicted at 10k.
 *
 * This module is the single read/write surface for receipts:
 *  - {@link persistPdfReceipt} writes the audit-trail event (always) AND, when
 *    a real DB is wired, upserts the receipt into the durable
 *    `pdf_integrity_receipt` table (shared across tasks, survives restart).
 *  - {@link loadPdfReceipt} reads from the durable table when wired, falling
 *    back to the in-memory buffer for local/demo (no-DB) runs.
 *
 * The audit TRAIL of "a PDF was generated" still lives in the hash-chained
 * `audit_log` via the existing `pdf.generated` / `statutory_notice.drafted`
 * events — this table is purely the verify lookup index.
 */

import { isDbWired } from "./db";
import { scoped } from "./logger";

const log = scoped("pdf.receipt-store");

export type PdfReceiptDocType = "evidence_pack" | "statutory_notice";
export type PdfReceiptAction = "pdf.generated" | "statutory_notice.drafted";

export interface PersistPdfReceiptArgs {
  readonly tenantCode: string;
  readonly actorId: string;
  readonly docType: PdfReceiptDocType;
  readonly action: PdfReceiptAction;
  readonly docId: string;
  readonly assessmentNumber: string;
  readonly operatorName: string;
  readonly generatedAt: string;
  readonly pdfSha256: string;
  readonly pdfHmac: string;
  readonly correlationId?: string;
  readonly ip?: string;
  readonly userAgent?: string;
}

/** Shape the verify endpoint consumes (mirrors the in-memory AuditEntry slice). */
export interface LoadedReceipt {
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
}

/**
 * Persist a generation receipt. Best-effort on every path — a receipt-write
 * failure never fails the PDF download (the document is still valid; only
 * later verification would be affected, and that degrades to `not_verified`,
 * not to a wrong-positive).
 */
export async function persistPdfReceipt(args: PersistPdfReceiptArgs): Promise<void> {
  // 1. Audit-trail event (in-memory adapter store) — also the demo-mode
  //    fallback that loadPdfReceipt reads when no DB is wired.
  try {
    const audit = await import("@ratesassist/adapter-demo/audit");
    audit.recordMutation({
      tenantId: args.tenantCode,
      actorId: args.actorId,
      actorKind: "user",
      action: args.action,
      target: { type: args.docType, id: args.docId },
      after: {
        assessmentNumber: args.assessmentNumber,
        operatorName: args.operatorName,
        generatedAt: args.generatedAt,
        pdfSha256: args.pdfSha256,
        pdfHmac: args.pdfHmac,
      },
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      ...(args.ip !== undefined ? { ip: args.ip } : {}),
      ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
    });
  } catch {
    // Non-fatal — the audit module logs its own failures.
  }

  // 2. Durable upsert (shared across tasks) when a real DB is wired. Latest
  //    generation wins: regenerating a document (fresh timestamp → fresh
  //    bytes → fresh sha256) supersedes the prior copy, which is the correct
  //    semantics for the authoritative current statutory document.
  if (!isDbWired()) return;
  try {
    const { getWebDb } = await import("./db");
    const { pdfIntegrityReceipts } = await import("@ratesassist/db");
    const db = await getWebDb();
    await db
      .insert(pdfIntegrityReceipts)
      .values({
        docId: args.docId,
        tenantCode: args.tenantCode,
        actorId: args.actorId,
        docType: args.docType,
        generatedAt: args.generatedAt,
        pdfSha256: args.pdfSha256,
        pdfHmac: args.pdfHmac,
        assessmentNumber: args.assessmentNumber,
      })
      .onConflictDoUpdate({
        target: pdfIntegrityReceipts.docId,
        set: {
          tenantCode: args.tenantCode,
          actorId: args.actorId,
          docType: args.docType,
          generatedAt: args.generatedAt,
          pdfSha256: args.pdfSha256,
          pdfHmac: args.pdfHmac,
          assessmentNumber: args.assessmentNumber,
        },
      });
  } catch (e) {
    log.warn({
      msg: "receipt.durable_write_failed",
      docId: args.docId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Load a generation receipt by doc id. Reads the durable table when a DB is
 * wired (correct across tasks + restarts); otherwise reads the in-memory
 * buffer (local/demo). Returns null when no matching receipt exists.
 */
export async function loadPdfReceipt(
  tenantCode: string,
  docId: string,
): Promise<LoadedReceipt | null> {
  if (isDbWired()) {
    try {
      const { getWebDb } = await import("./db");
      const { pdfIntegrityReceipts, eq } = await import("@ratesassist/db");
      const db = await getWebDb();
      const rows = await db
        .select()
        .from(pdfIntegrityReceipts)
        .where(eq(pdfIntegrityReceipts.docId, docId))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      return {
        tenantId: row.tenantCode,
        actorId: row.actorId,
        targetType: row.docType,
        occurredAt: row.occurredAt.toISOString(),
        after: {
          generatedAt: row.generatedAt,
          pdfSha256: row.pdfSha256,
          pdfHmac: row.pdfHmac,
          ...(row.assessmentNumber !== null
            ? { assessmentNumber: row.assessmentNumber }
            : {}),
        },
      };
    } catch (e) {
      log.warn({
        msg: "receipt.durable_read_failed",
        docId,
        error: e instanceof Error ? e.message : String(e),
      });
      // Fall through to the in-memory read so a transient DB blip degrades to
      // the local buffer rather than a hard 500.
    }
  }

  const audit = await import("@ratesassist/adapter-demo/audit");
  const rows = audit.readRecent(tenantCode, 5000);
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
    after: (row.after ?? {}) as LoadedReceipt["after"],
  };
}
