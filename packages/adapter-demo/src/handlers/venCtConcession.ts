/**
 * VEN + CT + Concession feature — Round 2 handler implementations.
 *
 * Four tools:
 *
 *  1. `import_rate_schedule` — council adopted differential rates CSV per FY
 *  2. `import_landgate_title_data` — Landgate title snapshot CSV (N PINs / VEN)
 *  3. `import_wc_eligibility` — Water Corp pensioner eligibility CSV
 *  4. `request_strata_conversion` — state-machine transition for strata-parent
 *     conversion workflow; materialises child Property records on
 *     `children_imported`.
 *
 * Patterns:
 *   - Two-phase commit (preview returns commitToken; confirm consumes it)
 *     for all four handlers, mirroring `import_rating_roll` / `add_council`.
 *   - Hand-rolled CSV parsing (no external deps; tolerant of extra columns,
 *     quotes, embedded newlines).
 *   - Audit-logged via `recordMutation` on commit, with before/after counts.
 *   - DataStore mutators are idempotent under repeated content.
 *
 * RBAC is enforced upstream at the REST/web layer — these handlers trust the
 * dispatcher's auth boundary. The route handlers gate on
 * `write.user_management` for the three CSV imports and `write.commit_mutation`
 * for `request_strata_conversion`.
 */

import { z } from "zod";
import type {
  Encumbrance,
  Pin,
  Property,
  TitleSourceFreshness,
  schemas,
} from "@ratesassist/contract";
import { createHash } from "node:crypto";

import { recordMutation } from "../audit/index.js";
import type {
  LandgateRecord,
  RateScheduleEntry,
  StrataLifecycle,
  StrataLifecycleState,
  WaterCorpEligibilityRecord,
} from "../data/index.js";
import type { RequestContext } from "../runtime/context.js";
import {
  conflict,
  invalidInput,
  notFound,
} from "../runtime/errors.js";

// ===== Helpers — small CSV parser (matches csvSchema.ts' RFC-4180-ish flavour) =====

/** Inline RFC-4180-ish CSV parser. Returns rows of cell strings. */
function parseCsvGrid(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  while (i < src.length) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      cur.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      if (src[i + 1] === "\n") i += 1;
      cur.push(cell);
      rows.push(cur);
      cur = [];
      cell = "";
      i += 1;
      continue;
    }
    if (c === "\n") {
      cur.push(cell);
      rows.push(cur);
      cur = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += c;
    i += 1;
  }
  if (cell.length > 0 || cur.length > 0) {
    cur.push(cell);
    rows.push(cur);
  }
  while (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.length === 1 && last[0]!.trim() === "") rows.pop();
    else break;
  }
  return rows;
}

/** Normalise a header cell — lower-case, strip non-alphanumeric, snake_case. */
function normHeader(s: string): string {
  return s
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Coerce a CSV cell to a number; returns NaN when blank or non-numeric. */
function num(cell: string | undefined): number {
  if (cell === undefined) return NaN;
  const trimmed = cell.trim();
  if (trimmed === "") return NaN;
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Trimmed cell or empty string. */
function cell(cells: readonly string[], idx: number | undefined): string {
  if (idx === undefined) return "";
  const v = cells[idx];
  if (v === undefined) return "";
  return v.trim();
}

/** Optional cell — undefined when blank. */
function cellOpt(
  cells: readonly string[],
  idx: number | undefined,
): string | undefined {
  if (idx === undefined) return undefined;
  const v = cells[idx];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

type RowError = {
  readonly row: number;
  readonly identifier?: string;
  readonly message: string;
};

// ===== 1. import_rate_schedule =====

const RateScheduleRowSchema = z
  .object({
    financialYear: z.string().regex(/^\d{4}-\d{2}$/, "format YYYY-YY"),
    rateCode: z.string().min(1).max(40),
    appliesToLanduse: z.enum([
      "Residential",
      "Commercial",
      "Industrial",
      "Vacant",
      "Rural",
      "Pastoral",
      "Mining",
      "MiningOther",
    ]),
    rateInDollar: z.number().positive().finite(),
    minimumPayment: z.number().nonnegative().finite(),
    basis: z.enum(["GRV", "UV"]),
  })
  .strict();

type ParsedRateRow = z.infer<typeof RateScheduleRowSchema>;

const RATE_REQUIRED = [
  "financial_year",
  "rate_code",
  "applies_to_landuse",
  "rate_in_dollar",
  "minimum_payment",
  "basis",
] as const;

function parseRateScheduleCsv(
  text: string,
  defaultFy: string,
):
  | { readonly ok: true; readonly rows: readonly ParsedRateRow[]; readonly errors: readonly RowError[] }
  | { readonly ok: false; readonly reason: string } {
  if (text.length === 0) return { ok: false, reason: "empty CSV" };
  const grid = parseCsvGrid(text);
  if (grid.length < 2) {
    return {
      ok: false,
      reason: "CSV must include a header row and at least one data row",
    };
  }
  const headerRow = grid[0]!.map(normHeader);
  const indexByKey: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    indexByKey[h] = i;
  });
  for (const req of RATE_REQUIRED) {
    if (indexByKey[req] === undefined) {
      return { ok: false, reason: `missing required header "${req}"` };
    }
  }
  const rows: ParsedRateRow[] = [];
  const errors: RowError[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]!;
    if (cells.every((c) => c.trim() === "")) continue;
    const rawFy = cell(cells, indexByKey["financial_year"]);
    const rawCode = cell(cells, indexByKey["rate_code"]);
    const candidate: Record<string, unknown> = {
      financialYear: rawFy === "" ? defaultFy : rawFy,
      rateCode: rawCode,
      appliesToLanduse: cell(cells, indexByKey["applies_to_landuse"]),
      rateInDollar: num(cell(cells, indexByKey["rate_in_dollar"])),
      minimumPayment: num(cell(cells, indexByKey["minimum_payment"])),
      basis: cell(cells, indexByKey["basis"]).toUpperCase(),
    };
    const parsed = RateScheduleRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(row)"}: ${i.message}`)
        .join("; ");
      errors.push({
        row: r,
        ...(rawCode !== "" ? { identifier: rawCode } : {}),
        message,
      });
      continue;
    }
    if (parsed.data.financialYear !== defaultFy) {
      errors.push({
        row: r,
        identifier: rawCode,
        message: `row financial_year "${parsed.data.financialYear}" does not match request "${defaultFy}"`,
      });
      continue;
    }
    rows.push(parsed.data);
  }
  return { ok: true, rows, errors };
}

