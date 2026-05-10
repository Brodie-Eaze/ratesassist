/**
 * Characterization tests for the dispatcher.
 *
 * Cover:
 *   - Unknown tool → invalid_input (NB: legacy currently maps unknown-tool to
 *     invalid_input rather than internal_error; pin actual behaviour).
 *   - Malformed input → invalid_input.
 *   - Handler throw → internal_error + stack to console.error.
 *   - Handler returning malformed result → internal_error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatch } from "../src/runtime/dispatcher.js";
import { createRequestContext } from "../src/runtime/context.js";
import { CommitTokenStore } from "../src/runtime/commitTokens.js";
import { DataStore } from "../src/data/index.js";
import { createAbnClient } from "@ratesassist/identity";

function ctx() {
  return createRequestContext({
    store: new DataStore(),
    commitTokens: new CommitTokenStore(),
    abnClient: createAbnClient({ strict: false }),
    correlationId: "corr-test",
  });
}

describe("dispatch", () => {
  // Dispatcher writes structured logs to STDERR (fd 2) — STDOUT is reserved
  // for MCP frames. Spy on process.stderr.write so the assertion matches the
  // actual transport.
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("unknown tool name → invalid_input", async () => {
    const r = await dispatch({
      toolName: "definitely_not_a_real_tool",
      input: {},
      context: ctx(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("invalid_input");
      expect(r.error).toContain("Unknown tool");
    }
  });

  it("malformed input fails contract validation", async () => {
    const r = await dispatch({
      toolName: "get_property_detail",
      input: { assessmentNumber: "" }, // too short
      context: ctx(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
  });

  it("missing required field → invalid_input", async () => {
    const r = await dispatch({
      toolName: "get_owner",
      input: {},
      context: ctx(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
  });

  it("handler throw → internal_error + stack logged", async () => {
    // Force a handler to throw by stubbing a member of HANDLERS via dynamic
    // import + mutation. We monkeypatch `searchPropertyHandler`'s registry
    // entry through the imported module namespace.
    const handlersMod = await import("../src/handlers/index.js");
    const original = (handlersMod.HANDLERS as Record<string, unknown>)
      .search_property;
    (handlersMod.HANDLERS as Record<string, unknown>).search_property = async () => {
      throw new Error("boom-from-test");
    };

    try {
      const r = await dispatch({
        toolName: "search_property",
        input: { query: "x" },
        context: ctx(),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("internal_error");
        expect(r.error).toContain("boom-from-test");
      }
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      (handlersMod.HANDLERS as Record<string, unknown>).search_property =
        original;
    }
  });

  it("handler returning malformed shape → internal_error", async () => {
    const handlersMod = await import("../src/handlers/index.js");
    const original = (handlersMod.HANDLERS as Record<string, unknown>)
      .search_property;
    (handlersMod.HANDLERS as Record<string, unknown>).search_property = async () =>
      ({ ok: true } as never); // missing `output`

    try {
      const r = await dispatch({
        toolName: "search_property",
        input: { query: "x" },
        context: ctx(),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("internal_error");
        expect(r.error).toContain("did not match the contract");
      }
    } finally {
      (handlersMod.HANDLERS as Record<string, unknown>).search_property =
        original;
    }
  });

  it("happy path: list_councils returns ok:true result", async () => {
    const r = await dispatch({
      toolName: "list_councils",
      input: {},
      context: ctx(),
    });
    expect(r.ok).toBe(true);
  });
});
