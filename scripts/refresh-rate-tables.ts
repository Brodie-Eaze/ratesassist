#!/usr/bin/env tsx
/**
 * scripts/refresh-rate-tables.ts
 *
 * Automation for the quarterly (or pre-pilot) refresh of WA rate-table
 * data. Pulls each council's 2025-26 schedule from the public source the
 * file in `packages/contract/src/rateTables/wa-2025-26.ts` was last
 * verified against, then emits a JSON diff at
 * `scripts/proposed-rate-tables.json` for human review.
 *
 * DESIGN NOTE: this script intentionally does NOT auto-commit and does
 * NOT mutate the source-of-truth file. Council websites are flaky and a
 * silent rewrite would be a credibility hazard. Every diff is reviewed
 * by a human before it lands.
 *
 * Run via the root npm script:
 *
 *     npm run refresh-rate-tables
 *
 * The exit code is 0 if every council was reachable (and any diff is
 * cosmetic) and 0 even when councils are unreachable — the failure is
 * surfaced in the report, not the exit code, because a council outage
 * is not a CI failure.
 *
 * Output schema (scripts/proposed-rate-tables.json):
 *
 *     {
 *       "runAt": ISO-8601,
 *       "councils": [
 *         {
 *           "code": "KAL",
 *           "sourceUrl": "...",
 *           "status": "fetched" | "unreachable" | "parse_failed",
 *           "httpStatus": number,
 *           "before": <RateTable from source>,
 *           "afterSummary": {
 *              "linesByCategory": { Residential: 0.05372, ... }
 *           },
 *           "diff": [ { category, field, before, after } ]
 *         }
 *       ]
 *     }
 *
 * Parser-related caveats
 * ----------------------
 * Council budget PDFs are not machine-parseable in a portable way (every
 * shire uses a slightly different LibreOffice template). The parser
 * below extracts what it can with regex against `pdftotext -layout`
 * output (when `pdftotext` is on PATH) and otherwise falls back to a
 * "status: parse_unsupported" placeholder. The human reviewer is then
 * pointed at the source URL.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  WA_RATE_TABLES,
  type LandUseCategory,
  type RateTable,
} from "../packages/contract/src/index.js";

// ===== Council fetch plan =====

type CouncilPlan = {
  readonly code: string;
  readonly sourceUrl: string;
  /**
   * Discriminator for the per-council parser. Most councils publish a
   * statutory-budget PDF with a "Rate in dollar" / "Minimum payment"
   * column structure parseable with the same regex; a couple use prose
   * paragraphs ("Rate in the dollar of 0.087975") that need a different
   * parser.
   */
  readonly format: "table" | "prose";
};

const COUNCIL_PLAN: readonly CouncilPlan[] = [
  {
    code: "KAL",
    sourceUrl:
      "https://www.ckb.wa.gov.au/Profiles/ckb/Assets/ClientData/2025-26-Statutory-Budget.pdf",
    format: "table",
  },
  {
    code: "ESH",
    sourceUrl:
      "https://www.eastpilbara.wa.gov.au/documents/1439/202526-statutory-budget",
    format: "table",
  },
  {
    code: "ASH",
    sourceUrl:
      "https://www.ashburton.wa.gov.au/documents/410/2025-2026-annual-budget",
    format: "table",
  },
  {
    code: "TPS",
    sourceUrl:
      "https://www.ashburton.wa.gov.au/documents/410/2025-2026-annual-budget",
    format: "table",
  },
  {
    code: "MEK",
    sourceUrl:
      "https://www.meekashire.wa.gov.au/documents/594/2025-26-statutory-budget",
    format: "prose",
  },
  {
    code: "SST",
    sourceUrl:
      "https://www.sandstone.wa.gov.au/repository/libraries/id:2pgaygvvh17q9smi2m5z/hierarchy/Documents/Council%20Documents/Rating%20Strategy%20Objectives%20%20Reasons%202025-2026.pdf",
    format: "prose",
  },
] as const;

// ===== Output schema =====

type ParsedRow = {
  readonly category: string;
  readonly rateInDollar: number | null;
  readonly minimumPayment: number | null;
  readonly basis: "GRV" | "UV" | null;
};

type CouncilReport = {
  readonly code: string;
  readonly sourceUrl: string;
  readonly status:
    | "fetched"
    | "unreachable"
    | "parse_failed"
    | "parse_unsupported";
  readonly httpStatus?: number;
  readonly errorMessage?: string;
  readonly before: RateTable | null;
  readonly afterSummary: {
    readonly linesByCategory: Readonly<Record<string, ParsedRow>>;
  };
  readonly diffs: ReadonlyArray<{
    readonly category: LandUseCategory;
    readonly field: "rateInDollar" | "minimumPayment";
    readonly before: number;
    readonly after: number;
  }>;
};

