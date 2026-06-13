-- 0009_pdf_integrity_receipt.sql
--
-- RA-L3-01 / RA-L3-04 (gauntlet loop 3): durable, shared store for the JD-2
-- PDF integrity receipt.
--
-- The receipt (SHA-256 of the PDF bytes + identity HMAC) was previously held
-- only in the per-task in-memory audit buffer. In the production ECS topology
-- (desired=2, autoscale 2..8 behind an ALB) a /api/verify/pack request is
-- load-balanced to a task that did NOT generate the PDF, finds no receipt, and
-- reports a genuine unmodified document as `not_verified` — i.e. brands an
-- authentic statutory document as forged. The in-memory store also loses every
-- receipt on redeploy/restart and FIFO-evicts at 10k entries.
--
-- This table is the durable lookup index that makes verification correct
-- across tasks and restarts. It is intentionally a SIMPLE lookup table, not
-- part of the hash-chained audit_log:
--   * keyed by the globally-unique doc_id (EP-/RN-<assessment>-<yyyymmdd>), so
--     the public verify endpoint needs no tenant-UUID resolution;
--   * stores no PII (only hashes, the council CODE, the actor id, timestamps);
--   * the audit TRAIL of "a PDF was generated" still lives in audit_log via the
--     existing pdf.generated / statutory_notice.drafted events — this table is
--     only the verify index.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS pdf_integrity_receipt (
  doc_id            text PRIMARY KEY,
  tenant_code       text        NOT NULL,
  actor_id          text        NOT NULL,
  doc_type          text        NOT NULL,
  generated_at      text        NOT NULL,
  pdf_sha256        text        NOT NULL,
  pdf_hmac          text        NOT NULL,
  assessment_number text,
  occurred_at       timestamptz NOT NULL DEFAULT now()
);

-- The doc_id PK already provides the single lookup path the verify endpoint
-- uses (WHERE doc_id = $1). A secondary index on tenant_code supports future
-- per-council receipt reporting without a scan.
CREATE INDEX IF NOT EXISTS pdf_integrity_receipt_tenant_idx
  ON pdf_integrity_receipt (tenant_code);

-- Deliberately NO Row-Level Security on this table: the verify endpoint is
-- public and looks up by the unguessable doc_id (which IS the capability), the
-- stored columns carry no PII, and a missing-RLS-policy table under the
-- NOBYPASSRLS serving role would otherwise be unreadable. Receipts are
-- effectively append-only in practice (one upsert per generated document);
-- we do not REVOKE UPDATE/DELETE because, unlike the audit chain, this index
-- carries no tamper-evidence claim of its own — the HMAC + the audit_log event
-- are the integrity anchors.
