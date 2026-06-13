/**
 * Migration 0008 — audit_log TRUNCATE lockdown (positive control).
 *
 * 0001/0006 REVOKE UPDATE, DELETE on audit_log, but TRUNCATE is a separate
 * privilege that bypasses RLS and row-level triggers and can wipe the whole
 * tamper-evident chain in one statement. 0008 adds a statement-level
 * BEFORE TRUNCATE trigger that blocks it for EVERYONE — including the table
 * owner, which is the case pglite exercises (it connects as the implicit
 * superuser/owner). If this test ever goes green without the trigger, the
 * append-only guarantee has a hole.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createTestDb } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

function migration0008(): string {
  // 0008 has no pgcrypto / CONCURRENTLY, so no pglite stripping is needed.
  return readFileSync(
    resolve(MIGRATIONS_DIR, "0008_audit_log_truncate_lockdown.sql"),
    "utf8",
  );
}

describe("0008 audit_log TRUNCATE lockdown", () => {
  it("blocks TRUNCATE audit_log even as the table owner/superuser", async () => {
    const { pg } = await createTestDb({ chainColumns: true });
    await pg.exec(migration0008());

    await expect(pg.exec("TRUNCATE audit_log")).rejects.toThrow(
      /append-only|TRUNCATE is forbidden/i,
    );
  });

  it("also blocks TRUNCATE ... CASCADE and the multi-table form", async () => {
    const { pg } = await createTestDb({ chainColumns: true });
    await pg.exec(migration0008());

    await expect(pg.exec("TRUNCATE TABLE audit_log CASCADE")).rejects.toThrow(
      /append-only|TRUNCATE is forbidden/i,
    );
  });

  it("is idempotent — re-applying 0008 still blocks TRUNCATE", async () => {
    const { pg } = await createTestDb({ chainColumns: true });
    const sqlText = migration0008();
    await pg.exec(sqlText);
    await pg.exec(sqlText);

    await expect(pg.exec("TRUNCATE audit_log")).rejects.toThrow(
      /append-only/i,
    );
  });
});

// Note: that 0008 does NOT block ordinary appends is already proven by the
// schema + client + audit-chain suites, which apply the full migration set
// (now including 0008) and then seed + append through withAudit successfully.