// ===== HTTP fetch =====

const USER_AGENT =
  "RatesAssist/rate-table-refresh (https://github.com/your-org/RatesAssist)";

async function fetchPdf(url: string): Promise<
  | { ok: true; httpStatus: number; bytes: Uint8Array }
  | { ok: false; httpStatus: number; error: string }
> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/pdf,*/*" },
      // 30s ceiling — council CDNs can be slow.
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { ok: false, httpStatus: res.status, error: `HTTP ${res.status}` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return { ok: true, httpStatus: res.status, bytes: buf };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "fetch failed";
    return { ok: false, httpStatus: 0, error: message };
  }
}

// ===== pdftotext shim =====

let pdftotextChecked = false;
let pdftotextAvailable = false;

function hasPdftotext(): boolean {
  if (pdftotextChecked) return pdftotextAvailable;
  pdftotextChecked = true;
  const r = spawnSync("which", ["pdftotext"], { encoding: "utf8" });
  pdftotextAvailable = r.status === 0;
  return pdftotextAvailable;
}

function pdftotextLayout(bytes: Uint8Array): string | null {
  if (!hasPdftotext()) return null;
  const cacheDir = join(tmpdir(), "ratesassist-rate-refresh");
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const inPath = join(cacheDir, `in-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(inPath, bytes);
  const r = spawnSync("pdftotext", ["-layout", inPath, "-"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout;
}

// ===== Parsers =====

/**
 * Table parser — for shires that publish a budget Note 2(a) "General
 * rates" matrix where each row is `Category  Basis  RateInDollar  ...`.
 * Best-effort: returns null for any row we can't confidently extract.
 */
function parseTableFormat(text: string): Record<string, ParsedRow> {
  const out: Record<string, ParsedRow> = {};
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip headers, totals, etc.
    if (!/^[A-Z][A-Za-z]/.test(trimmed)) continue;
    // We look for lines like:
    //   GRV Residential  Gross rental valuation  0.053716  ...
    //   UV Mining        Unimproved valuation    0.193584  ...
    const m = trimmed.match(
      /^(?<cat>[A-Z][A-Za-z /]*?)\s+(Gross rental valuation|Unimproved valuation|GRV|UV)\s+([0-9]\.[0-9]{4,7})\s+/,
    );
    if (m !== null) {
      const cat = (m.groups?.["cat"] ?? "").trim();
      const basis: "GRV" | "UV" = /Gross|GRV/.test(m[2] ?? "") ? "GRV" : "UV";
      const rate = Number.parseFloat(m[3] ?? "");
      if (Number.isFinite(rate) && rate > 0 && rate < 1 && cat.length >= 3) {
        out[cat] = {
          category: cat,
          rateInDollar: rate,
          minimumPayment: null,
          basis,
        };
      }
    }
  }
  return out;
}

/**
 * Prose parser — for shires (Meekatharra, Sandstone) that put rates in
 * paragraph form. Matches sentences like:
 *   "GRV - Rate in the dollar of 0.098325"
 *   "GRV Townsite be 7.2852 cents in the dollar"
 *   "Minimum payment of $414"
 */
function parseProseFormat(text: string): Record<string, ParsedRow> {
  const out: Record<string, ParsedRow> = {};
  // Pattern 1: "<category> ... rate in the dollar of 0.XXXXXX"
  const decRe =
    /\b(GRV[A-Za-z /-]*|UV[A-Za-z /-]*)\b[^.\n]{0,200}?rate (?:in (?:the )?)?(?:dollar|\$).{0,30}?([0-9]\.[0-9]{3,7})/gi;
  for (const m of text.matchAll(decRe)) {
    const cat = (m[1] ?? "").trim();
    const rate = Number.parseFloat(m[2] ?? "");
    if (Number.isFinite(rate) && rate > 0 && rate < 1 && cat.length >= 3) {
      out[cat] = out[cat] ?? {
        category: cat,
        rateInDollar: rate,
        minimumPayment: null,
        basis: /UV/i.test(cat) ? "UV" : "GRV",
      };
      if (out[cat]!.rateInDollar === null) {
        out[cat] = { ...out[cat]!, rateInDollar: rate };
      }
    }
  }
  // Pattern 2: "X.YYYY cents in the dollar"
  const centsRe =
    /\b(GRV[A-Za-z /-]*|UV[A-Za-z /-]*)\b[^.\n]{0,200}?([0-9]+\.[0-9]{2,5})\s*cents\s*in\s*the\s*dollar/gi;
  for (const m of text.matchAll(centsRe)) {
    const cat = (m[1] ?? "").trim();
    const cents = Number.parseFloat(m[2] ?? "");
    if (Number.isFinite(cents) && cents > 0 && cents < 100 && cat.length >= 3) {
      const rate = cents / 100;
      out[cat] = out[cat] ?? {
        category: cat,
        rateInDollar: rate,
        minimumPayment: null,
        basis: /UV/i.test(cat) ? "UV" : "GRV",
      };
      if (out[cat]!.rateInDollar === null) {
        out[cat] = { ...out[cat]!, rateInDollar: rate };
      }
    }
  }
  return out;
}

