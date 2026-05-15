/**
 * Integration: rate-table uplift roundtrip.
 *
 * For KAL-4401-12 the demo fixtures pre-pin:
 *   - landUse: Rural (current, stale)
 *   - GRV: 22_500
 *   - UV : 63_100
 *   - change.commercial_use_observed with correctLandUse = Mining
 *
 * The KAL rate table (packages/contract/src/rateTables/wa-2025-26.ts)
 * publishes UV Mining Operations at 0.193584 c/$, minimum payment $455.
 * The recovery engine should therefore produce a candidate whose
 * `correctAnnualRates` equals:
 *
 *     max(UV × rate, minimumPayment)
 *   = max(63_100 × 0.193584, 455)
 *   = max(12_215.15..., 455)
 *   = 12_215.15... (rounded → 12_215)
 *
 * The candidate route returns `correctAnnualRates` as a number rounded to
 * the nearest dollar (engine math), so we assert against that integer.
 */

import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { bootstrapTestEnv, makeSession } from "./setup";
import { SESSION_HEADER, _resetAuthSecretCacheForTests } from "../../lib/auth";

const ASSESSMENT = "KAL-4401-12";

let candidatesGET: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  await bootstrapTestEnv();
  _resetAuthSecretCacheForTests();
  const candidatesRoute = await import("../../app/api/recovery/candidates/route");
  candidatesGET = candidatesRoute.GET as typeof candidatesGET;
});

beforeEach(async () => {
  await bootstrapTestEnv();
});

describe("rate-table uplift end-to-end", () => {
  it("computes correctAnnualRates = max(UV × rate, minPayment) for KAL-4401-12", async () => {
    const s = makeSession(["rates_supervisor"]);
    const req = new NextRequest(
      new URL("http://localhost/api/recovery/candidates?limit=200"),
      {
        method: "GET",
        headers: new Headers({ [SESSION_HEADER]: JSON.stringify(s) }),
      },
    );
    const res = await candidatesGET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        candidates: Array<{
          assessmentNumber: string;
          correctAnnualRates?: number;
          estAnnualRatesNew?: number;
          signals: Array<{ id: string }>;
        }>;
      };
    };
    expect(body.ok).toBe(true);

    const candidate = body.data.candidates.find(
      (c) => c.assessmentNumber === ASSESSMENT,
    );
    expect(candidate).toBeDefined();

    // Sanity: a lifecycle-change signal fired so the accurate-uplift path
    // was used (rather than the heuristic).
    expect(candidate!.signals.some((s) => s.id.startsWith("change."))).toBe(true);

    // Formula validation. The engine rounds to dollars; the published rate
    // (0.193584) × UV (63100) = 12_215.16 → rounds to 12_215.
    const UV = 63_100;
    const RATE = 0.193584;
    const MIN_PAYMENT = 455;
    const expected = Math.round(Math.max(UV * RATE, MIN_PAYMENT));

    // The engine surfaces `correctAnnualRates` (when the accurate path
    // succeeded) and `estAnnualRatesNew` (the rounded copy). Either way
    // we should land on the same dollar figure.
    const surfaced =
      candidate!.correctAnnualRates ?? candidate!.estAnnualRatesNew;
    expect(surfaced).toBeDefined();
    expect(Math.round(surfaced!)).toBe(expected);
  }, 30_000);
});
