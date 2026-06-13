/**
 * DR RESTORE DRILL — CI enforcement.
 *
 * Exercises the same backup → simulated-loss → restore → verify-chain flow
 * the runnable drill (scripts/dr-audit-restore-drill.ts) performs, so the
 * guarantee "a backup of the tamper-evident audit store can be restored and
 * the hash chain survives byte-identical" is regression-tested on every CI
 * run, not just when someone remembers to run the script by hand.
 *
 * We import `runDrill` from the script directly. The script guards its
 * `main()` behind an `invokedDirectly` check, so importing it does NOT spawn
 * the CLI side-effects — `runDrill` is a pure(ish) function that owns its own
 * in-memory pglite lifecycle (getDb + resetDbForTesting) and never calls
 * process.exit.
 *
 * Runs on the pglite path (no DATABASE_URL) so it is reproducible in CI with
 * zero cloud credentials — the same engine the audit-chain suite uses.
 */

import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { rmSync } from "node:fs";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
process.env["RA_TOOL_TRANSPORT"] = "inproc";

const { runDrill } = await import(
  "../../../scripts/dr-audit-restore-drill"
);

afterEach(() => {
  // Clean up the timestamped backup artefacts the drill writes under
  // reports/dr-drills so the test leaves no residue. Best-effort.
  try {
    rmSync(resolve(__dirname, "../../../reports/dr-drills"), {
      recursive: true,
      force: true,
    });
  } catch {
    /* ignore */
  }
});

describe("DR restore drill — audit chain survives backup/restore", () => {
  it("restores a 25-row chain and verifies ok:true with matching head", async () => {
    const result = await runDrill(25);

    // The store was genuinely emptied before restore.
    expect(result.postLossRows).toBe(0);

    // Every row came back.
    expect(result.preLossRows).toBe(25);
    expect(result.restoredRows).toBe(25);
    expect(result.postRestoreRows).toBe(25);

    // The chain verifies after restore with no break.
    expect(result.verifyOk).toBe(true);
    expect(result.brokenAt).toBeNull();

    // The restored chain head hash is byte-identical to pre-loss — proves the
    // recorded hashes round-tripped, not just the row count.
    expect(result.postRestoreHead).toBe(result.preLossHead);
    expect(result.postRestoreHead).toMatch(/^[0-9a-f]{64}$/);

    // Negative control: tampering a restored row is still detected — the
    // restored chain is genuinely tamper-evident, not merely re-readable.
    expect(result.tamperDetected).toBe(true);

    // Overall verdict.
    expect(result.pass).toBe(true);
  });

  it("is idempotent — a second run on a fresh DB also passes", async () => {
    const result = await runDrill(10);
    expect(result.pass).toBe(true);
    expect(result.verifyOk).toBe(true);
    expect(result.postRestoreHead).toBe(result.preLossHead);
  });
});