// ===== Diff =====

function compareToCurrent(
  parsed: Record<string, ParsedRow>,
  before: RateTable | null,
): CouncilReport["diffs"] {
  if (before === null) return [];
  const diffs: Array<{
    category: LandUseCategory;
    field: "rateInDollar" | "minimumPayment";
    before: number;
    after: number;
  }> = [];
  // Match parsed-row category strings back to schema categories by
  // substring match. This is a hint for the human reviewer, not a
  // proof — false positives are surfaced in the JSON for review.
  const knownCats: readonly LandUseCategory[] = [
    "Residential",
    "Commercial",
    "Industrial",
    "Rural",
    "Vacant",
    "Mining",
    "MiningOther",
    "Pastoral",
  ];
  for (const [parsedKey, row] of Object.entries(parsed)) {
    if (row.rateInDollar === null) continue;
    const lower = parsedKey.toLowerCase();
    const matched = knownCats.find((c) => lower.includes(c.toLowerCase()));
    if (matched === undefined) continue;
    const beforeLine = before.lines.find((l) => l.landUse === matched);
    if (beforeLine === undefined) continue;
    if (Math.abs(beforeLine.rateInDollar - row.rateInDollar) > 1e-6) {
      diffs.push({
        category: matched,
        field: "rateInDollar",
        before: beforeLine.rateInDollar,
        after: row.rateInDollar,
      });
    }
  }
  return diffs;
}

// ===== Main =====

async function main(): Promise<void> {
  const reports: CouncilReport[] = [];
  for (const plan of COUNCIL_PLAN) {
    process.stdout.write(`[refresh] ${plan.code}: fetching ${plan.sourceUrl} … `);
    const res = await fetchPdf(plan.sourceUrl);
    const before = WA_RATE_TABLES[plan.code] ?? null;
    if (!res.ok) {
      process.stdout.write(`unreachable (${res.error})\n`);
      reports.push({
        code: plan.code,
        sourceUrl: plan.sourceUrl,
        status: "unreachable",
        httpStatus: res.httpStatus,
        errorMessage: res.error,
        before,
        afterSummary: { linesByCategory: {} },
        diffs: [],
      });
      continue;
    }

    const text = pdftotextLayout(res.bytes);
    if (text === null) {
      process.stdout.write(
        `parse_unsupported (no pdftotext on PATH or extraction failed)\n`,
      );
      reports.push({
        code: plan.code,
        sourceUrl: plan.sourceUrl,
        status: "parse_unsupported",
        httpStatus: res.httpStatus,
        before,
        afterSummary: { linesByCategory: {} },
        diffs: [],
      });
      continue;
    }

    const parsed =
      plan.format === "prose" ? parseProseFormat(text) : parseTableFormat(text);
    if (Object.keys(parsed).length === 0) {
      process.stdout.write(`parse_failed (no rows extracted)\n`);
      reports.push({
        code: plan.code,
        sourceUrl: plan.sourceUrl,
        status: "parse_failed",
        httpStatus: res.httpStatus,
        before,
        afterSummary: { linesByCategory: {} },
        diffs: [],
      });
      continue;
    }

    const diffs = compareToCurrent(parsed, before);
    process.stdout.write(`fetched (${Object.keys(parsed).length} rows, ${diffs.length} diffs)\n`);
    reports.push({
      code: plan.code,
      sourceUrl: plan.sourceUrl,
      status: "fetched",
      httpStatus: res.httpStatus,
      before,
      afterSummary: { linesByCategory: parsed },
      diffs,
    });
  }

  const outPath = resolve(process.cwd(), "scripts", "proposed-rate-tables.json");
  const payload = {
    runAt: new Date().toISOString(),
    councils: reports,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  // Summary table.
  process.stdout.write("\nSummary:\n");
  for (const r of reports) {
    process.stdout.write(
      `  ${r.code.padEnd(4)} status=${r.status.padEnd(20)} diffs=${r.diffs.length}\n`,
    );
  }
  process.stdout.write(`\nReport written to ${outPath}\n`);
  process.stdout.write(
    "Review the diff and hand-merge into packages/contract/src/rateTables/wa-2025-26.ts.\n",
  );
  process.stdout.write(
    "DO NOT auto-apply — every change must be traceable to a published source.\n",
  );
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : "unknown error";
  process.stderr.write(`refresh-rate-tables: ${msg}\n`);
  process.exit(1);
});