export async function importRateScheduleHandler(
  input: schemas.ToolInputs["import_rate_schedule"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const council = ctx.store.getCouncil(input.councilCode);
  if (council === undefined) {
    return notFound(
      `Council "${input.councilCode}" does not exist. Add the council first via add_council.`,
      ctx.correlationId,
    );
  }

  // ===== CONFIRM PATH =====
  if (input.confirm) {
    if (input.commitToken === undefined) {
      return invalidInput(
        "confirm=true requires a commitToken from the preview call.",
        ctx.correlationId,
      );
    }
    const consumed = ctx.commitTokens.consume(
      input.commitToken,
      "import_rate_schedule",
      { tenantId: ctx.tenantId, actorId: ctx.actorId },
    );
    if (!consumed.ok) {
      const reason =
        consumed.reason === "expired"
          ? "commitToken has expired (5 minute TTL); re-run the preview"
          : consumed.reason === "operation_mismatch"
            ? "commitToken was issued for a different operation"
            : "commitToken is unknown or already consumed";
      return conflict(reason, ctx.correlationId);
    }
    const mut = consumed.mutation;
    if (mut.operation !== "import_rate_schedule") {
      return conflict("commitToken operation mismatch.", ctx.correlationId);
    }
    if (mut.councilCode !== input.councilCode) {
      return conflict(
        "commitToken was issued for a different council code.",
        ctx.correlationId,
      );
    }
    if (mut.financialYear !== input.financialYear) {
      return conflict(
        "commitToken was issued for a different financial year.",
        ctx.correlationId,
      );
    }
    if (mut.mergeStrategy !== input.mergeStrategy) {
      return conflict(
        "commitToken was issued for a different mergeStrategy.",
        ctx.correlationId,
      );
    }
    const rows = mut.rows as readonly RateScheduleEntry[];

    const beforeCount = ctx.store.countRateScheduleForCouncilYear(
      input.councilCode,
      input.financialYear,
    );
    let inserted = 0;
    let updated = 0;
    let removed = 0;
    if (input.mergeStrategy === "replace") {
      const r = ctx.store.replaceRateScheduleForCouncilYear(
        input.councilCode,
        input.financialYear,
        rows,
      );
      removed = r.removed;
      inserted = r.inserted;
    } else {
      const r = ctx.store.upsertRateScheduleEntries(input.councilCode, rows);
      inserted = r.inserted;
      updated = r.updated;
    }
    const afterCount = ctx.store.countRateScheduleForCouncilYear(
      input.councilCode,
      input.financialYear,
    );

    recordMutation({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorKind: ctx.actorKind,
      action: "write.import_rate_schedule",
      target: {
        type: "council_rate_schedule",
        id: `${input.councilCode}-${input.financialYear}`,
      },
      before: { rowCount: beforeCount },
      after: {
        rowCount: afterCount,
        inserted,
        updated,
        removed,
        mergeStrategy: input.mergeStrategy,
      },
      correlationId: ctx.correlationId,
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
    });

    const output =
      input.mergeStrategy === "replace"
        ? `Imported ${inserted} rate-schedule rows for ${input.councilCode} ${input.financialYear} (${removed} replaced).`
        : `Imported ${inserted + updated} rate-schedule rows for ${input.councilCode} ${input.financialYear} (${inserted} new, ${updated} updated).`;

    return {
      ok: true,
      output,
      data: {
        councilCode: input.councilCode,
        financialYear: input.financialYear,
        mergeStrategy: input.mergeStrategy,
        inserted,
        updated,
        removed,
        beforeCount,
        afterCount,
      },
      mutated: true,
    };
  }

  // ===== PREVIEW PATH =====
  const parsed = parseRateScheduleCsv(input.csvText, input.financialYear);
  if (!parsed.ok) {
    return invalidInput(
      `CSV parse failed: ${parsed.reason}`,
      ctx.correlationId,
    );
  }
  const validCount = parsed.rows.length;
  const errorCount = parsed.errors.length;
  if (validCount === 0) {
    return invalidInput(
      `CSV produced 0 valid rows (${errorCount} errors). Aborting.`,
      ctx.correlationId,
    );
  }

  const token = ctx.commitTokens.issue({
    operation: "import_rate_schedule",
    councilCode: input.councilCode,
    financialYear: input.financialYear,
    mergeStrategy: input.mergeStrategy,
    rowCount: validCount,
    rows: parsed.rows as ReadonlyArray<Record<string, unknown>>,
  }, { tenantId: ctx.tenantId, actorId: ctx.actorId });

  const sampleRows = parsed.rows.slice(0, 5).map((r) => ({
    rateCode: r.rateCode,
    appliesToLanduse: r.appliesToLanduse,
    rateInDollar: r.rateInDollar,
    minimumPayment: r.minimumPayment,
    basis: r.basis,
  }));
  const errorPreview = parsed.errors.slice(0, 10);

  const verb = input.mergeStrategy === "replace" ? "replace" : "upsert into";
  const output = [
    `Preview: ${validCount} valid rows, ${errorCount} errors. Will ${verb} the rate schedule for ${input.councilCode} ${input.financialYear}.`,
    ``,
    `[NOT COMMITTED — re-run with confirm=true and commitToken=${token} within 5 minutes to apply.]`,
  ].join("\n");

  return {
    ok: true,
    output,
    data: {
      councilCode: input.councilCode,
      financialYear: input.financialYear,
      mergeStrategy: input.mergeStrategy,
      validCount,
      errorCount,
      sampleRows,
      errorPreview,
      commitToken: token,
    },
    commitToken: token,
    mutated: false,
  };
}

// ===== 2. import_landgate_title_data =====

type ParsedTitleRow = {
  readonly assessmentNumber?: string;
  readonly ven: string;
  readonly ctVolume?: string;
  readonly ctFolio?: string;
  readonly ctIssuedDate?: string;
  readonly proprietorName?: string;
  readonly proprietorPostalAddress?: string;
  readonly pin?: string;
  readonly lotPlan?: string;
  readonly landuseCode?: string;
  readonly areaSqm?: number;
  readonly encumbranceType?:
    | "mortgage"
    | "easement"
    | "caveat"
    | "tenement_notation"
    | "covenant"
    | "other";
  readonly encumbranceReference?: string;
  readonly encumbranceDate?: string;
  readonly strataParentVolume?: string;
  readonly strataParentFolio?: string;
};

const TitleRowSchema = z
  .object({
    assessmentNumber: z.string().min(1).max(40).optional(),
    ven: z.string().min(1).max(40),
    ctVolume: z.string().min(1).max(40).optional(),
    ctFolio: z.string().min(1).max(40).optional(),
    ctIssuedDate: z.string().min(1).max(40).optional(),
    proprietorName: z.string().min(1).max(200).optional(),
    proprietorPostalAddress: z.string().min(1).max(300).optional(),
    pin: z.string().min(1).max(40).optional(),
    lotPlan: z.string().min(1).max(120).optional(),
    landuseCode: z.string().min(1).max(40).optional(),
    areaSqm: z.number().nonnegative().finite().optional(),
    encumbranceType: z
      .enum([
        "mortgage",
        "easement",
        "caveat",
        "tenement_notation",
        "covenant",
        "other",
      ])
      .optional(),
    encumbranceReference: z.string().min(1).max(120).optional(),
    encumbranceDate: z.string().min(1).max(40).optional(),
    strataParentVolume: z.string().min(1).max(40).optional(),
    strataParentFolio: z.string().min(1).max(40).optional(),
  })
  .strict();

function parseLandgateTitleCsv(
  text: string,
):
  | {
      readonly ok: true;
      readonly rows: readonly ParsedTitleRow[];
      readonly errors: readonly RowError[];
    }
  | { readonly ok: false; readonly reason: string } {
  if (text.length === 0) return { ok: false, reason: "empty CSV" };
  const grid = parseCsvGrid(text);
  if (grid.length < 2) {
    return {
      ok: false,
      reason: "CSV must include a header row and at least one data row",
    };
  }
  const headerRow = grid[0]!.map(normHeader);
  const indexByKey: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    indexByKey[h] = i;
  });
  // assessment_number OR ven required
  if (
    indexByKey["assessment_number"] === undefined &&
    indexByKey["ven"] === undefined
  ) {
    return {
      ok: false,
      reason: 'one of "assessment_number" or "ven" header is required',
    };
  }
  const rows: ParsedTitleRow[] = [];
  const errors: RowError[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]!;
    if (cells.every((c) => c.trim() === "")) continue;
    const rawAssessment = cellOpt(cells, indexByKey["assessment_number"]);
    const rawVen = cellOpt(cells, indexByKey["ven"]);
    if (rawVen === undefined && rawAssessment === undefined) {
      errors.push({ row: r, message: "row missing both ven and assessment_number" });
      continue;
    }
    const venValue = rawVen ?? `AN:${rawAssessment}`;
    const candidate: Record<string, unknown> = {
      ven: venValue,
    };
    if (rawAssessment !== undefined) candidate["assessmentNumber"] = rawAssessment;
    const ctVol = cellOpt(cells, indexByKey["ct_volume"]);
    if (ctVol !== undefined) candidate["ctVolume"] = ctVol;
    const ctFol = cellOpt(cells, indexByKey["ct_folio"]);
    if (ctFol !== undefined) candidate["ctFolio"] = ctFol;
    const ctIssued = cellOpt(cells, indexByKey["ct_issued_date"]);
    if (ctIssued !== undefined) candidate["ctIssuedDate"] = ctIssued;
    const propName = cellOpt(cells, indexByKey["proprietor_name"]);
    if (propName !== undefined) candidate["proprietorName"] = propName;
    const propPostal = cellOpt(cells, indexByKey["proprietor_postal_address"]);
    if (propPostal !== undefined) candidate["proprietorPostalAddress"] = propPostal;
    const pin = cellOpt(cells, indexByKey["pin"]);
    if (pin !== undefined) candidate["pin"] = pin;
    const lotPlan = cellOpt(cells, indexByKey["lot_plan"]);
    if (lotPlan !== undefined) candidate["lotPlan"] = lotPlan;
    const landuse = cellOpt(cells, indexByKey["landuse_code"]);
    if (landuse !== undefined) candidate["landuseCode"] = landuse;
    const areaRaw = cellOpt(cells, indexByKey["area_sqm"]);
    if (areaRaw !== undefined) {
      const a = num(areaRaw);
      if (Number.isFinite(a)) candidate["areaSqm"] = a;
    }
    const encType = cellOpt(cells, indexByKey["encumbrance_type"]);
    if (encType !== undefined) candidate["encumbranceType"] = encType;
    const encRef = cellOpt(cells, indexByKey["encumbrance_reference"]);
    if (encRef !== undefined) candidate["encumbranceReference"] = encRef;
    const encDate = cellOpt(cells, indexByKey["encumbrance_date"]);
    if (encDate !== undefined) candidate["encumbranceDate"] = encDate;
    const strataVol = cellOpt(cells, indexByKey["strata_parent_volume"]);
    if (strataVol !== undefined) candidate["strataParentVolume"] = strataVol;
    const strataFol = cellOpt(cells, indexByKey["strata_parent_folio"]);
    if (strataFol !== undefined) candidate["strataParentFolio"] = strataFol;

    const parsed = TitleRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(row)"}: ${i.message}`)
        .join("; ");
      errors.push({
        row: r,
        ...(rawVen !== undefined ? { identifier: rawVen } : {}),
        message,
      });
      continue;
    }
    rows.push(parsed.data);
  }
  return { ok: true, rows, errors };
}

