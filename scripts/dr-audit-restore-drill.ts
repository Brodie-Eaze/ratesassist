#!/usr/bin/env tsx
/**
 * scripts/dr-audit-restore-drill.ts
 *
 * DR RESTORE DRILL — tamper-evident audit chain.
 * ----------------------------------------------
 * The audit_log hash chain is RatesAssist's compliance-critical durable
 * store (7-year retention; WA Local Government Act 1995 + State Records Act
 * 2000 — see internal/OBSERVABILITY.md §Retention). A backup that cannot be
 * restored is not a backup. This drill PROVES that a backup of the audit
 * store can be restored and that the hash chain survives the round-trip
 * byte-identical: `verifyChain` returns ok:true with no brokenAt.
 *
 * What it does (idempotent — fresh in-memory pglite every run):
 *   1. SEED      — bootstrap a pglite DB (migrations 0001..0005 via
 *                  ensureSchema), insert a tenant, drive N audit writes
 *                  (withAudit + recordAuditEvent), confirm the live chain
 *                  verifies ok:true. This is the "production" state.
 *   2. BACKUP    — dump every audit_log row (including prev_hash/row_hash and
 *                  the exact occurred_at instant) to an in-memory snapshot
 *                  AND to a timestamped JSON artefact under reports/ so the
 *                  drill leaves physical evidence.
 *   3. LOSE      — simulate catastrophic data loss (dropped table / wiped
 *                  volume / corrupted page) on the durable store. audit_log
 *                  carries a BEFORE TRUNCATE guard (migration 0008) so an
 *                  attacker cannot wipe the whole chain in one statement; a
 *                  raw volume loss respects no such app-level guard, so the
 *                  drill lowers the guard AS THE OWNER (the escape hatch
 *                  0008's own error message documents), TRUNCATEs, then
 *                  re-arms it before restore. Assert the store is empty. This
 *                  also proves the documented owner escape hatch works.
 *   4. RESTORE   — re-INSERT every row from the snapshot, preserving id,
 *                  occurred_at, prev_hash and row_hash EXACTLY. A restore
 *                  that re-derived hashes would mask corruption — we restore
 *                  the recorded bytes and re-verify them independently.
 *   5. VERIFY    — re-read the restored rows in chain order and run the SAME
 *                  verifyChain the /api/audit/verify-chain route uses. The
 *                  drill PASSES iff: ok:true, no brokenAt, row count matches
 *                  pre-loss, and the chain head (latest row_hash) matches
 *                  pre-loss. A negative control then tampers one restored row
 *                  and confirms the verifier still catches it post-restore.
 *
 * Why pglite: this is the SAME engine the audit tests and the dev/CI path
 * use (packages/db falls back to pglite when DATABASE_URL is unset). It makes
 * the drill fully reproducible with zero cloud credentials. The production
 * restore procedure (pg_dump / managed-Postgres PITR → this same verify step)
 * is documented in the dated artefact this drill writes; the verification
 * LOGIC is identical because `verifyChain` is driver-agnostic.
 *
 * Usage:
 *   npm run dr:audit-drill            # default 50 rows
 *   RA_DRILL_ROWS=500 npm run dr:audit-drill
 *
 * Exit code 0 on PASS, 1 on FAIL — CI-friendly.
 *
 * Cross-reference:
 *   - INCIDENT-RESPONSE-RUNBOOK.md §4.4 (recover: restore from clean backup)
 *   - internal/PRODUCTION-CHECKLIST.md §1 (Audit log: chain verified)
 *   - internal/DR-RESTORE-DRILL-2026-05-29.md (dated drill artefact)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifyChain,
  type AuditRowWithHashes,
} from "@ratesassist/audit-core";
import {
  ensureSchema,
  getDb,
  resetDbForTesting,
  recordAuditEvent,
  withAudit,
  tenants,
  sql,
} from "@ratesassist/db";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Raw audit_log row shape as it comes back from `execute(sql\`SELECT ...\`)`. */
interface RawAuditRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly actor_kind: string;
  readonly action: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly correlation_id: string | null;
  readonly ip: string | null;
  readonly user_agent: string | null;
  readonly occurred_at: string | Date;
  readonly prev_hash: string | null;
  readonly row_hash: string | null;
}

