/**
 * Integration: add_property_note → invalidate → re-read → note present.
 *
 * Verifies that a mutation written via /api/tools/add_property_note is
 * observed on a subsequent /api/properties/<assessmentNumber> read after
 * the EvaluationContext is invalidated. With the DB-wired path active
 * the note hits Postgres and the cache is rebuilt from DB rows.
 */

import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { bootstrapTestEnv, makeSession, sessionHeader } from "./setup";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../../lib/auth";

let toolsPOST: (
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) => Promise<Response>;
let propertyGET: (
  req: NextRequest,
  ctx: { params: Promise<{ assessmentNumber: string }> },
) => Promise<Response>;

const ASSESSMENT = "TPS-1102-91";

beforeAll(async () => {
  await bootstrapTestEnv();
  _resetAuthSecretCacheForTests();
  const toolsRoute = await import("../../app/api/tools/[name]/route");
  toolsPOST = toolsRoute.POST as typeof toolsPOST;
  const propRoute = await import(
    "../../app/api/properties/[assessmentNumber]/route"
  );
  propertyGET = propRoute.GET as typeof propertyGET;
});

beforeEach(async () => {
  await bootstrapTestEnv();
});

describe("mutation persistence — add_property_note survives invalidate", () => {
  it("preview + confirm appends the note, and a subsequent property read sees it", async () => {
    const s = makeSession(["council_admin"]);
    const headers = new Headers({
      "content-type": "application/json",
      ...sessionHeader(s),
      origin: "http://localhost",
    });
    const NOTE = "Integration test — observed second access ramp Aug 2024.";

    // Preview
    const previewReq = new NextRequest(
      new URL("http://localhost/api/tools/add_property_note"),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          input: {
            assessmentNumber: ASSESSMENT,
            note: NOTE,
            confirm: false,
          },
        }),
      },
    );
    const previewRes = await toolsPOST(previewReq, {
      params: Promise.resolve({ name: "add_property_note" }),
    });
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as {
      ok: boolean;
      commitToken?: string;
    };
    expect(preview.ok).toBe(true);
    expect(typeof preview.commitToken).toBe("string");

    // Confirm
    const confirmReq = new NextRequest(
      new URL("http://localhost/api/tools/add_property_note"),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          input: {
            assessmentNumber: ASSESSMENT,
            note: NOTE,
            confirm: true,
            commitToken: preview.commitToken,
          },
        }),
      },
    );
    const confirmRes = await toolsPOST(confirmReq, {
      params: Promise.resolve({ name: "add_property_note" }),
    });
    expect(confirmRes.status).toBe(200);
    const confirm = (await confirmRes.json()) as {
      ok: boolean;
      mutated?: boolean;
      data?: { property: { notes: string[] } };
    };
    expect(confirm.ok).toBe(true);
    expect(confirm.mutated).toBe(true);
    expect(confirm.data?.property.notes).toContain(NOTE);

    // Invalidate + read back via the property route. The route reads
    // through the in-proc adapter, which is authoritative for the note
    // mutation. The integration test asserts the note is still observable
    // — proving the mutation didn't disappear between the tool call and
    // the next read.
    const clients = await import("../../lib/clients");
    await clients.invalidateEvaluationContext();

    const getReq = new NextRequest(
      new URL(`http://localhost/api/properties/${ASSESSMENT}`),
      {
        method: "GET",
        headers: new Headers({ [SESSION_HEADER]: JSON.stringify(s) }),
      },
    );
    const getRes = await propertyGET(getReq, {
      params: Promise.resolve({ assessmentNumber: ASSESSMENT }),
    });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as {
      ok: boolean;
      data: { property: { notes: string[] } };
    };
    expect(body.ok).toBe(true);
    expect(body.data.property.notes).toContain(NOTE);
  }, 30_000);
});
