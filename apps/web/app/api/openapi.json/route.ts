/**
 * GET /api/openapi.json — OpenAPI 3.1 document.
 *
 * Built from the contract's Zod schemas via `buildOpenApiDocument`.
 * Cached publicly for an hour; downstream tooling (Swagger UI, Postman,
 * code generators) can poll this URL safely.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@ratesassist/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const doc = buildOpenApiDocument({ baseUrl });
  return NextResponse.json(doc, {
    status: 200,
    headers: {
      "cache-control": "public, max-age=3600",
    },
  });
}
