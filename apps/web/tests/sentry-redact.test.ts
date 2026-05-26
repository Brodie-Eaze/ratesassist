/**
 * Sentry redaction policy — mirror of the pino contract in
 * `apps/web/lib/logger.ts`. CI gating: any PII key that reaches Sentry
 * unscrubbed is a P0 — assessment numbers must be last-4 only, every
 * other PII key fully redacted.
 *
 * Also asserts:
 *
 *   - `initSentry()` is a no-op when `SENTRY_DSN` is unset (the pilot
 *     must ship without a Sentry account).
 *   - Audit-grade capture wrappers no-op safely (don't throw) when
 *     the SDK was never wired.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  scrubEvent,
  initSentry,
  isSentryEnabled,
  captureTenantOverrideRefused,
  captureCrossTenantRefused,
  captureImageryDegraded,
} from "../lib/sentry";
import type { ErrorEvent } from "@sentry/nextjs";

function baseEvent(): ErrorEvent {
  return {
    type: undefined,
    message: "test",
  };
}

describe("scrubEvent — PII redaction", () => {
  it("redacts every key in the pino contract", () => {
    const e = baseEvent();
    e.extra = {
      password: "p@ss",
      token: "tok-123",
      apiKey: "ak-456",
      email: "a@b.com",
      phone: "+61400000000",
      abn: "32614882110",
      tfn: "123-456-789",
      name: "Jane Doe",
      firstName: "Jane",
      lastName: "Doe",
      address: "1 Main St",
      streetAddress: "1 Main St",
      suburb: "Tom Price",
      postcode: "6751",
      keep: "ok",
    };
    const scrubbed = scrubEvent(e);
    const extra = scrubbed.extra as Record<string, unknown>;
    for (const key of [
      "password",
      "token",
      "apiKey",
      "email",
      "phone",
      "abn",
      "tfn",
      "name",
      "firstName",
      "lastName",
      "address",
      "streetAddress",
      "suburb",
      "postcode",
    ]) {
      expect(extra[key]).toBe("[REDACTED]");
    }
    expect(extra["keep"]).toBe("ok");
  });

  it("is case-insensitive on key names", () => {
    const e = baseEvent();
    e.extra = {
      EMAIL: "a@b.com",
      Authorization: "Bearer x",
      Cookie: "s=1",
    };
    const scrubbed = scrubEvent(e);
    const extra = scrubbed.extra as Record<string, unknown>;
    expect(extra["EMAIL"]).toBe("[REDACTED]");
    expect(extra["Authorization"]).toBe("[REDACTED]");
    expect(extra["Cookie"]).toBe("[REDACTED]");
  });

  it("preserves assessmentNumber as last-4 only", () => {
    const e = baseEvent();
    e.extra = { assessmentNumber: "TPS-1102-44-9876" };
    const scrubbed = scrubEvent(e);
    const extra = scrubbed.extra as Record<string, unknown>;
    expect(extra["assessmentNumber"]).toBe("****9876");
  });

  it("redacts short assessmentNumber entirely", () => {
    const e = baseEvent();
    e.extra = { assessmentNumber: "12" };
    const scrubbed = scrubEvent(e);
    const extra = scrubbed.extra as Record<string, unknown>;
    expect(extra["assessmentNumber"]).toBe("[REDACTED]");
  });

  it("walks nested objects and arrays", () => {
    const e = baseEvent();
    e.extra = {
      filter: {
        email: "a@b.com",
        items: [
          { phone: "+61400000000", keep: "ok" },
          { name: "Jane" },
        ],
      },
    };
    const scrubbed = scrubEvent(e);
    const filter = (scrubbed.extra as { filter: Record<string, unknown> })
      .filter;
    expect((filter as { email: string }).email).toBe("[REDACTED]");
    const items = filter["items"] as Array<Record<string, unknown>>;
    expect(items[0]?.["phone"]).toBe("[REDACTED]");
    expect(items[0]?.["keep"]).toBe("ok");
    expect(items[1]?.["name"]).toBe("[REDACTED]");
  });

  it("scrubs request.url query-string identifiers", () => {
    const e = baseEvent();
    e.request = {
      url: "https://app.example/api/search?q=jane@example.com&page=2",
    };
    const scrubbed = scrubEvent(e);
    expect(scrubbed.request?.url).toContain("q=[REDACTED]");
    expect(scrubbed.request?.url).toContain("page=2");
    expect(scrubbed.request?.url).not.toContain("jane@example.com");
  });

  it("scrubs assessmentNumber in URL query-string", () => {
    const e = baseEvent();
    e.request = {
      url: "https://app.example/x?assessmentNumber=TPS-1102-44-9876",
    };
    const scrubbed = scrubEvent(e);
    expect(scrubbed.request?.url).toContain("assessmentNumber=[REDACTED]");
    expect(scrubbed.request?.url).not.toContain("9876");
  });

  it("scrubs breadcrumb.data", () => {
    const e = baseEvent();
    e.breadcrumbs = [
      {
        category: "fetch",
        message: "GET /api/x",
        data: { email: "a@b.com", url: "x" },
      },
    ];
    const scrubbed = scrubEvent(e);
    expect(scrubbed.breadcrumbs?.[0]?.data?.["email"]).toBe("[REDACTED]");
    expect(scrubbed.breadcrumbs?.[0]?.data?.["url"]).toBe("x");
  });

  it("scrubs request.headers (authorization/cookie)", () => {
    const e = baseEvent();
    e.request = {
      url: "https://app.example/x",
      headers: {
        Authorization: "Bearer secret",
        Cookie: "session=abc",
        "user-agent": "Mozilla",
      },
    };
    const scrubbed = scrubEvent(e);
    const headers = scrubbed.request?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("[REDACTED]");
    expect(headers["Cookie"]).toBe("[REDACTED]");
    expect(headers["user-agent"]).toBe("Mozilla");
  });
});

describe("initSentry — DSN gating", () => {
  const originalDsn = process.env["SENTRY_DSN"];
  beforeEach(() => {
    delete process.env["SENTRY_DSN"];
  });
  afterEach(() => {
    if (originalDsn === undefined) {
      delete process.env["SENTRY_DSN"];
    } else {
      process.env["SENTRY_DSN"] = originalDsn;
    }
  });

  it("is a no-op when SENTRY_DSN is unset", () => {
    initSentry();
    expect(isSentryEnabled()).toBe(false);
  });

  it("audit-grade captures don't throw when SDK is not initialised", () => {
    expect(() =>
      captureTenantOverrideRefused({
        actorId: "u-1",
        sessionTenant: "TPS",
        attemptedPath: "filter.tenantId",
        attemptedValue: "KAL",
      }),
    ).not.toThrow();
    expect(() =>
      captureCrossTenantRefused({
        actorId: "u-1",
        sessionTenant: "TPS",
        attemptedTenant: "KAL",
        route: "/api/councils/KAL/import",
      }),
    ).not.toThrow();
    expect(() =>
      captureImageryDegraded({ source: "sentinel-latest" }),
    ).not.toThrow();
  });
});

describe("captureMessage wrappers — fingerprint shape", () => {
  // We can't observe Sentry network calls without a live DSN; instead
  // we patch `Sentry.captureMessage` and assert the fingerprint/tag
  // shape the wrappers produce. The init gate is bypassed via a stub
  // DSN + manual `initSentry()` for this block only.
  let captured: Array<{ message: string; opts: Record<string, unknown> }> = [];
  beforeEach(async () => {
    captured = [];
    process.env["SENTRY_DSN"] = "https://stub@stub.ingest.sentry.io/0";
    vi.resetModules();
    vi.doMock("@sentry/nextjs", async () => {
      const actual = await vi.importActual<typeof import("@sentry/nextjs")>(
        "@sentry/nextjs",
      );
      return {
        ...actual,
        init: vi.fn(),
        captureMessage: (message: string, opts: Record<string, unknown>) => {
          captured.push({ message, opts });
          return "stub-event-id";
        },
      };
    });
  });
  afterEach(() => {
    vi.doUnmock("@sentry/nextjs");
    vi.resetModules();
    delete process.env["SENTRY_DSN"];
  });

  it("captureTenantOverrideRefused fingerprints by sessionTenant", async () => {
    const mod = await import("../lib/sentry");
    mod.initSentry();
    mod.captureTenantOverrideRefused({
      actorId: "u-1",
      sessionTenant: "TPS",
      attemptedPath: "filter.tenantId",
      attemptedValue: "KAL-1102-44-9876",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.message).toBe("tool.tenant_override_refused");
    const opts = captured[0]!.opts as {
      fingerprint: string[];
      level: string;
      tags: Record<string, string>;
      extra: Record<string, string>;
    };
    expect(opts.fingerprint).toEqual([
      "audit",
      "tenant_override_refused",
      "TPS",
    ]);
    expect(opts.level).toBe("warning");
    expect(opts.tags.signal).toBe("audit");
    expect(opts.tags.sessionTenant).toBe("TPS");
    // attemptedValue is truncated to last-4.
    expect(opts.extra["attemptedValue"]).toBe("****9876");
  });

  it("captureCrossTenantRefused fingerprints by sessionTenant", async () => {
    const mod = await import("../lib/sentry");
    mod.initSentry();
    mod.captureCrossTenantRefused({
      actorId: "u-1",
      sessionTenant: "TPS",
      attemptedTenant: "KAL",
      route: "/api/councils/KAL/import",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.message).toBe("cross_tenant_refused");
    const opts = captured[0]!.opts as {
      fingerprint: string[];
      level: string;
      tags: Record<string, string>;
    };
    expect(opts.fingerprint).toEqual([
      "audit",
      "cross_tenant_refused",
      "TPS",
    ]);
    expect(opts.tags.attemptedTenant).toBe("KAL");
    expect(opts.tags.route).toBe("/api/councils/KAL/import");
  });

  it("captureImageryDegraded fingerprints by source", async () => {
    const mod = await import("../lib/sentry");
    mod.initSentry();
    mod.captureImageryDegraded({ source: "sentinel-latest" });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.message).toBe("ratesassist:imagery_degraded");
    const opts = captured[0]!.opts as {
      fingerprint: string[];
      level: string;
      tags: Record<string, string>;
    };
    expect(opts.fingerprint).toEqual([
      "audit",
      "imagery_degraded",
      "sentinel-latest",
    ]);
    expect(opts.level).toBe("info");
    expect(opts.tags.signal).toBe("upstream");
  });
});
