/**
 * Characterization tests for CommitTokenStore.
 *
 * Pin: issue → consume happy path; expiry; operation mismatch; single-use.
 */

import { describe, it, expect } from "vitest";
import {
  CommitTokenStore,
  COMMIT_TOKEN_TTL_MS,
} from "../src/runtime/commitTokens.js";

describe("CommitTokenStore", () => {
  it("issue → consume returns the captured mutation", () => {
    const store = new CommitTokenStore();
    const tok = store.issue({
      operation: "update_owner_contact",
      ownerId: "O1",
      newPhone: "0400000000",
    });
    const r = store.consume(tok, "update_owner_contact");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mutation.operation).toBe("update_owner_contact");
    }
  });

  it("expired token → reason: expired", () => {
    let now = 1_000_000;
    const store = new CommitTokenStore(() => now);
    const tok = store.issue({
      operation: "add_property_note",
      assessmentNumber: "A123",
      note: "x",
    });
    now += COMMIT_TOKEN_TTL_MS + 1;
    const r = store.consume(tok, "add_property_note");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("wrong expected operation → reason: operation_mismatch", () => {
    const store = new CommitTokenStore();
    const tok = store.issue({
      operation: "update_owner_contact",
      ownerId: "O1",
      newEmail: "x@y.com",
    });
    const r = store.consume(tok, "add_property_note");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("operation_mismatch");
  });

  it("single-use: second consume of same token returns reason: unknown", () => {
    const store = new CommitTokenStore();
    const tok = store.issue({
      operation: "add_property_note",
      assessmentNumber: "A1",
      note: "n",
    });
    const r1 = store.consume(tok, "add_property_note");
    expect(r1.ok).toBe(true);

    const r2 = store.consume(tok, "add_property_note");
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("unknown");
  });

  it("unknown token → reason: unknown", () => {
    const store = new CommitTokenStore();
    const r = store.consume("nope", "update_owner_contact");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown");
  });
});
