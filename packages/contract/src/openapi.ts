/**
 * @ratesassist/contract — OpenAPI 3.1 builder.
 *
 * Builds an OpenAPI 3.1 document for the RatesAssist REST surface from the
 * canonical Zod schemas in ./schemas.ts. Used by /api/openapi.json so we
 * have a single source of truth for the public REST shape.
 *
 * Implementation note. The brief proposes `@asteasolutions/zod-to-openapi`,
 * which is the right long-term call for richer schema metadata (`.openapi(...)`
 * descriptors, response examples, polymorphic responses). It is not yet in
 * the contract package's dependency closure; rather than wedge an install
 * into Round 4B we use `zod-to-json-schema` (already a contract dep) and
 * inline a small OpenAPI 3.1 wrapper. Migrating to `zod-to-openapi` later
 * is mechanical: replace `jsonSchemaFor` and the `paths` registrations,
 * leave `buildOpenApiDocument` untouched.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

import { inputs, toolResult } from "./schemas.js";

// Avoid an import cycle with ./index.js — keep the version literal local.
const CONTRACT_VERSION = "0.2.0";

type JsonSchema = Record<string, unknown>;

type Parameter = {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  description?: string;
  schema: JsonSchema;
};

type Operation = {
  summary: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: {
    required: boolean;
    content: { "application/json": { schema: JsonSchema } };
  };
  responses: Record<
    string,
    {
      description: string;
      content?: { [mt: string]: { schema: JsonSchema } };
    }
  >;
};

type PathItem = Partial<Record<"get" | "post" | "put" | "patch" | "delete", Operation>>;

export type OpenApiOptions = {
  baseUrl?: string;
};

/**
 * Build a JSON-Schema object from a Zod schema, with `$ref`s rewritten to
 * point at OpenAPI 3.1 components. The default `zodToJsonSchema` output
 * uses `#/definitions/...`; OpenAPI uses `#/components/schemas/...`.
 */
function jsonSchemaFor(schema: z.ZodTypeAny): JsonSchema {
  const out = zodToJsonSchema(schema, { target: "openApi3" }) as JsonSchema;
  // Strip the JSON-Schema dialect marker — OpenAPI 3.1 supplies its own.
  delete (out as { $schema?: unknown }).$schema;
  return out;
}

const STRING: JsonSchema = { type: "string" };
const INT: JsonSchema = { type: "integer" };

/** OK envelope schema parameterised by the inner data schema. */
function okEnvelope(dataSchema: JsonSchema): JsonSchema {
  return {
    type: "object",
    required: ["ok", "data"],
    properties: {
      ok: { type: "boolean", const: true },
      data: dataSchema,
      pagination: {
        type: "object",
        required: ["total", "limit", "offset"],
        properties: { total: INT, limit: INT, offset: INT },
      },
    },
  };
}

const FAIL_ENVELOPE: JsonSchema = {
  type: "object",
  required: ["ok", "code", "message"],
  properties: {
    ok: { type: "boolean", const: false },
    code: {
      type: "string",
      enum: [
        "not_found",
        "invalid_input",
        "unauthorized",
        "forbidden",
        "conflict",
        "commit_token_invalid",
        "commit_token_expired",
        "rate_limited",
        "upstream_error",
        "timeout",
        "internal_error",
      ],
    },
    message: { type: "string" },
  },
};

/** Common response set used by most read endpoints. */
function readResponses(okSchema: JsonSchema): Operation["responses"] {
  return {
    "200": {
      description: "OK",
      content: { "application/json": { schema: okEnvelope(okSchema) } },
    },
    "304": { description: "Not modified (matched If-None-Match)." },
    "400": {
      description: "Invalid input.",
      content: { "application/json": { schema: FAIL_ENVELOPE } },
    },
    "401": {
      description: "Unauthenticated.",
      content: { "application/json": { schema: FAIL_ENVELOPE } },
    },
    "404": {
      description: "Not found.",
      content: { "application/json": { schema: FAIL_ENVELOPE } },
    },
    "502": {
      description: "Upstream adapter error.",
      content: { "application/json": { schema: FAIL_ENVELOPE } },
    },
  };
}

