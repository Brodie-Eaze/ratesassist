/**
 * RTBF / right-to-erasure tests — Privacy Act 1988 (Cth) APP 11.2.
 *
 * Proves the erasure flow `POST /api/privacy/erasure` → `eraseOwnerData`
 * actually destroys a data subject's PII at the store the read tools serve
 * (`get_owner`, `search_by_owner`), records a tamper-evident audit row WITHOUT
 * re-introducing the erased values, is idempotent, is permissioned, and is
 * correctly tenant-scoped (the shared-owner decision).
 *
 * Transport: in-proc, so the route's tool dispatch and our assertions share
 * one DataStore + one audit buffer (the stdio child would have its own realm).
 * No DATABASE_URL is set, so `isDbWired()` is false and the run exercises the
 * in-memory store + in-memory hash chain — the same realm the harness resets
 * in `beforeEach`. The DB leg (per-tenant `owners` rows under `withAudit`) is
 * covered structurally by the service; this suite locks the behaviour the
 * Compliance criterion enumerates.
 *
 * Fixtures (from packages/adapter-demo seed):
 *   - O-WA-010 "John & Sarah Wilkins" — TPS only → SINGLE-council owner.
 *   - O-WA-001 "Pilbara Iron Holdings Pty Ltd" — TPS + ESH + ASH → SHARED.
 *
 * Australian English in copy/comments; do not "fix" "council"/"behaviour".
 */

import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
process.env["RA_TOOL_TRANSPORT"] = "inproc";

import type { Role, Session } from "@ratesassist/contract";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../lib/auth";

vi.resetModules();
const { POST: erasurePOST } = await import("../app/api/privacy/erasure/route");
const { runTool } = await import("../lib/tools");
const { ERASE_ACTION } = await import("../lib/privacy-erasure");

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

beforeEach(async () => {
  const inproc = await import("@ratesassist/adapter-demo/inproc");
  inproc._resetInproc();
  const audit = await import("@ratesassist/adapter-demo/audit");
  audit._resetForTests();
  // The erasure route now carries a 3/min composite rate limit (A6-NEW-02);
  // this suite fires more requests than that per window.
  const rl = await import("../lib/rate-limit");
  rl.__resetRateLimitBucketsForTests();
});

function session(roles: Role[], tenantId = "TPS"): Session {
  const now = Date.now();
  return {
    userId: "officer-1",
    email: "officer@council.example",
    displayName: "Privacy Officer",
    tenantId,
    roles,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  };
}

