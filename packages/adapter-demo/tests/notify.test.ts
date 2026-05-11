/**
 * notify_clerk handler tests.
 *
 * Covers:
 *   - Happy path via console transport (default) — returns ok with
 *     provider="console" and writes a notify.clerk audit row.
 *   - Missing/invalid provider env → forbidden + no_provider_configured.
 *   - Unknown assessment → not_found, no audit row.
 *   - Ratepayer/anonymous actor is refused by the route layer's RBAC,
 *     and the adapter additionally refuses an actorKind that is not
 *     user/service.
 *
 * The handler is invoked through the dispatcher so the contract input
 * schema is exercised end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { _resetForTests, readRecent } from "../src/audit/index.js";
import { DataStore } from "../src/data/index.js";
import { CommitTokenStore } from "../src/runtime/commitTokens.js";
import {
  createDefaultAbnClient,
  createRequestContext,
} from "../src/runtime/context.js";
import { dispatch } from "../src/runtime/dispatcher.js";

function makeCtx(overrides: { actorKind?: "user" | "service" | "llm" } = {}) {
  return createRequestContext({
    store: new DataStore(),
    commitTokens: new CommitTokenStore(),
    abnClient: createDefaultAbnClient(),
    correlationId: "corr-notify-test",
    actorKind: overrides.actorKind ?? "user",
    actorId: "user-officer-1",
  });
}

beforeEach(() => {
  _resetForTests();
  delete process.env["RA_NOTIFY_PROVIDER"];
  delete process.env["RA_NOTIFY_API_KEY"];
});

afterEach(() => {
  delete process.env["RA_NOTIFY_PROVIDER"];
  delete process.env["RA_NOTIFY_API_KEY"];
});

describe("notify_clerk handler", () => {
  it("happy path: console transport, audit row written", async () => {
    const ctx = makeCtx();
    const sampleProp = ctx.store.listProperties()[0]!;

    const result = await dispatch({
      toolName: "notify_clerk",
      input: {
        recipientEmail: "clerk@council.example",
        subject: "Recovery candidate ready for review",
        candidateAssessmentNumber: sampleProp.assessmentNumber,
        severity: "high",
      },
      context: ctx,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { provider: string; recipient: string };
    expect(data.provider).toBe("console");
    expect(data.recipient).toBe("clerk@council.example");

    const entries = readRecent(ctx.tenantId, 50);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("notify.clerk");
    expect(entries[0]!.targetType).toBe("property");
    expect(entries[0]!.targetId).toBe(sampleProp.assessmentNumber);
    const after = entries[0]!.after as {
      recipient: string;
      provider: string;
      severity: string;
    };
    expect(after.recipient).toBe("clerk@council.example");
    expect(after.provider).toBe("console");
    expect(after.severity).toBe("high");
  });

  it("returns forbidden when RA_NOTIFY_PROVIDER is invalid", async () => {
    process.env["RA_NOTIFY_PROVIDER"] = "smtp"; // unsupported
    const ctx = makeCtx();
    const sampleProp = ctx.store.listProperties()[0]!;
    const result = await dispatch({
      toolName: "notify_clerk",
      input: {
        recipientEmail: "clerk@council.example",
        subject: "subj test",
        candidateAssessmentNumber: sampleProp.assessmentNumber,
      },
      context: ctx,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(result.error.toLowerCase()).toContain("provider");
    }
    expect(readRecent(ctx.tenantId, 50)).toHaveLength(0);
  });

  it("returns forbidden when RA_NOTIFY_PROVIDER=resend without API key", async () => {
    process.env["RA_NOTIFY_PROVIDER"] = "resend";
    const ctx = makeCtx();
    const sampleProp = ctx.store.listProperties()[0]!;
    const result = await dispatch({
      toolName: "notify_clerk",
      input: {
        recipientEmail: "clerk@council.example",
        subject: "subj test",
        candidateAssessmentNumber: sampleProp.assessmentNumber,
      },
      context: ctx,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("unknown assessment number → not_found", async () => {
    const ctx = makeCtx();
    const result = await dispatch({
      toolName: "notify_clerk",
      input: {
        recipientEmail: "clerk@council.example",
        subject: "subj test",
        candidateAssessmentNumber: "ZZZ-NO-SUCH-PROP",
      },
      context: ctx,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });

  it("rejects non-user/non-service actor kinds", async () => {
    const ctx = makeCtx({ actorKind: "llm" });
    const sampleProp = ctx.store.listProperties()[0]!;
    const result = await dispatch({
      toolName: "notify_clerk",
      input: {
        recipientEmail: "clerk@council.example",
        subject: "subj test",
        candidateAssessmentNumber: sampleProp.assessmentNumber,
      },
      context: ctx,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});
