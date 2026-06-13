/**
 * Serving-role seatbelt decision matrix.
 *
 * {@link shouldRefuseServingRole} is the pure core of the boot guard that
 * refuses to serve when the production Postgres role can bypass Row-Level
 * Security (superuser or BYPASSRLS) — which would silently render every
 * tenant-isolation policy inert. We exhaust the matrix here because the async
 * wrapper {@link assertNonBypassRlsRole} cannot be exercised against a real
 * NOBYPASSRLS Postgres role under pglite (pglite runs as implicit superuser),
 * so the decision logic must be proven in isolation.
 */

import { describe, expect, it } from "vitest";

import {
  shouldRefuseServingRole,
  type ServingRoleInputs,
} from "../src/bootstrap.js";

/** Baseline: the dangerous production case, before per-test overrides. */
function inputs(overrides: Partial<ServingRoleInputs> = {}): ServingRoleInputs {
  return {
    driver: "pg",
    nodeEnv: "production",
    allowBypassAck: false,
    isSuperuser: false,
    bypassRls: false,
    ...overrides,
  };
}

describe("shouldRefuseServingRole", () => {
  it("REFUSES a production pg superuser role", () => {
    const v = shouldRefuseServingRole(inputs({ isSuperuser: true }));
    expect(v).toEqual({ refuse: true, cause: "superuser" });
  });

  it("REFUSES a production pg BYPASSRLS role", () => {
    const v = shouldRefuseServingRole(inputs({ bypassRls: true }));
    expect(v).toEqual({ refuse: true, cause: "bypassrls" });
  });

  it("reports superuser cause first when both are set", () => {
    const v = shouldRefuseServingRole(
      inputs({ isSuperuser: true, bypassRls: true }),
    );
    expect(v).toEqual({ refuse: true, cause: "superuser" });
  });

  it("ALLOWS a well-configured NOBYPASSRLS production app role", () => {
    expect(shouldRefuseServingRole(inputs())).toEqual({ refuse: false });
  });

  it("ALLOWS when the operator acknowledges via RA_ALLOW_BYPASSRLS_DB", () => {
    const v = shouldRefuseServingRole(
      inputs({ isSuperuser: true, bypassRls: true, allowBypassAck: true }),
    );
    expect(v).toEqual({ refuse: false });
  });

  it("ALLOWS pglite regardless of privileges (dev/test driver)", () => {
    const v = shouldRefuseServingRole(
      inputs({ driver: "pglite", isSuperuser: true, bypassRls: true }),
    );
    expect(v).toEqual({ refuse: false });
  });

  it("ALLOWS non-production even on a pg superuser role", () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      const v = shouldRefuseServingRole(
        inputs({ nodeEnv, isSuperuser: true, bypassRls: true }),
      );
      expect(v).toEqual({ refuse: false });
    }
  });

  it("only refuses on the exact (pg + production + !ack + privileged) cell", () => {
    // Exhaustive truth table over the five boolean-ish dimensions. The pure
    // function must refuse iff: pg AND production AND not-acknowledged AND
    // (superuser OR bypassRls).
    const drivers: Array<ServingRoleInputs["driver"]> = ["pg", "pglite"];
    const envs = ["production", "development"];
    for (const driver of drivers) {
      for (const nodeEnv of envs) {
        for (const allowBypassAck of [false, true]) {
          for (const isSuperuser of [false, true]) {
            for (const bypassRls of [false, true]) {
              const v = shouldRefuseServingRole({
                driver,
                nodeEnv,
                allowBypassAck,
                isSuperuser,
                bypassRls,
              });
              const expectRefuse =
                driver === "pg" &&
                nodeEnv === "production" &&
                !allowBypassAck &&
                (isSuperuser || bypassRls);
              expect(v.refuse).toBe(expectRefuse);
            }
          }
        }
      }
    }
  });
});