function req(body: unknown, s: Session | null): NextRequest {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (s) headers.set(SESSION_HEADER, JSON.stringify(s));
  return new NextRequest(new URL("http://localhost/api/privacy/erasure"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

type ErasureOkBody = {
  ok: true;
  data: {
    ownerId: string;
    erased: boolean;
    alreadyErased: boolean;
    shared: boolean;
    tenantsAffected: string[];
  };
};
type ErasureErrBody = { ok: false; code: string; error: string };

type OwnerView = {
  readonly ownerId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly postalAddress: string;
  readonly previousOwners: readonly unknown[];
};

/** Read an owner record through the same tool the chat/REST surface uses. */
async function getOwner(ownerId: string): Promise<OwnerView | null> {
  const r = await runTool("get_owner", { ownerId }, "t-get", {
    tenantId: "TPS",
    actorId: "tester",
    actorKind: "user",
  });
  if (!r.ok || r.data === undefined) return null;
  return (r.data as { owner: OwnerView }).owner;
}

describe("RTBF erasure — POST /api/privacy/erasure", () => {
  // ── (d) unauthorized role is refused ──────────────────────────────────────
  it("401 when no session", async () => {
    const res = await erasurePOST(req({ ownerId: "O-WA-010" }, null));
    expect(res.status).toBe(401);
  });

  it("403 for rates_officer (lacks write.user_management)", async () => {
    const res = await erasurePOST(
      req({ ownerId: "O-WA-010" }, session(["rates_officer"])),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErasureErrBody;
    expect(body.ok).toBe(false);
    expect(body.code).toBe("forbidden");
  });

  it("400 on missing/empty ownerId", async () => {
    const res = await erasurePOST(req({ ownerId: "" }, session(["council_admin"])));
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErasureErrBody;
    expect(body.code).toBe("invalid_input");
  });

  // ── (a) PII gone from get_owner + search_by_owner ────────────────────────
  it("council_admin erases a single-council owner; PII is gone from get_owner", async () => {
    // Pre-condition: the seed PII is present.
    const before = await getOwner("O-WA-010");
    expect(before).not.toBeNull();
    expect(before!.name).toBe("John & Sarah Wilkins");
    expect(before!.email).toBe("j.wilkins@example.com");
    expect(before!.phone).toBe("0408 121 884");

    const res = await erasurePOST(
      req({ ownerId: "O-WA-010" }, session(["council_admin"], "TPS")),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ErasureOkBody;
    expect(body.ok).toBe(true);
    expect(body.data.ownerId).toBe("O-WA-010");
    expect(body.data.erased).toBe(true);
    expect(body.data.alreadyErased).toBe(false);
    expect(body.data.shared).toBe(false);

    // Post-condition: contact PII crypto-shredded to tombstones; structural
    // linkage (ownerId) preserved so the rates roll stays referentially intact.
    const after = await getOwner("O-WA-010");
    expect(after).not.toBeNull();
    expect(after!.ownerId).toBe("O-WA-010"); // linkage preserved
    expect(after!.name).toBe("[erased]");
    expect(after!.email).toBeNull();
    expect(after!.phone).toBeNull();
    expect(after!.postalAddress).toBe("[erased]");
    expect(after!.previousOwners).toEqual([]);
    // The original PII must be absent everywhere in the record.
    const blob = JSON.stringify(after);
    expect(blob).not.toContain("Wilkins");
    expect(blob).not.toContain("j.wilkins@example.com");
    expect(blob).not.toContain("0408 121 884");
    expect(blob).not.toContain("Stadium Road");
  });

  it("search_by_owner no longer finds the erased owner by their old name", async () => {
    // Sanity: the owner is findable by name before erasure.
    const pre = await runTool("search_by_owner", { name: "Wilkins" }, "s-pre", {
      tenantId: "TPS",
      actorId: "tester",
      actorKind: "user",
    });
    expect(pre.ok).toBe(true);
    expect((pre.data as { matches: unknown[] }).matches.length).toBeGreaterThanOrEqual(1);

    await erasurePOST(req({ ownerId: "O-WA-010" }, session(["council_admin"], "TPS")));

    // After erasure the tombstoned name no longer matches the old surname, so
    // the owner is unfindable by it: zero property matches. (The narration
    // echoes the *caller's* query string, which is not stored PII, so we
    // assert on the structured match set, the authoritative result.)
    const post = await runTool("search_by_owner", { name: "Wilkins" }, "s-post", {
      tenantId: "TPS",
      actorId: "tester",
      actorKind: "user",
    });
    expect(post.ok).toBe(true);
    expect((post.data as { matches: unknown[] }).matches.length).toBe(0);

    // And searching the erased TPS property by address still renders the
    // owner column as the tombstone — never the old contact PII.
    const byTombstone = await runTool(
      "search_by_owner",
      { name: "[erased]" },
      "s-tomb",
      { tenantId: "TPS", actorId: "tester", actorKind: "user" },
    );
    expect(byTombstone.ok).toBe(true);
    expect(byTombstone.output).not.toContain("j.wilkins@example.com");
    expect(byTombstone.output).not.toContain("0408 121 884");
    // The property is still on the roll (linkage preserved), now under the
    // de-identified owner label.
    expect((byTombstone.data as { matches: unknown[] }).matches.length).toBeGreaterThanOrEqual(1);
    expect(byTombstone.output).toContain("[erased]");
  });

  // ── (b) audit event recorded + chain still verifies ──────────────────────
  it("records an erase_owner_pii audit row that carries no erased PII, and the chain verifies", async () => {
    const audit = await import("@ratesassist/adapter-demo/audit");

    await erasurePOST(req({ ownerId: "O-WA-010" }, session(["council_admin"], "TPS")));

    const rows = audit.readChainOrdered("TPS", 100);
    const erasureRows = rows.filter((r) => r.action === ERASE_ACTION);
    expect(erasureRows.length).toBe(1);

    const row = erasureRows[0]!;
    expect(row.tenantId).toBe("TPS");
    expect(row.actorId).toBe("officer-1");
    expect(row.targetType).toBe("owner");
    expect(row.targetId).toBe("O-WA-010");

    // The audit payload must NOT re-introduce the destroyed PII (APP 11.2):
    // `before` lists only cleared field names; `after` is the tombstone.
    const payload = JSON.stringify({ before: row.before, after: row.after });
    expect(payload).not.toContain("Wilkins");
    expect(payload).not.toContain("j.wilkins@example.com");
    expect(payload).not.toContain("0408 121 884");
    expect(payload).not.toContain("Stadium Road");
    expect(row.before).toMatchObject({ redacted: true });

    // The hash chain still verifies end-to-end after the destruction event.
    const verdict = audit.verifyChain(rows);
    expect(verdict.ok).toBe(true);
  });

  // ── (c) idempotent re-run is a no-op ─────────────────────────────────────
  it("is idempotent — a second erasure reports alreadyErased and writes no second audit row", async () => {
    const audit = await import("@ratesassist/adapter-demo/audit");
    const s = session(["council_admin"], "TPS");

    const first = await erasurePOST(req({ ownerId: "O-WA-010" }, s));
    const firstBody = (await first.json()) as ErasureOkBody;
    expect(firstBody.data.erased).toBe(true);
    expect(firstBody.data.alreadyErased).toBe(false);

    const rowsAfterFirst = audit
      .readChainOrdered("TPS", 100)
      .filter((r) => r.action === ERASE_ACTION).length;
    expect(rowsAfterFirst).toBe(1);

    const second = await erasurePOST(req({ ownerId: "O-WA-010" }, s));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as ErasureOkBody;
    expect(secondBody.data.erased).toBe(false);
    expect(secondBody.data.alreadyErased).toBe(true);

    // No additional audit noise on the idempotent replay.
    const rowsAfterSecond = audit
      .readChainOrdered("TPS", 100)
      .filter((r) => r.action === ERASE_ACTION).length;
    expect(rowsAfterSecond).toBe(1);

    // Chain still verifies.
    expect(audit.verifyChain(audit.readChainOrdered("TPS", 100)).ok).toBe(true);
  });

  // ── (e) tenant-scoping / shared-owner decision ───────────────────────────
  it("council_admin CANNOT erase a shared owner (cross-tenant) — 403, and no PII is touched", async () => {
    const res = await erasurePOST(
      req({ ownerId: "O-WA-001" }, session(["council_admin"], "TPS")),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErasureErrBody;
    expect(body.code).toBe("forbidden");

    // The refusal must be inert: the shared owner's PII is untouched (no
    // partial/over-erase leaking another council's data controller record).
    const owner = await getOwner("O-WA-001");
    expect(owner!.name).toBe("Pilbara Iron Holdings Pty Ltd");
    expect(owner!.email).toBe("rates@pilbara-iron.example");
  });

  it("platform_admin CAN erase a shared owner across tenants; PII is gone and shared=true", async () => {
    const res = await erasurePOST(
      req({ ownerId: "O-WA-001" }, session(["platform_admin"], "TPS")),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ErasureOkBody;
    expect(body.data.shared).toBe(true);
    expect(body.data.erased).toBe(true);

    const owner = await getOwner("O-WA-001");
    expect(owner!.ownerId).toBe("O-WA-001"); // linkage preserved
    expect(owner!.name).toBe("[erased]");
    expect(owner!.email).toBeNull();
    expect(owner!.phone).toBeNull();
    const blob = JSON.stringify(owner);
    expect(blob).not.toContain("Pilbara Iron Holdings");
    expect(blob).not.toContain("rates@pilbara-iron.example");
  });

  it("council_admin bound to a DIFFERENT council cannot erase another council's single owner", async () => {
    // O-WA-010 is TPS-only; an ESH council_admin must not reach it.
    const res = await erasurePOST(
      req({ ownerId: "O-WA-010" }, session(["council_admin"], "ESH")),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErasureErrBody;
    expect(body.code).toBe("forbidden");

    // Untouched.
    const owner = await getOwner("O-WA-010");
    expect(owner!.name).toBe("John & Sarah Wilkins");
  });

  // ── statutory hold defers rather than destroys ───────────────────────────
  it("defers (409 conflict) when the subject is under a legal hold and leaves PII intact", async () => {
    const res = await erasurePOST(
      req(
        { ownerId: "O-WA-010", legalHold: true },
        session(["platform_admin"], "TPS"),
      ),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErasureErrBody;
    expect(body.code).toBe("conflict");

    const owner = await getOwner("O-WA-010");
    expect(owner!.name).toBe("John & Sarah Wilkins"); // not destroyed
  });
});