/** A point-in-time backup of the audit store: ordered, with every byte kept. */
interface AuditBackup {
  readonly takenAt: string;
  readonly tenantId: string;
  readonly rowCount: number;
  /** row_hash of the chain head at backup time (last row in chain order). */
  readonly chainHead: string | null;
  readonly rows: ReadonlyArray<RawAuditRow>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

function log(step: string, detail: Record<string, unknown> = {}): void {
  // Structured, one-line JSON — same posture as the app logger so a CI log
  // collector can index drill runs.
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: "info",
      scope: "dr.audit-restore-drill",
      step,
      time: new Date().toISOString(),
      ...detail,
    }),
  );
}

function toIso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/** Hydrate a raw DB row into the shape `verifyChain` expects. */
function hydrate(r: RawAuditRow): AuditRowWithHashes {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    actorId: r.actor_id,
    actorKind: r.actor_kind,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    before: r.before ?? null,
    after: r.after ?? null,
    correlationId: r.correlation_id ?? null,
    ip: r.ip ?? null,
    userAgent: r.user_agent ?? null,
    occurredAt: toIso(r.occurred_at),
    prevHash: r.prev_hash ?? "",
    rowHash: r.row_hash ?? "",
  };
}

async function selectChainOrdered(
  db: AnyDb,
  tenantId: string,
): Promise<RawAuditRow[]> {
  const raw = await db.execute(sql`
    SELECT id, tenant_id, actor_id, actor_kind::text AS actor_kind,
           action, target_type, target_id, before, after,
           correlation_id, ip, user_agent, occurred_at,
           prev_hash, row_hash
      FROM audit_log
     WHERE tenant_id = ${tenantId}
     ORDER BY occurred_at ASC, id ASC
  `);
  return (raw.rows ?? raw) as RawAuditRow[];
}

/** STEP 1 — build a realistic chain. Returns the tenant id + live row count. */
async function seedProductionState(
  db: AnyDb,
  rowCount: number,
): Promise<{ tenantId: string }> {
  const [t] = await db
    .insert(tenants)
    .values({
      code: "DRILL",
      name: "DR Drill Council",
      state: "WA",
      centerLat: -31.95,
      centerLng: 115.86,
      population: 12_000,
      rateableProperties: 5_400,
      rateRevenue: "8400000.00",
    })
    .returning();
  const tenantId = t!.id as string;

  // A mix of withAudit (before/after mutations) and recordAuditEvent
  // (point events) so the restored chain exercises both writers.
  for (let i = 0; i < rowCount; i++) {
    if (i % 5 === 0) {
      await recordAuditEvent(
        db,
        {
          tenantId,
          actorId: "drill-service",
          actorKind: "service",
          correlationId: `drill-evt-${i}`,
        },
        `drill.event.${i}`,
        { type: "system", id: "drill" },
        { tick: i },
      );
    } else {
      await withAudit(
        db,
        {
          tenantId,
          actorId: "drill-officer",
          actorKind: "user",
          correlationId: `drill-mut-${i}`,
        },
        `drill.mutation.${i}`,
        { type: "tenant", id: tenantId, read: async () => ({ step: i }) },
        async () => undefined,
      );
    }
  }
  return { tenantId };
}

/** STEP 2 — snapshot every row, preserving hash columns + timestamps. */
async function backup(db: AnyDb, tenantId: string): Promise<AuditBackup> {
  const rows = await selectChainOrdered(db, tenantId);
  const head = rows.length > 0 ? (rows[rows.length - 1]!.row_hash ?? null) : null;
  return {
    takenAt: new Date().toISOString(),
    tenantId,
    rowCount: rows.length,
    chainHead: head,
    rows,
  };
}

/**
 * STEP 3 — catastrophic loss. Returns the post-loss row count (must be 0).
 *
 * audit_log carries a BEFORE TRUNCATE guard (migration 0008) that blocks
 * TRUNCATE as a tamper-evidence control: no single statement may wipe the
 * chain. A real catastrophic loss (dropped table / wiped volume / corrupted
 * page) does not respect that app-level guard, so to SIMULATE it we
 * deliberately lower the guard as the table owner — precisely the escape
 * hatch migration 0008's own error message documents — TRUNCATE, then
 * immediately re-arm the guard inside a finally so the restored chain is
 * protected again even if the wipe throws. `DISABLE/ENABLE TRIGGER USER`
 * targets all user triggers, so it stays correct regardless of the guard's
 * exact name. This step doubles as proof the documented escape hatch works.
 */