/**
 * Build the OpenAPI 3.1 document. Pure function — caller may persist it,
 * cache it, or stream it from a route.
 */
export function buildOpenApiDocument(opts: OpenApiOptions = {}): JsonSchema {
  const baseUrl = opts.baseUrl ?? "https://ratesassist.app";

  // Component schemas — every Zod input is referenceable by the tool name.
  const componentSchemas: Record<string, JsonSchema> = {
    ToolResult: jsonSchemaFor(toolResult),
    OkEnvelope: okEnvelope({}),
    FailEnvelope: FAIL_ENVELOPE,
  };
  for (const [name, schema] of Object.entries(inputs)) {
    componentSchemas[`Input_${name}`] = jsonSchemaFor(schema as z.ZodTypeAny);
  }

  // ===== Paths =====
  const paths: Record<string, PathItem> = {};

  // -- New Round 4B entity routes --

  paths["/api/properties/{assessmentNumber}"] = {
    get: {
      summary: "Get a single property by assessment number.",
      tags: ["properties"],
      parameters: [
        {
          name: "assessmentNumber",
          in: "path",
          required: true,
          schema: STRING,
          description: "Council-assigned assessment number.",
        },
        {
          name: "include",
          in: "query",
          required: false,
          schema: STRING,
          description:
            "Comma-separated subset of {transactions,signals,tenements}.",
        },
      ],
      responses: readResponses({
        type: "object",
        properties: {
          property: { type: "object" },
          owners: { type: "array", items: { type: "object" } },
          tenements: { type: "array", items: { type: "object" } },
          transactions: { type: "array", items: { type: "object" } },
          signals: { type: "array", items: { type: "object" } },
        },
      }),
    },
  };

  paths["/api/owners/{ownerId}"] = {
    get: {
      summary: "Get a single owner by id, with portfolio.",
      tags: ["owners"],
      parameters: [
        { name: "ownerId", in: "path", required: true, schema: STRING },
      ],
      responses: readResponses({
        type: "object",
        properties: {
          owner: { type: "object" },
          portfolio: { type: "array", items: { type: "object" } },
          abnCheck: { type: "object" },
        },
      }),
    },
  };

  paths["/api/tenements/{tenementId}"] = {
    get: {
      summary: "Get a single mining tenement (URL-encoded raw tenid).",
      tags: ["tenements"],
      parameters: [
        { name: "tenementId", in: "path", required: true, schema: STRING },
        {
          name: "sinceDays",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 365 },
        },
      ],
      responses: readResponses({
        type: "object",
        properties: {
          tenement: { type: "object" },
          intersectingParcels: { type: "array", items: { type: "object" } },
          cadastreSource: { type: "string" },
          minedexUrl: { type: "string", format: "uri" },
        },
      }),
    },
  };

  paths["/api/recovery/candidates"] = {
    get: {
      summary: "List recovery candidates (paginated, filterable).",
      tags: ["recovery"],
      parameters: [
        {
          name: "severity",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["high", "medium", "low"] },
        },
        { name: "signal", in: "query", required: false, schema: STRING },
        {
          name: "sortBy",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["score", "uplift", "granted"] },
        },
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 200 },
        },
        {
          name: "offset",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 0 },
        },
      ],
      responses: readResponses({
        type: "object",
        properties: {
          candidates: { type: "array", items: { type: "object" } },
          stats: { type: "object" },
        },
      }),
    },
  };

  paths["/api/recovery/candidates/{assessmentNumber}"] = {
    get: {
      summary: "Single recovery candidate detail.",
      tags: ["recovery"],
      parameters: [
        { name: "assessmentNumber", in: "path", required: true, schema: STRING },
      ],
      responses: readResponses({ type: "object" }),
    },
  };

  paths["/api/exports/csv"] = {
    post: {
      summary: "Stream a CSV export for a given dataset type.",
      tags: ["exports"],
      parameters: [
        {
          name: "type",
          in: "query",
          required: true,
          schema: {
            type: "string",
            enum: ["candidates", "grants", "overdue"],
          },
        },
      ],
      requestBody: {
        required: false,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: {
        "200": {
          description: "CSV body.",
          content: { "text/csv": { schema: { type: "string" } } },
        },
        "400": {
          description: "Invalid input.",
          content: { "application/json": { schema: FAIL_ENVELOPE } },
        },
        "401": {
          description: "Unauthenticated.",
          content: { "application/json": { schema: FAIL_ENVELOPE } },
        },
        "502": {
          description: "Upstream adapter error.",
          content: { "application/json": { schema: FAIL_ENVELOPE } },
        },
      },
    },
  };

  // -- Existing routes (read-only descriptive entries; not authoritative
  //    until those routes are migrated to the new envelope) --

  paths["/api/data"] = {
    get: {
      summary: "Recovery snapshot (legacy; will be retired).",
      tags: ["recovery"],
      parameters: [
        { name: "include", in: "query", required: false, schema: STRING },
      ],
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/grants"] = {
    get: {
      summary: "Recently-granted live mining tenements.",
      tags: ["grants"],
      parameters: [
        { name: "sinceDays", in: "query", required: false, schema: INT },
        { name: "lgaName", in: "query", required: false, schema: STRING },
        { name: "types", in: "query", required: false, schema: STRING },
      ],
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/grants/{tenementId}"] = {
    get: {
      summary: "Single grant briefing.",
      tags: ["grants"],
      parameters: [
        { name: "tenementId", in: "path", required: true, schema: STRING },
        { name: "sinceDays", in: "query", required: false, schema: INT },
      ],
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/signals"] = {
    get: {
      summary: "Signal catalogue.",
      tags: ["signals"],
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/discovery"] = {
    get: {
      summary: "Discovery feed.",
      tags: ["discovery"],
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/spatial/{layer}"] = {
    get: {
      summary: "Spatial GeoJSON layer.",
      tags: ["spatial"],
      parameters: [
        { name: "layer", in: "path", required: true, schema: STRING },
      ],
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/evidence"] = {
    get: {
      summary: "Evidence pack endpoint.",
      tags: ["evidence"],
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/activity"] = {
    get: {
      summary: "Recent audit-log activity.",
      tags: ["activity"],
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/tenants"] = {
    get: {
      summary: "Tenants list.",
      tags: ["tenants"],
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/integrations"] = {
    get: {
      summary: "Integration cards.",
      tags: ["integrations"],
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/reconciliation"] = {
    get: {
      summary: "Bank reconciliation view.",
      tags: ["reconciliation"],
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/chat"] = {
    post: {
      summary: "Chat (LLM tool-use loop).",
      tags: ["chat"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: { "200": { description: "OK" } },
    },
  };

  paths["/api/tools/{name}"] = {
    post: {
      summary: "Direct MCP tool invocation.",
      tags: ["tools"],
      parameters: [
        { name: "name", in: "path", required: true, schema: STRING },
      ],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: {
        "200": {
          description: "Tool result.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ToolResult" },
            },
          },
        },
      },
    },
  };

  paths["/api/openapi.json"] = {
    get: {
      summary: "This document.",
      tags: ["meta"],
      responses: {
        "200": {
          description: "OpenAPI 3.1 document.",
          content: { "application/json": { schema: { type: "object" } } },
        },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "RatesAssist REST API",
      version: CONTRACT_VERSION,
      description:
        "Public REST surface for the RatesAssist platform. Council-tenant scoped.",
    },
    servers: [{ url: baseUrl }],
    paths,
    components: { schemas: componentSchemas },
    tags: [
      { name: "properties" },
      { name: "owners" },
      { name: "tenements" },
      { name: "recovery" },
      { name: "exports" },
      { name: "grants" },
      { name: "signals" },
      { name: "spatial" },
      { name: "evidence" },
      { name: "activity" },
      { name: "tenants" },
      { name: "integrations" },
      { name: "reconciliation" },
      { name: "chat" },
      { name: "tools" },
      { name: "discovery" },
      { name: "meta" },
    ],
  };
}