/**
 * Aggregate per-VEN rows into LandgateRecord objects.
 * Each row may contribute (1) header CT fields, (2) a single PIN, (3) a
 * single encumbrance, (4) a strata-parent indicator. Order-independent.
 */
function aggregateTitleRowsByVen(
  rows: readonly ParsedTitleRow[],
  councilCode: string,
  source: TitleSourceFreshness,
): {
  readonly records: readonly LandgateRecord[];
  readonly pinCount: number;
  readonly encumbranceCount: number;
  readonly strataParentCount: number;
} {
  type Accum = {
    ven: string;
    assessmentNumber?: string;
    ctVolume?: string;
    ctFolio?: string;
    ctIssuedDate?: string;
    proprietorName?: string;
    proprietorPostalAddress?: string;
    pinsByPin: Map<string, Pin>;
    encumbrances: Encumbrance[];
    strataParentCt?: { volume: string; folio: string };
  };
  const byVen: Map<string, Accum> = new Map();
  let pinCount = 0;
  let encumbranceCount = 0;
  let strataParentCount = 0;
  for (const row of rows) {
    let acc = byVen.get(row.ven);
    if (acc === undefined) {
      acc = {
        ven: row.ven,
        pinsByPin: new Map(),
        encumbrances: [],
      };
      byVen.set(row.ven, acc);
    }
    if (row.assessmentNumber !== undefined) acc.assessmentNumber = row.assessmentNumber;
    if (row.ctVolume !== undefined) acc.ctVolume = row.ctVolume;
    if (row.ctFolio !== undefined) acc.ctFolio = row.ctFolio;
    if (row.ctIssuedDate !== undefined) acc.ctIssuedDate = row.ctIssuedDate;
    if (row.proprietorName !== undefined) acc.proprietorName = row.proprietorName;
    if (row.proprietorPostalAddress !== undefined) {
      acc.proprietorPostalAddress = row.proprietorPostalAddress;
    }
    if (
      row.pin !== undefined &&
      row.lotPlan !== undefined &&
      row.landuseCode !== undefined &&
      row.areaSqm !== undefined &&
      !acc.pinsByPin.has(row.pin)
    ) {
      acc.pinsByPin.set(row.pin, {
        pin: row.pin,
        lotPlan: row.lotPlan,
        landuseCode: row.landuseCode,
        areaSquareMetres: row.areaSqm,
      });
    }
    if (
      row.encumbranceType !== undefined &&
      row.encumbranceReference !== undefined &&
      row.encumbranceDate !== undefined &&
      !acc.encumbrances.some((e) => e.reference === row.encumbranceReference)
    ) {
      acc.encumbrances.push({
        type: row.encumbranceType,
        reference: row.encumbranceReference,
        date: row.encumbranceDate,
        source: source.source,
      });
    }
    if (
      row.strataParentVolume !== undefined &&
      row.strataParentFolio !== undefined &&
      acc.strataParentCt === undefined
    ) {
      acc.strataParentCt = {
        volume: row.strataParentVolume,
        folio: row.strataParentFolio,
      };
    }
  }
  const records: LandgateRecord[] = [];
  for (const acc of byVen.values()) {
    const pins = [...acc.pinsByPin.values()];
    pinCount += pins.length;
    encumbranceCount += acc.encumbrances.length;
    if (acc.strataParentCt !== undefined) strataParentCount += 1;
    const rec: LandgateRecord = {
      councilCode,
      ven: acc.ven,
      ...(acc.assessmentNumber !== undefined
        ? { assessmentNumber: acc.assessmentNumber }
        : {}),
      ...(acc.ctVolume !== undefined ? { ctVolume: acc.ctVolume } : {}),
      ...(acc.ctFolio !== undefined ? { ctFolio: acc.ctFolio } : {}),
      ...(acc.ctIssuedDate !== undefined ? { ctIssuedDate: acc.ctIssuedDate } : {}),
      ...(acc.proprietorName !== undefined ? { proprietorName: acc.proprietorName } : {}),
      ...(acc.proprietorPostalAddress !== undefined
        ? { proprietorPostalAddress: acc.proprietorPostalAddress }
        : {}),
      pins,
      encumbrances: acc.encumbrances,
      ...(acc.strataParentCt !== undefined
        ? { strataParentCt: acc.strataParentCt }
        : {}),
      source,
    };
    records.push(rec);
  }
  return { records, pinCount, encumbranceCount, strataParentCount };
}