async function simulateDataLoss(db: AnyDb): Promise<number> {
  await db.execute(sql`ALTER TABLE audit_log DISABLE TRIGGER USER`);
  try {
    await db.execute(sql`TRUNCATE TABLE audit_log`);
  } finally {
    await db.execute(sql`ALTER TABLE audit_log ENABLE TRIGGER USER`);
  }
  const raw = await db.execute(sql`SELECT count(*)::int AS n FROM audit_log`);
  const rows = (raw.rows ?? raw) as Array<{ n: number }>;
  return rows[0]?.n ?? -1;
}

/**
 * STEP 4 — restore. Re-insert every backed-up row preserving id,
 * occurred_at, prev_hash and row_hash EXACTLY. We deliberately do NOT route
 * through withAudit here — that would re-derive fresh hashes and defeat the
 * point. A real restore replays recorded bytes; this mirrors `pg_restore`
 * / a PITR snapshot loading the stored rows verbatim.
 */
async function restore(db: AnyDb, backup: AuditBackup): Promise<number> {
  let restored = 0;
  for (const r of backup.rows) {
    const beforeJson = r.before === null ? null : JSON.stringify(r.before);
    const afterJson = r.after === null ? null : JSON.stringify(r.after);
    await db.execute(sql`
      INSERT INTO audit_log
        (id, tenant_id, actor_id, actor_kind, action, target_type, target_id,
         before, after, correlation_id, ip, user_agent, occurred_at,
         prev_hash, row_hash)
      VALUES (
        ${r.id}, ${r.tenant_id}, ${r.actor_id}, ${r.actor_kind}::actor_kind,
        ${r.action}, ${r.target_type}, ${r.target_id},
        ${beforeJson}::jsonb, ${afterJson}::jsonb,
        ${r.correlation_id}, ${r.ip}, ${r.user_agent},
        ${toIso(r.occurred_at)}::timestamptz,
        ${r.prev_hash}, ${r.row_hash}
      )
    `);
    restored += 1;
  }
  return restored;
}

/** Write the in-memory backup to a timestamped JSON artefact under reports/. */
function persistBackupArtefact(b: AuditBackup): string {
  const dir = resolve(__dirname, "../reports/dr-drills");
  mkdirSync(dir, { recursive: true });
  const stamp = b.takenAt.replace(/[:.]/g, "-");
  const file = resolve(dir, `audit-backup-${stamp}.json`);
  writeFileSync(file, JSON.stringify(b, null, 2), "utf8");
  return file;
}

interface DrillResult {
  readonly pass: boolean;
  readonly preLossRows: number;
  readonly preLossHead: string | null;
  readonly postLossRows: number;
  readonly restoredRows: number;
  readonly postRestoreRows: number;
  readonly postRestoreHead: string | null;
  readonly verifyOk: boolean;
  readonly brokenAt: number | null;
  readonly tamperDetected: boolean;
  readonly backupArtefact: string;
}

