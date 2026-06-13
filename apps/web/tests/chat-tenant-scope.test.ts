/**
 * Chat tool-dispatch tenant + RBAC scoping (`lib/tool-tenant-scope.ts`).
 *
 * This is the regression suite for the cross-tenant READ IDOR on the chat
 * surface: `/api/chat` was authenticated but UNSCOPED, so the LLM could call
 * tools with another council's identifiers and the (globally-seeded) adapter
 * would answer. `applyToolScope` is the single chokepoint that now mirrors the
 * REST layer's RBAC + tenant guards EXACTLY.
 *
 * Three layers of assertion:
 *   1. Unit — every policy family (injectCouncil / assessmentGuard /
 *      ownerGuard + redaction / councilWriteGuard / injectAuditTenant /
 *      requirePermission / publicTool) across rates_officer-TPS, platform_admin
 *      and a least-privileged ratepayer scope, plus the fail-closed unknown-tool
 *      path.
 *   2. Completeness (CI tripwire) — `scopedToolNames()` equals the full
 *      contract catalogue, so no tool can ship without a scope policy.
 *   3. Integration (inproc) — `runTool(..., scope)` actually applies the policy
 *      end-to-end: council injection, cross-tenant not_found, RBAC forbidden,
 *      and shared-owner contact redaction flowing through the real adapter.
 *
 * Fixtures are pinned to the seed (apps/web/lib/data.ts):
 *   - O-WA-001 (Pilbara Iron) holds TPS + ESH + ASH → multi-council incl. TPS.
 *   - O-WA-010 (Wilkins)       holds TPS only        → single-council.
 *   - O-WA-021 (Goldfields Pastoral) holds KAL only  → cross-tenant for TPS.
 *   - TPS-1102-44 / KAL-4401-12 are real property assessments.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// Env must be set BEFORE the route/tool modules load (they read it at import).
process.env["RA_AUTH_SECRET"] = "test-secret-test-secret-32chars!";
// In-process transport so runTool dispatches to the same module-instance store
// the policy's getEvaluationContext reads — the stdio child would have its own.
process.env["RA_TOOL_TRANSPORT"] = "inproc";

import { buildToolCatalogue } from "@ratesassist/contract";
import { _resetAuthSecretCacheForTests } from "../lib/auth";

vi.resetModules();
const { applyToolScope, scopedToolNames } = await import(
  "../lib/tool-tenant-scope"
);
const { runTool } = await import("../lib/tools");

beforeAll(() => {
  _resetAuthSecretCacheForTests();
});

beforeEach(async () => {
  const inproc = await import("@ratesassist/adapter-demo/inproc");
  inproc._resetInproc();
  const audit = await import("@ratesassist/adapter-demo/audit");
  audit._resetForTests();
});

// ===== scopes =====
const officerTPS = { tenantId: "TPS", roles: ["rates_officer"] };
const supervisorTPS = { tenantId: "TPS", roles: ["rates_supervisor"] };
const adminAU = { tenantId: "TPS", roles: ["platform_admin"] };
const councilAdminTPS = { tenantId: "TPS", roles: ["council_admin"] };
const ratepayerTPS = { tenantId: "TPS", roles: ["ratepayer"] };

// ===== 1. Unit: injectCouncil family (read.tenant_data) =====
describe("applyToolScope — injectCouncil (council-filtered reads)", () => {
  it("rates_officer: forces council = caller tenant", () => {
    const o = applyToolScope("list_councils", {}, officerTPS);
    expect(o.action).toBe("allow");
    if (o.action === "allow") expect(o.input.council).toBe("TPS");
  });

  it("rates_officer: overrides a forged cross-tenant council (the IDOR)", () => {
    const o = applyToolScope("search_property", { council: "KAL" }, officerTPS);
    expect(o.action).toBe("allow");
    // The attacker-supplied "KAL" is overwritten with the caller's own tenant.
    if (o.action === "allow") expect(o.input.council).toBe("TPS");
  });

  it("platform_admin: council left unset (legitimate cross-tenant)", () => {
    const o = applyToolScope("list_councils", {}, adminAU);
    expect(o.action).toBe("allow");
    if (o.action === "allow") expect(o.input.council).toBeUndefined();
  });

  it("ratepayer: denied forbidden (lacks read.tenant_data)", () => {
    const o = applyToolScope("recovery_summary", {}, ratepayerTPS);
    expect(o.action).toBe("deny");
    if (o.action === "deny") {
      expect(o.code).toBe("forbidden");
      expect(o.message).toContain("read.tenant_data");
    }
  });
});

// ===== 1. Unit: assessmentGuard family =====
describe("applyToolScope — assessmentGuard (assessment-keyed)", () => {
  it("rates_officer: own-tenant assessment allowed unchanged", () => {
    const o = applyToolScope(
      "get_property_detail",
      { assessmentNumber: "TPS-1102-44" },
      officerTPS,
    );
    expect(o.action).toBe("allow");
    if (o.action === "allow")
      expect(o.input.assessmentNumber).toBe("TPS-1102-44");
  });

  it("rates_officer: cross-tenant assessment masked as not_found", () => {
    const o = applyToolScope(
      "get_property_detail",
      { assessmentNumber: "KAL-4401-12" },
      officerTPS,
    );
    expect(o.action).toBe("deny");
    if (o.action === "deny") {
      expect(o.code).toBe("not_found"); // not "forbidden" — no enumeration oracle
      expect(o.message).toContain("KAL-4401-12");
    }
  });

  it("platform_admin: cross-tenant assessment allowed (bypass)", () => {
    const o = applyToolScope(
      "get_property_detail",
      { assessmentNumber: "KAL-4401-12" },
      adminAU,
    );
    expect(o.action).toBe("allow");
  });

  it("missing assessment field: allowed (Zod owns invalid_input)", () => {
    const o = applyToolScope("get_property_detail", {}, officerTPS);
    expect(o.action).toBe("allow");
  });

  it("draft mutation: ratepayer denied (lacks write.draft_mutation)", () => {
    const o = applyToolScope(
      "draft_payment_reminder",
      { assessmentNumber: "TPS-1102-44" },
      ratepayerTPS,
    );
    expect(o.action).toBe("deny");
    if (o.action === "deny") {
      expect(o.code).toBe("forbidden");
      expect(o.message).toContain("write.draft_mutation");
    }
  });

  it("draft mutation: officer own-tenant allowed", () => {
    const o = applyToolScope(
      "add_property_note",
      { assessmentNumber: "TPS-3041-12", note: "x" },
      officerTPS,
    );
    expect(o.action).toBe("allow");
  });

  it("commit mutation: officer denied (lacks write.commit_mutation)", () => {
    const o = applyToolScope(
      "request_strata_conversion",
      { parentAssessmentNumber: "TPS-1102-44" },
      officerTPS,
    );
    expect(o.action).toBe("deny");
    if (o.action === "deny") {
      expect(o.code).toBe("forbidden");
      expect(o.message).toContain("write.commit_mutation");
    }
  });

  it("commit mutation: supervisor own-tenant allowed; cross-tenant not_found", () => {
    const ok = applyToolScope(
      "request_strata_conversion",
      { parentAssessmentNumber: "TPS-1102-44" },
      supervisorTPS,
    );
    expect(ok.action).toBe("allow");
    const denied = applyToolScope(
      "request_strata_conversion",
      { parentAssessmentNumber: "KAL-4401-12" },
      supervisorTPS,
    );
    expect(denied.action).toBe("deny");
    if (denied.action === "deny") expect(denied.code).toBe("not_found");
  });

  it("notify_clerk: keyed on candidateAssessmentNumber, cross-tenant not_found", () => {
    const o = applyToolScope(
      "notify_clerk",
      { candidateAssessmentNumber: "KAL-4401-12" },
      officerTPS,
    );
    expect(o.action).toBe("deny");
    if (o.action === "deny") expect(o.code).toBe("not_found");
  });
});

// ===== 1. Unit: ownerGuard family + redaction =====
describe("applyToolScope — ownerGuard (owner-keyed + shared-owner redaction)", () => {
  it("officer: single-council owner allowed, NO redaction transform", () => {
    const o = applyToolScope("get_owner", { ownerId: "O-WA-010" }, officerTPS);
    expect(o.action).toBe("allow");
    if (o.action === "allow") expect(o.transformResult).toBeUndefined();
  });

  it("officer: shared (multi-council) owner allowed WITH redaction transform", () => {
    const o = applyToolScope("get_owner", { ownerId: "O-WA-001" }, officerTPS);
    expect(o.action).toBe("allow");
    if (o.action === "allow") expect(o.transformResult).toBeDefined();
  });

  it("officer: owner with no own-tenant property → not_found", () => {
    const o = applyToolScope("get_owner", { ownerId: "O-WA-021" }, officerTPS);
    expect(o.action).toBe("deny");
    if (o.action === "deny") {
      expect(o.code).toBe("not_found");
      expect(o.message).toContain("O-WA-021");
    }
  });

  it("platform_admin: cross-tenant owner allowed (bypass)", () => {
    const o = applyToolScope("get_owner", { ownerId: "O-WA-021" }, adminAU);
    expect(o.action).toBe("allow");
  });

  it("update_owner_contact: write.draft_mutation gate; ratepayer denied", () => {
    const o = applyToolScope(
      "update_owner_contact",
      { ownerId: "O-WA-001" },
      ratepayerTPS,
    );
    expect(o.action).toBe("deny");
    if (o.action === "deny") expect(o.code).toBe("forbidden");
  });

  it("update_owner_contact: shared (multi-council) owner DENIED for non-admin (MT-04)", () => {
    // O-WA-001 spans TPS+ESH+ASH. A TPS clerk can READ it (contact redacted),
    // but must NOT mutate contact details a sibling council also relies on —
    // the owner row is shared state. Honest `forbidden`, not the not_found
    // mask: the read path already discloses the owner is shared
    // (contactRedactedReason), so the refusal leaks nothing new. Only
    // platform_admin may write a cross-council owner.
    const o = applyToolScope(
      "update_owner_contact",
      { ownerId: "O-WA-001" },
      officerTPS,
    );
    expect(o.action).toBe("deny");
    if (o.action === "deny") {
      expect(o.code).toBe("forbidden");
      expect(o.message).toContain("multiple councils");
    }
  });

  it("update_owner_contact: single-council owner allowed, NO redaction (write path)", () => {
    // O-WA-010 (Wilkins) is TPS-only — the legitimate write path is unaffected
    // by the MT-04 guard. A redaction transform here would corrupt the
    // operator's own edit narration, so there must be none.
    const o = applyToolScope(
      "update_owner_contact",
      { ownerId: "O-WA-010" },
      officerTPS,
    );
    expect(o.action).toBe("allow");
    if (o.action === "allow") expect(o.transformResult).toBeUndefined();
  });

  it("update_owner_contact: platform_admin may write a shared owner (bypass)", () => {
    const o = applyToolScope(
      "update_owner_contact",
      { ownerId: "O-WA-001" },
      adminAU,
    );
    expect(o.action).toBe("allow");
  });

  it("update_owner_contact: cross-tenant owner still not_found (existence oracle)", () => {
    // O-WA-021 is KAL-only — invisible to TPS. Stays masked as not_found, NOT
    // the shared-owner `forbidden`, so the write path can't confirm an owner
    // the caller can't otherwise see.
    const o = applyToolScope(
      "update_owner_contact",
      { ownerId: "O-WA-021" },
      officerTPS,
    );
    expect(o.action).toBe("deny");
    if (o.action === "deny") expect(o.code).toBe("not_found");
  });

  it("redaction transform strips contact PII from data AND output, retains identity", () => {
    const o = applyToolScope("get_owner", { ownerId: "O-WA-001" }, officerTPS);
    expect(o.action).toBe("allow");
    if (o.action !== "allow" || o.transformResult === undefined) return;
    const view = {
      output:
        "Owner O-WA-001 — Pilbara Iron Holdings Pty Ltd\n" +
        "Postal address: Level 12, 100 St Georges Terrace, Perth WA 6000\n" +
        "Phone: 08 9200 7700\n" +
        "Email: rates@pilbara-iron.example\n" +
        "ABN: 32 614 882 110\n" +
        "Owner since: 2014-08-19",
      data: {
        owner: {
          ownerId: "O-WA-001",
          name: "Pilbara Iron Holdings Pty Ltd",
          abn: "32 614 882 110",
          email: "rates@pilbara-iron.example",
          phone: "08 9200 7700",
          postalAddress: "Level 12, 100 St Georges Terrace, Perth WA 6000",
          ownerSince: "2014-08-19",
        },
      },
    };
    const red = o.transformResult(view);
    const owner = (red.data as { owner: Record<string, unknown> }).owner;
    // Contact PII stripped from structured data.
    expect(owner.email).toBeUndefined();
    expect(owner.phone).toBeUndefined();
    expect(owner.postalAddress).toBeUndefined();
    expect(owner.contactRedacted).toBe(true);
    expect(owner.contactRedactedReason).toBe("shared_owner_cross_tenant");
    // Identity (non-contact) retained.
    expect(owner.name).toBe("Pilbara Iron Holdings Pty Ltd");
    expect(owner.abn).toBe("32 614 882 110");
    expect(owner.ownerSince).toBe("2014-08-19");
    // Contact PII scrubbed from the LLM-facing narration too.
    expect(red.output).not.toContain("rates@pilbara-iron.example");
    expect(red.output).not.toContain("08 9200 7700");
    expect(red.output).not.toContain("100 St Georges Terrace");
    expect(red.output).toContain("[redacted — shared owner across councils]");
    // Identity still visible in the narration.
    expect(red.output).toContain("Pilbara Iron Holdings Pty Ltd");
  });
});

// ===== 1. Unit: councilWriteGuard + requirePermission (write.user_management) =====
describe("applyToolScope — council-write + admin tools", () => {
  it("import: council_admin own-tenant allowed", () => {
    const o = applyToolScope(
      "import_rating_roll",
      { councilCode: "TPS" },
      councilAdminTPS,
    );
    expect(o.action).toBe("allow");
  });

  it("import: council_admin cross-tenant denied forbidden (named council, no leak)", () => {
    const o = applyToolScope(
      "import_rating_roll",
      { councilCode: "KAL" },
      councilAdminTPS,
    );
    expect(o.action).toBe("deny");
    if (o.action === "deny") {
      expect(o.code).toBe("forbidden");
      expect(o.message).toContain("KAL");
      expect(o.message).toContain("TPS");
    }
  });

  it("import: rates_officer denied (lacks write.user_management)", () => {
    const o = applyToolScope(
      "import_landgate_title_data",
      { councilCode: "TPS" },
      officerTPS,
    );
    expect(o.action).toBe("deny");
    if (o.action === "deny") {
      expect(o.code).toBe("forbidden");
      expect(o.message).toContain("write.user_management");
    }
  });

  it("add_council: requires write.user_management (officer denied, admin allowed)", () => {
    const denied = applyToolScope(
      "add_council",
      { code: "NEW", name: "New Shire" },
      officerTPS,
    );
    expect(denied.action).toBe("deny");
    const ok = applyToolScope(
      "add_council",
      { code: "NEW", name: "New Shire" },
      councilAdminTPS,
    );
    expect(ok.action).toBe("allow");
  });
});

// ===== 1. Unit: injectAuditTenant (read.audit_log) =====
describe("applyToolScope — audit tools", () => {
  it("supervisor: tenantId injected to caller tenant", () => {
    const o = applyToolScope("list_audit_log", {}, supervisorTPS);
    expect(o.action).toBe("allow");
    if (o.action === "allow") expect(o.input.tenantId).toBe("TPS");
  });

  it("rates_officer: denied (lacks read.audit_log)", () => {
    const o = applyToolScope("verify_audit_chain", {}, officerTPS);
    expect(o.action).toBe("deny");
    if (o.action === "deny") {
      expect(o.code).toBe("forbidden");
      expect(o.message).toContain("read.audit_log");
    }
  });

  it("platform_admin: tenantId left unset (cross-tenant audit)", () => {
    const o = applyToolScope("list_audit_log", {}, adminAU);
    expect(o.action).toBe("allow");
    if (o.action === "allow") expect(o.input.tenantId).toBeUndefined();
  });
});

// ===== 1. Unit: publicTool + fail-closed =====
describe("applyToolScope — public tools + fail-closed", () => {
  it("public catalogue tools allowed for every role, input untouched", () => {
    for (const name of [
      "verify_abn",
      "list_recent_grants",
      "list_lag_window_candidates",
      "list_environmental_approvals",
    ]) {
      const o = applyToolScope(name, { foo: "bar" }, ratepayerTPS);
      expect(o.action).toBe("allow");
      if (o.action === "allow") expect(o.input.foo).toBe("bar");
    }
  });

  it("unknown tool in a scoped session is denied (fail-closed)", () => {
    const o = applyToolScope("totally_made_up_tool", {}, officerTPS);
    expect(o.action).toBe("deny");
    if (o.action === "deny") {
      expect(o.code).toBe("forbidden");
      expect(o.message).toContain("totally_made_up_tool");
    }
  });
});

// ===== 2. Completeness (CI tripwire) =====
describe("scopedToolNames — completeness", () => {
  it("every catalogue tool has a scope policy (no silent gaps)", () => {
    const catalogue = buildToolCatalogue()
      .map((t) => t.name)
      .sort();
    const scoped = [...scopedToolNames()].sort();
    expect(scoped).toEqual(catalogue);
  });

  it("policy table covers exactly 33 tools", () => {
    // Deliberate tripwire: adding a contract tool fails the compile-time
    // Record<ToolName,…> AND this number, forcing a conscious policy decision.
    expect(scopedToolNames().length).toBe(33);
  });
});

// ===== 3. Integration (inproc) — scope applied end-to-end via runTool =====
describe("runTool(scope) — end-to-end tenant isolation", () => {
  it("list_councils: TPS officer sees only TPS", async () => {
    const r = await runTool("list_councils", {}, "t-1", undefined, officerTPS);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("TPS");
    expect(r.output).not.toContain("KAL");
    const councils = (r.data as { councils: unknown[] }).councils;
    expect(councils.length).toBe(1);
  });

  it("list_councils: platform_admin sees the full council set", async () => {
    const r = await runTool("list_councils", {}, "t-2", undefined, adminAU);
    expect(r.ok).toBe(true);
    const councils = (r.data as { councils: unknown[] }).councils;
    expect(councils.length).toBeGreaterThan(1);
  });

  it("get_property_detail: own-tenant ok, cross-tenant not_found", async () => {
    const own = await runTool(
      "get_property_detail",
      { assessmentNumber: "TPS-1102-44" },
      "t-3",
      undefined,
      officerTPS,
    );
    expect(own.ok).toBe(true);

    const cross = await runTool(
      "get_property_detail",
      { assessmentNumber: "KAL-4401-12" },
      "t-4",
      undefined,
      officerTPS,
    );
    expect(cross.ok).toBe(false);
    expect(cross.code).toBe("not_found");
    // The forged KAL identifier never reached the adapter.
    expect(cross.output).not.toContain("Kalgoorlie");
  });

  it("verify_audit_chain: rates_officer forbidden before dispatch", async () => {
    const r = await runTool(
      "verify_audit_chain",
      {},
      "t-5",
      undefined,
      officerTPS,
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("forbidden");
  });

  it("get_owner: shared owner contact redacted through the real adapter", async () => {
    const r = await runTool(
      "get_owner",
      { ownerId: "O-WA-001" },
      "t-6",
      undefined,
      officerTPS,
    );
    expect(r.ok).toBe(true);
    const owner = (r.data as { owner: Record<string, unknown> }).owner;
    expect(owner.contactRedacted).toBe(true);
    expect(owner.contactRedactedReason).toBe("shared_owner_cross_tenant");
    expect(owner.email).toBeUndefined();
    expect(owner.name).toBeTruthy();
  });

  it("get_owner: single-council owner returns contact unredacted", async () => {
    const r = await runTool(
      "get_owner",
      { ownerId: "O-WA-010" },
      "t-7",
      undefined,
      officerTPS,
    );
    expect(r.ok).toBe(true);
    const owner = (r.data as { owner: Record<string, unknown> }).owner;
    expect(owner.contactRedacted).toBeUndefined();
  });

  it("get_owner: cross-tenant owner not_found", async () => {
    const r = await runTool(
      "get_owner",
      { ownerId: "O-WA-021" },
      "t-8",
      undefined,
      officerTPS,
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("not_found");
  });

  it("update_owner_contact: shared-owner write denied before dispatch — no mutation (MT-04)", async () => {
    const audit = await import("@ratesassist/adapter-demo/audit");
    const before = audit.size();
    const r = await runTool(
      "update_owner_contact",
      { ownerId: "O-WA-001", newPhone: "08 0000 0000" },
      "t-9",
      undefined,
      officerTPS,
    );
    expect(r.ok).toBe(false);
    expect(r.code).toBe("forbidden");
    // The guard short-circuits BEFORE the adapter: the shared owner's contact
    // is untouched in every council, and no audit row was appended.
    expect(audit.size()).toBe(before);
  });

  it("no scope passed → backward-compatible passthrough (REST callers self-scope)", async () => {
    // Direct/REST callers already scope upstream; runTool without a scope must
    // not inject anything (the 386 pre-existing tests rely on this).
    const r = await runTool("list_councils", {});
    expect(r.ok).toBe(true);
    const councils = (r.data as { councils: unknown[] }).councils;
    expect(councils.length).toBeGreaterThan(1);
  });
});