export async function importLandgateTitleDataHandler(
  input: schemas.ToolInputs["import_landgate_title_data"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const council = ctx.store.getCouncil(input.councilCode);
  if (council === undefined) {
    return notFound(
      `Council "${input.councilCode}" does not exist. Add the council first via add_council.`,
      ctx.correlationId,
    );
  }
  const retrievedAt = input.retrievedAt ?? ctx.now().toISOString();
  const source: TitleSourceFreshness = {
    source: input.sourceTier,
    retrievedAt,
  };

  // ===== CONFIRM PATH =====
  if (input.confirm) {
    if (input.commitToken === undefined) {
      return invalidInput(
        "confirm=true requires a commitToken from the preview call.",
        ctx.correlationId,
      );
    }
    const consumed = ctx.commitTokens.consume(
      input.commitToken,
      "import_landgate_title_data",
      { tenantId: ctx.tenantId, actorId: ctx.actorId },
    );
    if (!consumed.ok) {
      const reason =
        consumed.reason === "expired"
          ? "commitToken has expired (5 minute TTL); re-run the preview"
          : consumed.reason === "operation_mismatch"
            ? "commitToken was issued for a different operation"
            : "commitToken is unknown or already consumed";
      return conflict(reason, ctx.correlationId);
    }
    const mut = consumed.mutation;
    if (mut.operation !== "import_landgate_title_data") {
      return conflict("commitToken operation mismatch.", ctx.correlationId);
    }
    if (mut.councilCode !== input.councilCode) {
      return conflict(
        "commitToken was issued for a different council code.",
        ctx.correlationId,
      );
    }
    const beforeCount = ctx.store.countLandgateRecordsForCouncil(
      input.councilCode,
    );
    const records = mut.records as unknown as readonly LandgateRecord[];
    let inserted = 0;
    for (const rec of records) {
      ctx.store.upsertLandgateRecord(rec);
      inserted += 1;
    }
    const afterCount = ctx.store.countLandgateRecordsForCouncil(
      input.councilCode,
    );

    recordMutation({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorKind: ctx.actorKind,
      action: "write.import_landgate_title_data",
      target: {
        type: "council_landgate_snapshot",
        id: `${input.councilCode}-${mut.retrievedAt}`,
      },
      before: { recordCount: beforeCount },
      after: {
        recordCount: afterCount,
        inserted,
        pinCount: mut.pinCount,
        encumbranceCount: mut.encumbranceCount,
        strataParentCount: mut.strataParentCount,
        sourceTier: mut.sourceTier,
        retrievedAt: mut.retrievedAt,
      },
      correlationId: ctx.correlationId,
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
    });

    return {
      ok: true,
      output: `Imported ${inserted} Landgate records for ${input.councilCode} (${mut.pinCount} PINs, ${mut.encumbranceCount} encumbrances, ${mut.strataParentCount} strata-parent indicators).`,
      data: {
        councilCode: input.councilCode,
        sourceTier: mut.sourceTier,
        retrievedAt: mut.retrievedAt,
        inserted,
        beforeCount,
        afterCount,
        pinCount: mut.pinCount,
        encumbranceCount: mut.encumbranceCount,
        strataParentCount: mut.strataParentCount,
      },
      mutated: true,
    };
  }

  // ===== PREVIEW PATH =====
  const parsed = parseLandgateTitleCsv(input.csvText);
  if (!parsed.ok) {
    return invalidInput(
      `CSV parse failed: ${parsed.reason}`,
      ctx.correlationId,
    );
  }
  const errorCount = parsed.errors.length;
  if (parsed.rows.length === 0) {
    return invalidInput(
      `CSV produced 0 valid rows (${errorCount} errors). Aborting.`,
      ctx.correlationId,
    );
  }
  const agg = aggregateTitleRowsByVen(parsed.rows, input.councilCode, source);
  if (agg.records.length === 0) {
    return invalidInput(
      `CSV produced 0 valid VEN records (${errorCount} parse errors). Aborting.`,
      ctx.correlationId,
    );
  }

  const token = ctx.commitTokens.issue({
    operation: "import_landgate_title_data",
    councilCode: input.councilCode,
    sourceTier: input.sourceTier,
    retrievedAt,
    recordCount: agg.records.length,
    pinCount: agg.pinCount,
    encumbranceCount: agg.encumbranceCount,
    strataParentCount: agg.strataParentCount,
    records: agg.records as ReadonlyArray<Record<string, unknown>>,
  }, { tenantId: ctx.tenantId, actorId: ctx.actorId });

  const sampleRecords = agg.records.slice(0, 5).map((r) => ({
    ven: r.ven,
    pinCount: r.pins.length,
    encumbranceCount: r.encumbrances.length,
    hasStrataParent: r.strataParentCt !== undefined,
    proprietorName: r.proprietorName,
  }));
  const errorPreview = parsed.errors.slice(0, 10);

  const output = [
    `Preview: ${agg.records.length} VEN records (${agg.pinCount} PINs, ${agg.encumbranceCount} encumbrances, ${agg.strataParentCount} strata parents). ${errorCount} parse errors.`,
    ``,
    `[NOT COMMITTED — re-run with confirm=true and commitToken=${token} within 5 minutes to apply.]`,
  ].join("\n");

  return {
    ok: true,
    output,
    data: {
      councilCode: input.councilCode,
      sourceTier: input.sourceTier,
      retrievedAt,
      validRecordCount: agg.records.length,
      pinCount: agg.pinCount,
      encumbranceCount: agg.encumbranceCount,
      strataParentCount: agg.strataParentCount,
      errorCount,
      sampleRecords,
      errorPreview,
      commitToken: token,
    },
    commitToken: token,
    mutated: false,
  };
}

// ===== 3. import_wc_eligibility =====

const WcEligibilityRowSchema = z
  .object({
    customerId: z.string().min(1).max(80),
    cardNumber: z.string().min(1).max(80).optional(),
    holderName: z.string().min(1).max(200),
    eligibilityStatus: z.enum([
      "active",
      "cancelled",
      "expired",
      "deceased",
      "unknown",
    ]),
    validFrom: z.string().min(1).max(40),
    validTo: z.string().min(1).max(40).optional(),
    cancellationReason: z.string().min(1).max(200).optional(),
    cancellationDate: z.string().min(1).max(40).optional(),
    propertyAddressOnFile: z.string().min(1).max(300).optional(),
  })
  .strict();

type ParsedWcRow = z.infer<typeof WcEligibilityRowSchema>;

const WC_REQUIRED = [
  "customer_id",
  "holder_name",
  "eligibility_status",
  "valid_from",
] as const;

function parseWcEligibilityCsv(
  text: string,
):
  | { readonly ok: true; readonly rows: readonly ParsedWcRow[]; readonly errors: readonly RowError[] }
  | { readonly ok: false; readonly reason: string } {
  if (text.length === 0) return { ok: false, reason: "empty CSV" };
  const grid = parseCsvGrid(text);
  if (grid.length < 2) {
    return {
      ok: false,
      reason: "CSV must include a header row and at least one data row",
    };
  }
  const headerRow = grid[0]!.map(normHeader);
  const indexByKey: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    indexByKey[h] = i;
  });
  for (const req of WC_REQUIRED) {
    if (indexByKey[req] === undefined) {
      return { ok: false, reason: `missing required header "${req}"` };
    }
  }
  const rows: ParsedWcRow[] = [];
  const errors: RowError[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]!;
    if (cells.every((c) => c.trim() === "")) continue;
    const rawCust = cell(cells, indexByKey["customer_id"]);
    const statusRaw = cell(cells, indexByKey["eligibility_status"]).toLowerCase();
    const candidate: Record<string, unknown> = {
      customerId: rawCust,
      holderName: cell(cells, indexByKey["holder_name"]),
      eligibilityStatus: statusRaw,
      validFrom: cell(cells, indexByKey["valid_from"]),
    };
    const card = cellOpt(cells, indexByKey["card_number"]);
    if (card !== undefined) candidate["cardNumber"] = card;
    const validTo = cellOpt(cells, indexByKey["valid_to"]);
    if (validTo !== undefined) candidate["validTo"] = validTo;
    const cancelReason = cellOpt(cells, indexByKey["cancellation_reason"]);
    if (cancelReason !== undefined) candidate["cancellationReason"] = cancelReason;
    const cancelDate = cellOpt(cells, indexByKey["cancellation_date"]);
    if (cancelDate !== undefined) candidate["cancellationDate"] = cancelDate;
    const propAddr = cellOpt(cells, indexByKey["property_address_on_file"]);
    if (propAddr !== undefined) candidate["propertyAddressOnFile"] = propAddr;

    const parsed = WcEligibilityRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(row)"}: ${i.message}`)
        .join("; ");
      errors.push({
        row: r,
        ...(rawCust !== "" ? { identifier: rawCust } : {}),
        message,
      });
      continue;
    }
    rows.push(parsed.data);
  }
  return { ok: true, rows, errors };
}