export async function runDrill(rowCount: number): Promise<DrillResult> {
  // Force the pglite path: no DATABASE_URL → in-memory WASM Postgres.
  delete process.env.DATABASE_URL;
  resetDbForTesting();
  const db = getDb() as AnyDb;
  await ensureSchema(db);

  log("seed.start", { rowCount });
  const { tenantId } = await seedProductionState(db, rowCount);

  // Confirm the LIVE chain is healthy before we touch anything.
  const live = await selectChainOrdered(db, tenantId);
  const liveVerdict = verifyChain(live.map(hydrate));
  if (!liveVerdict.ok) {
    throw new Error(
      `pre-condition failed: live chain does not verify (brokenAt=${liveVerdict.firstBreakIndex}); drill is invalid`,
    );
  }
  log("seed.ok", { rows: live.length, liveVerifyOk: true });

  log("backup.start");
  const snapshot = await backup(db, tenantId);
  const artefact = persistBackupArtefact(snapshot);
  log("backup.ok", {
    rows: snapshot.rowCount,
    chainHead: snapshot.chainHead,
    artefact,
  });

  log("loss.start");
  const postLossRows = await simulateDataLoss(db);
  if (postLossRows !== 0) {
    throw new Error(
      `data-loss simulation failed: expected 0 rows after TRUNCATE, saw ${postLossRows}`,
    );
  }
  log("loss.ok", { postLossRows });

  log("restore.start");
  const restoredRows = await restore(db, snapshot);
  log("restore.ok", { restoredRows });

  log("verify.start");
  const restoredRaw = await selectChainOrdered(db, tenantId);
  const verdict = verifyChain(restoredRaw.map(hydrate));
  const postRestoreHead =
    restoredRaw.length > 0
      ? (restoredRaw[restoredRaw.length - 1]!.row_hash ?? null)
      : null;
  const verifyOk = verdict.ok;
  const brokenAt = verdict.ok ? null : verdict.firstBreakIndex;

  // Core assertions: chain verifies, counts match, head hash matches.
  const countsMatch = restoredRaw.length === snapshot.rowCount;
  const headMatches = postRestoreHead === snapshot.chainHead;

  log("verify.result", {
    verifyOk,
    brokenAt,
    postRestoreRows: restoredRaw.length,
    preLossRows: snapshot.rowCount,
    countsMatch,
    headMatches,
  });

  // Negative control: tamper one restored row, confirm the verifier STILL
  // catches it after a restore. Proves the restored chain is genuinely
  // tamper-evident, not merely re-readable.
  let tamperDetected = false;
  if (restoredRaw.length >= 3) {
    const victim = restoredRaw[2]!;
    await db.execute(sql`
      UPDATE audit_log SET after = '{"dr_tampered":true}'::jsonb WHERE id = ${victim.id}
    `);
    const tamperedRaw = await selectChainOrdered(db, tenantId);
    const tamperVerdict = verifyChain(tamperedRaw.map(hydrate));
    tamperDetected = !tamperVerdict.ok && tamperVerdict.firstBreakIndex === 2;
    log("negative-control.result", {
      tamperDetected,
      brokenAt: tamperVerdict.ok ? null : tamperVerdict.firstBreakIndex,
    });
  }

  const pass =
    verifyOk && brokenAt === null && countsMatch && headMatches && tamperDetected;

  return {
    pass,
    preLossRows: snapshot.rowCount,
    preLossHead: snapshot.chainHead,
    postLossRows,
    restoredRows,
    postRestoreRows: restoredRaw.length,
    postRestoreHead,
    verifyOk,
    brokenAt,
    tamperDetected,
    backupArtefact: artefact,
  };
}

async function main(): Promise<void> {
  const rowCount = Number(process.env["RA_DRILL_ROWS"] ?? 50);
  const result = await runDrill(Number.isFinite(rowCount) && rowCount > 0 ? rowCount : 50);

  const sep = "=".repeat(72);
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(sep);
  // eslint-disable-next-line no-console
  console.log("  DR RESTORE DRILL — tamper-evident audit chain");
  // eslint-disable-next-line no-console
  console.log(sep);
  // eslint-disable-next-line no-console
  console.log(`  pre-loss rows        : ${result.preLossRows}`);
  // eslint-disable-next-line no-console
  console.log(`  pre-loss chain head  : ${result.preLossHead}`);
  // eslint-disable-next-line no-console
  console.log(`  post-loss rows       : ${result.postLossRows}  (expected 0)`);
  // eslint-disable-next-line no-console
  console.log(`  restored rows        : ${result.restoredRows}`);
  // eslint-disable-next-line no-console
  console.log(`  post-restore rows    : ${result.postRestoreRows}`);
  // eslint-disable-next-line no-console
  console.log(`  post-restore head    : ${result.postRestoreHead}`);
  // eslint-disable-next-line no-console
  console.log(`  chain verify ok      : ${result.verifyOk}  (brokenAt=${result.brokenAt})`);
  // eslint-disable-next-line no-console
  console.log(`  tamper still caught  : ${result.tamperDetected}  (negative control)`);
  // eslint-disable-next-line no-console
  console.log(`  backup artefact      : ${result.backupArtefact}`);
  // eslint-disable-next-line no-console
  console.log(sep);
  // eslint-disable-next-line no-console
  console.log(`  VERDICT: ${result.pass ? "PASS — chain survived restore intact" : "FAIL — see fields above"}`);
  // eslint-disable-next-line no-console
  console.log(sep);
  // eslint-disable-next-line no-console
  console.log("");

  resetDbForTesting();
  process.exit(result.pass ? 0 : 1);
}

// Only run when invoked directly (not when imported by the vitest harness).
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: "error",
        scope: "dr.audit-restore-drill",
        step: "fatal",
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      }),
    );
    process.exit(1);
  });
}
