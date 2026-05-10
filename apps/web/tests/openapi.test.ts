/**
 * Round 4B — OpenAPI document tests.
 *
 * Validates structural integrity (3.1.0 marker, info, paths, components),
 * presence of every Round 4B path, and that every Zod tool input from
 * the contract is referenced under components.schemas.
 */

import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, schemas } from "@ratesassist/contract";

describe("buildOpenApiDocument", () => {
  const doc = buildOpenApiDocument({ baseUrl: "http://localhost:3000" });
  const d = doc as {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<string, unknown>;
    components: { schemas: Record<string, unknown> };
    servers: { url: string }[];
  };

  it("emits an OpenAPI 3.1 document", () => {
    expect(d.openapi).toBe("3.1.0");
    expect(d.info.title).toContain("RatesAssist");
    expect(d.info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(d.servers[0]!.url).toContain("localhost:3000");
  });

  it("includes the six new Round 4B routes", () => {
    expect(d.paths["/api/properties/{assessmentNumber}"]).toBeDefined();
    expect(d.paths["/api/owners/{ownerId}"]).toBeDefined();
    expect(d.paths["/api/tenements/{tenementId}"]).toBeDefined();
    expect(d.paths["/api/recovery/candidates"]).toBeDefined();
    expect(d.paths["/api/recovery/candidates/{assessmentNumber}"]).toBeDefined();
    expect(d.paths["/api/exports/csv"]).toBeDefined();
  });

  it("includes the openapi endpoint itself", () => {
    expect(d.paths["/api/openapi.json"]).toBeDefined();
  });

  it("references every Zod tool input under components.schemas", () => {
    for (const name of Object.keys(schemas.inputs)) {
      expect(d.components.schemas[`Input_${name}`]).toBeDefined();
    }
  });

  it("declares the standard ToolResult and envelope shapes", () => {
    expect(d.components.schemas.ToolResult).toBeDefined();
    expect(d.components.schemas.OkEnvelope).toBeDefined();
    expect(d.components.schemas.FailEnvelope).toBeDefined();
  });

  it("paths declare at least one operation each", () => {
    for (const [p, item] of Object.entries(d.paths)) {
      const keys = Object.keys(item as Record<string, unknown>);
      expect(
        keys.some((k) => ["get", "post", "put", "patch", "delete"].includes(k)),
        `path ${p} has no HTTP method`,
      ).toBe(true);
    }
  });
});