export async function importWcEligibilityHandler(
  input: schemas.ToolInputs["import_wc_eligibility"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const council = ctx.store.getCouncil(input.councilCode);
  if (council === undefined) {
    return notFound(
      `Council "${input.councilCode}" does not exist. Add the council first via add_council.`,
      ctx.correlationId,
    );
  }
  const retrievedAt = input.retrievedAt ?? ctx.now().toISOString();

  // ===== CONFIRM PATH =====
  if (input.confirm) {
    if (input.commitToken === undefined) {
      return invalidInput(
        "confirm=true requires a commitToken from the preview call.",
        ctx.correlationId,
      );
    }
    const consumed = ctx.commitTokens.consume(
      input.commitToken,
      "import_wc_eligibility",
      { tenantId: ctx.tenantId, actorId: ctx.actorId },
    );
    if (!consumed.ok) {
      const reason =
        consumed.reason === "expired"
          ? "commitToken has expired (5 minute TTL); re-run the preview"
          : consumed.reason === "operation_mismatch"
            ? "commitToken was issued for a different operation"
            : "commitToken is unknown or already consumed";
      return conflict(reason, ctx.correlationId);
    }
    const mut = consumed.mutation;
    if (mut.operation !== "import_wc_eligibility") {
      return conflict("commitToken operation mismatch.", ctx.correlationId);
    }
    if (mut.councilCode !== input.councilCode) {
      return conflict(
        "commitToken was issued for a different council code.",
        ctx.correlationId,
      );
    }

    const beforeCount = ctx.store.countWaterCorpEligibilityForCouncil(
      input.councilCode,
    );
    const parsedRows = mut.rows as unknown as readonly ParsedWcRow[];
    const records: WaterCorpEligibilityRecord[] = parsedRows.map((r) => ({
      councilCode: input.councilCode,
      customerId: r.customerId,
      ...(r.cardNumber !== undefined ? { cardNumber: r.cardNumber } : {}),
      holderName: r.holderName,
      eligibilityStatus: r.eligibilityStatus,
      validFrom: r.validFrom,
      ...(r.validTo !== undefined ? { validTo: r.validTo } : {}),
      ...(r.cancellationReason !== undefined
        ? { cancellationReason: r.cancellationReason }
        : {}),
      ...(r.cancellationDate !== undefined
        ? { cancellationDate: r.cancellationDate }
        : {}),
      ...(r.propertyAddressOnFile !== undefined
        ? { propertyAddressOnFile: r.propertyAddressOnFile }
        : {}),
      retrievedAt: mut.retrievedAt,
    }));
    const counts = ctx.store.upsertWaterCorpEligibility(records);
    const afterCount = ctx.store.countWaterCorpEligibilityForCouncil(
      input.councilCode,
    );

    recordMutation({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorKind: ctx.actorKind,
      action: "write.import_wc_eligibility",
      target: {
        type: "council_wc_eligibility",
        id: `${input.councilCode}-${mut.retrievedAt}`,
      },
      before: { rowCount: beforeCount },
      after: {
        rowCount: afterCount,
        inserted: counts.inserted,
        updated: counts.updated,
        retrievedAt: mut.retrievedAt,
      },
      correlationId: ctx.correlationId,
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
    });

    return {
      ok: true,
      output: `Imported ${counts.inserted + counts.updated} WC eligibility rows for ${input.councilCode} (${counts.inserted} new, ${counts.updated} updated).`,
      data: {
        councilCode: input.councilCode,
        retrievedAt: mut.retrievedAt,
        inserted: counts.inserted,
        updated: counts.updated,
        beforeCount,
        afterCount,
      },
      mutated: true,
    };
  }

  // ===== PREVIEW PATH =====
  const parsed = parseWcEligibilityCsv(input.csvText);
  if (!parsed.ok) {
    return invalidInput(
      `CSV parse failed: ${parsed.reason}`,
      ctx.correlationId,
    );
  }
  const errorCount = parsed.errors.length;
  if (parsed.rows.length === 0) {
    return invalidInput(
      `CSV produced 0 valid rows (${errorCount} errors). Aborting.`,
      ctx.correlationId,
    );
  }

  const token = ctx.commitTokens.issue({
    operation: "import_wc_eligibility",
    councilCode: input.councilCode,
    retrievedAt,
    rowCount: parsed.rows.length,
    rows: parsed.rows as ReadonlyArray<Record<string, unknown>>,
  }, { tenantId: ctx.tenantId, actorId: ctx.actorId });

  const sampleRows = parsed.rows.slice(0, 5).map((r) => ({
    customerId: r.customerId,
    cardNumber: r.cardNumber,
    holderName: r.holderName,
    eligibilityStatus: r.eligibilityStatus,
  }));
  const errorPreview = parsed.errors.slice(0, 10);

  const output = [
    `Preview: ${parsed.rows.length} valid rows, ${errorCount} errors. Will upsert WC eligibility for ${input.councilCode}.`,
    ``,
    `[NOT COMMITTED — re-run with confirm=true and commitToken=${token} within 5 minutes to apply.]`,
  ].join("\n");

  return {
    ok: true,
    output,
    data: {
      councilCode: input.councilCode,
      retrievedAt,
      validCount: parsed.rows.length,
      errorCount,
      sampleRows,
      errorPreview,
      commitToken: token,
    },
    commitToken: token,
    mutated: false,
  };
}

// ===== 4. request_strata_conversion =====

/**
 * State-machine transition table. Per spec Section 7:
 *
 *   parent_strata_detected
 *     → strata_plan_uploaded
 *       → children_previewed
 *         → children_imported
 *           → parent_superseded
 *        ↘ withdrawn (legal from ANY non-terminal state)
 *
 * Cannot skip states; cannot transition out of `parent_superseded` or
 * `withdrawn` (terminal).
 */
const STRATA_TRANSITIONS: Readonly<
  Record<StrataLifecycleState, ReadonlyArray<StrataLifecycleState>>
> = {
  parent_strata_detected: ["strata_plan_uploaded", "withdrawn"],
  strata_plan_uploaded: ["children_previewed", "withdrawn"],
  children_previewed: ["children_imported", "withdrawn"],
  children_imported: ["parent_superseded", "withdrawn"],
  parent_superseded: [],
  withdrawn: [],
};

/**
 * Deterministic assessment number for a child property derived from the
 * parent + the child's CT (volume, folio). Same inputs → same id, so
 * re-running an import doesn't duplicate child properties.
 */
function childAssessmentNumber(
  parentAssessment: string,
  volume: string,
  folio: string,
): string {
  const h = createHash("sha1")
    .update(`${parentAssessment}::${volume}::${folio}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `${parentAssessment}-S${h}`;
}

export async function requestStrataConversionHandler(
  input: schemas.ToolInputs["request_strata_conversion"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const parent = ctx.store.getProperty(input.parentAssessmentNumber);
  if (parent === undefined) {
    return notFound(
      `Parent assessment "${input.parentAssessmentNumber}" not found.`,
      ctx.correlationId,
    );
  }
  const existing = ctx.store.strataLifecycleByAssessment(
    input.parentAssessmentNumber,
  );
  const currentState: StrataLifecycleState =
    existing?.state ?? "parent_strata_detected";

  // State-machine validation — done up front so previews refuse illegal
  // transitions just as commits do.
  const allowed = STRATA_TRANSITIONS[currentState];
  if (!allowed.includes(input.toState)) {
    return invalidInput(
      `Illegal strata transition: cannot go from "${currentState}" to "${input.toState}". Allowed targets: ${allowed.length === 0 ? "(none — terminal state)" : allowed.join(", ")}.`,
      ctx.correlationId,
    );
  }

  // Per-target structural requirements.
  if (input.toState === "children_imported") {
    if (input.childCts === undefined || input.childCts.length === 0) {
      return invalidInput(
        "childCts is required (≥1) when transitioning to children_imported.",
        ctx.correlationId,
      );
    }
  }
  if (input.toState === "withdrawn" && input.reason === undefined) {
    return invalidInput(
      "reason is required when withdrawing a strata conversion.",
      ctx.correlationId,
    );
  }

  // ===== CONFIRM PATH =====
  if (input.confirm) {
    if (input.commitToken === undefined) {
      return invalidInput(
        "confirm=true requires a commitToken from the preview call.",
        ctx.correlationId,
      );
    }
    const consumed = ctx.commitTokens.consume(
      input.commitToken,
      "request_strata_conversion",
      { tenantId: ctx.tenantId, actorId: ctx.actorId },
    );
    if (!consumed.ok) {
      const reason =
        consumed.reason === "expired"
          ? "commitToken has expired (5 minute TTL); re-run the preview"
          : consumed.reason === "operation_mismatch"
            ? "commitToken was issued for a different operation"
            : "commitToken is unknown or already consumed";
      return conflict(reason, ctx.correlationId);
    }
    const mut = consumed.mutation;
    if (mut.operation !== "request_strata_conversion") {
      return conflict("commitToken operation mismatch.", ctx.correlationId);
    }
    if (mut.parentAssessmentNumber !== input.parentAssessmentNumber) {
      return conflict(
        "commitToken was issued for a different parent assessment.",
        ctx.correlationId,
      );
    }
    if (mut.toState !== input.toState) {
      return conflict(
        "commitToken was issued for a different toState.",
        ctx.correlationId,
      );
    }

    // Re-validate transition at commit-time — state may have moved between
    // preview and confirm.
    const liveExisting = ctx.store.strataLifecycleByAssessment(
      input.parentAssessmentNumber,
    );
    const liveState: StrataLifecycleState =
      liveExisting?.state ?? "parent_strata_detected";
    if (!STRATA_TRANSITIONS[liveState].includes(input.toState)) {
      return conflict(
        `State changed between preview and commit. Current state is now "${liveState}".`,
        ctx.correlationId,
      );
    }

    type LifecycleChildCt = StrataLifecycle["childCts"][number];
    const childCtsForRecord: LifecycleChildCt[] = (mut.childCts ?? []).map(
      (cc): LifecycleChildCt => ({
        volume: cc.volume,
        folio: cc.folio,
        ...(cc.ven !== undefined ? { ven: cc.ven } : {}),
        ...(cc.address !== undefined ? { address: cc.address } : {}),
      }),
    );

    // For children_imported, materialise child Property records.
    let createdChildren = 0;
    let childCtsWithAssessment: readonly LifecycleChildCt[] = childCtsForRecord;
    if (input.toState === "children_imported") {
      const enriched: LifecycleChildCt[] = [];
      for (const cc of childCtsForRecord) {
        const an = childAssessmentNumber(
          input.parentAssessmentNumber,
          cc.volume,
          cc.folio,
        );
        // Idempotent: if a property with this assessment already exists, skip.
        if (ctx.store.getProperty(an) === undefined) {
          const childProperty: Property = {
            assessmentNumber: an,
            council: parent.council,
            address: cc.address ?? `${parent.address} (strata child)`,
            suburb: parent.suburb,
            postcode: parent.postcode,
            state: parent.state,
            landUse: parent.landUse,
            valuation: 0,
            annualRates: 0,
            balance: 0,
            lastPaymentDate: null,
            lastPaymentAmount: null,
            paymentMethod: null,
            pensionerRebate: false,
            paymentArrangement: false,
            ownerIds: [...parent.ownerIds],
            notes: [
              `Materialised as strata child of ${input.parentAssessmentNumber} (CT V${cc.volume}/F${cc.folio}) on ${ctx.now().toISOString()}.`,
            ],
            lat: parent.lat,
            lng: parent.lng,
            ctVolume: cc.volume,
            ctFolio: cc.folio,
            ...(cc.ven !== undefined ? { ven: cc.ven } : {}),
          };
          if (ctx.store.addProperty(childProperty) !== undefined) {
            createdChildren += 1;
          }
        }
        enriched.push({ ...cc, childAssessmentNumber: an });
      }
      childCtsWithAssessment = enriched;
    }

    // Persist the lifecycle transition.
    const history = [
      ...(liveExisting?.history ?? []),
      {
        state: input.toState,
        at: ctx.now().toISOString(),
        ...(mut.reason !== undefined ? { reason: mut.reason } : {}),
      },
    ];
    // childCts memory: preserve what was uploaded in any previous transition,
    // and overwrite with the latest payload when the caller supplies it.
    const persistedChildCts =
      mut.childCts.length > 0
        ? childCtsWithAssessment
        : (liveExisting?.childCts ?? []);
    const next: StrataLifecycle = {
      parentAssessmentNumber: input.parentAssessmentNumber,
      state: input.toState,
      history,
      childCts: persistedChildCts,
    };
    ctx.store.setStrataLifecycle(next);

    recordMutation({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorKind: ctx.actorKind,
      action: `state.strata_conversion.${input.toState}`,
      target: { type: "property", id: input.parentAssessmentNumber },
      before: {
        state: liveState,
        childCount: liveExisting?.childCts.length ?? 0,
      },
      after: {
        state: input.toState,
        childCount: next.childCts.length,
        createdChildren,
        ...(mut.reason !== undefined ? { reason: mut.reason } : {}),
      },
      correlationId: ctx.correlationId,
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
    });

    return {
      ok: true,
      output:
        input.toState === "children_imported"
          ? `Strata conversion ${input.parentAssessmentNumber}: state → children_imported. Materialised ${createdChildren} child property record(s).`
          : `Strata conversion ${input.parentAssessmentNumber}: state ${liveState} → ${input.toState}.`,
      data: {
        parentAssessmentNumber: input.parentAssessmentNumber,
        previousState: liveState,
        state: input.toState,
        childCts: persistedChildCts,
        createdChildren,
      },
      mutated: true,
    };
  }

  // ===== PREVIEW PATH =====
  const token = ctx.commitTokens.issue(
    {
      operation: "request_strata_conversion",
      parentAssessmentNumber: input.parentAssessmentNumber,
      toState: input.toState,
      childCts: (input.childCts ?? []).map((cc) => ({
        volume: cc.volume,
        folio: cc.folio,
        ...(cc.ven !== undefined ? { ven: cc.ven } : {}),
        ...(cc.address !== undefined ? { address: cc.address } : {}),
      })),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    },
    { tenantId: ctx.tenantId, actorId: ctx.actorId },
  );

  const childPreview = (input.childCts ?? []).map((cc) => ({
    volume: cc.volume,
    folio: cc.folio,
    proposedAssessmentNumber: childAssessmentNumber(
      input.parentAssessmentNumber,
      cc.volume,
      cc.folio,
    ),
    ven: cc.ven,
    address: cc.address,
  }));

  const output = [
    `Preview strata transition for ${input.parentAssessmentNumber}: ${currentState} → ${input.toState}.`,
    input.toState === "children_imported"
      ? `Will materialise ${childPreview.length} child property record(s).`
      : input.toState === "withdrawn"
        ? `Will mark withdrawn; reason: ${input.reason}.`
        : `Will advance the lifecycle.`,
    ``,
    `[NOT COMMITTED — re-run with confirm=true and commitToken=${token} within 5 minutes to apply.]`,
  ].join("\n");

  return {
    ok: true,
    output,
    data: {
      parentAssessmentNumber: input.parentAssessmentNumber,
      previousState: currentState,
      toState: input.toState,
      childPreview,
      commitToken: token,
    },
    commitToken: token,
    mutated: false,
  };
}
