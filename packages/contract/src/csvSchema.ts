/**
 * @ratesassist/contract — TechOne-style rating-roll CSV ingestion.
 *
 * A council uploads its rating-roll export (CSV) and the platform materialises
 * each row into a {@link Property} record (plus a synthesised {@link Owner}
 * record per unique owner). This module defines:
 *
 *  - {@link RatingRollRowSchema} — Zod row schema with strict per-cell types
 *    (assessment number, postcode, state, landuse, valuation, etc.).
 *  - {@link parseRatingRollCsv} — header-aware parser that tolerates extra
 *    columns, collects per-row errors instead of aborting on the first bad
 *    row, and rejects entirely if a required header is missing.
 *
 * The parser is hand-rolled (no external CSV dependency) and handles quoted
 * fields, escaped quotes, embedded newlines inside quoted fields, and BOM
 * stripping. 60-line scope — sufficient for TechOne exports, which are
 * RFC-4180-compatible.
 */

import { z } from "zod";

// ===== Row schema =====

/** WA-only for the current product scope; widen alongside state expansion. */
const stateEnum = z.enum(["WA", "NSW", "VIC", "QLD", "SA", "TAS", "ACT", "NT"]);

/**
 * Land-use enum carried in the CSV. The contract's domain `LandUse` is a
 * subset; "Mixed" and "Other" both map to "Residential" downstream (the
 * council can re-categorise post-import). Surfaced verbatim in the row
 * record so the importer's audit row preserves the raw classification.
 */
export const ratingRollLandUseEnum = z.enum([
  "Rural",
  "Vacant",
  "Residential",
  "Commercial",
  "Industrial",
  "Mixed",
  "Other",
]);

/** Map the CSV landuse to the canonical `Property.landUse` value. */
export function mapCsvLandUseToDomain(
  v: z.infer<typeof ratingRollLandUseEnum>,
):
  | "Rural"
  | "Vacant"
  | "Residential"
  | "Commercial"
  | "Industrial" {
  if (v === "Mixed" || v === "Other") return "Residential";
  return v;
}

export const RatingRollRowSchema = z
  .object({
    assessmentNumber: z
      .string()
      .min(3)
      .max(40)
      .regex(/^[A-Z0-9][A-Z0-9-]*$/i, "assessment numbers are alphanumeric with dashes"),
    address: z.string().min(2).max(200),
    suburb: z.string().min(1).max(80),
    postcode: z.string().regex(/^\d{4}$/, "postcode must be 4 digits"),
    state: stateEnum,
    landUse: ratingRollLandUseEnum,
    valuation: z.number().positive(),
    annualRates: z.number().positive(),
    balance: z.number().default(0),
    ownerName: z.string().min(1).max(200),
    ownerAbn: z
      .string()
      .regex(/^\d{11}$/, "ABN must be 11 digits with no spaces")
      .optional(),
    lotPlan: z.string().min(2).max(80).optional(),
    lat: z.number().min(-45).max(-9).optional(),
    lng: z.number().min(110).max(156).optional(),
  })
  .strict();

export type RatingRollRow = z.infer<typeof RatingRollRowSchema>;

/** Structured per-row error returned alongside the successfully parsed rows. */
export type RowError = {
  /** 1-based row index in the source CSV (excluding the header). */
  readonly row: number;
  readonly assessmentNumber?: string;
  readonly message: string;
};

/** Canonical header names. Matched case-insensitively after normalisation. */
const REQUIRED_HEADERS = [
  "assessment_number",
  "address",
  "suburb",
  "postcode",
  "state",
  "landuse",
  "valuation",
  "annual_rates",
  "owner_name",
] as const;

const OPTIONAL_HEADERS = [
  "balance",
  "owner_abn",
  "lot_plan",
  "lat",
  "lng",
] as const;

type HeaderKey =
  | (typeof REQUIRED_HEADERS)[number]
  | (typeof OPTIONAL_HEADERS)[number];

/** Normalise a header cell — lower-case, strip non-alphanumeric, snake_case. */
function normHeader(s: string): string {
  return s
    .replace(/^﻿/, "") // strip BOM
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Inline RFC-4180-ish CSV parser. Returns rows of cell strings. */
function parseCsv(text: string): string[][] {
  // Strip BOM if present
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
      // Normalise CRLF / lone CR
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
  // Tail
  if (cell.length > 0 || cur.length > 0) {
    cur.push(cell);
    rows.push(cur);
  }
  // Strip trailing empty rows
  while (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.length === 1 && last[0]!.trim() === "") rows.pop();
    else break;
  }
  return rows;
}

/** Coerce a CSV cell to a number; returns NaN when blank or non-numeric. */
function num(cell: string | undefined): number {
  if (cell === undefined) return NaN;
  const trimmed = cell.trim();
  if (trimmed === "") return NaN;
  // Strip currency symbol, commas, whitespace
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export type ParseRatingRollResult =
  | {
      readonly ok: true;
      readonly rows: readonly RatingRollRow[];
      readonly errors: readonly RowError[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Parse a TechOne-style rating-roll CSV into validated rows + per-row error
 * report. Aborts only if required headers are absent.
 */
export function parseRatingRollCsv(text: string): ParseRatingRollResult {
  if (text.length === 0) return { ok: false, reason: "empty CSV" };
  const grid = parseCsv(text);
  if (grid.length < 2) {
    return { ok: false, reason: "CSV must include a header row and at least one data row" };
  }
  const headerRow = grid[0]!.map(normHeader);
  const indexByKey: Partial<Record<HeaderKey, number>> = {};
  headerRow.forEach((h, i) => {
    if (
      (REQUIRED_HEADERS as readonly string[]).includes(h) ||
      (OPTIONAL_HEADERS as readonly string[]).includes(h)
    ) {
      indexByKey[h as HeaderKey] = i;
    }
  });
  for (const req of REQUIRED_HEADERS) {
    if (indexByKey[req] === undefined) {
      return { ok: false, reason: `missing required header "${req}"` };
    }
  }
  const get = (cells: readonly string[], key: HeaderKey): string | undefined => {
    const idx = indexByKey[key];
    if (idx === undefined) return undefined;
    return cells[idx];
  };
  const rows: RatingRollRow[] = [];
  const errors: RowError[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]!;
    // Skip wholly-empty rows quietly.
    if (cells.every((c) => c.trim() === "")) continue;
    const rawAssessment = (get(cells, "assessment_number") ?? "").trim();
    const candidate: Record<string, unknown> = {
      assessmentNumber: rawAssessment,
      address: (get(cells, "address") ?? "").trim(),
      suburb: (get(cells, "suburb") ?? "").trim(),
      postcode: (get(cells, "postcode") ?? "").trim(),
      state: (get(cells, "state") ?? "").trim().toUpperCase(),
      landUse: (get(cells, "landuse") ?? "").trim(),
      valuation: num(get(cells, "valuation")),
      annualRates: num(get(cells, "annual_rates")),
      ownerName: (get(cells, "owner_name") ?? "").trim(),
    };
    const balanceRaw = get(cells, "balance");
    if (balanceRaw !== undefined && balanceRaw.trim() !== "") {
      candidate["balance"] = num(balanceRaw);
    }
    const abnRaw = get(cells, "owner_abn");
    if (abnRaw !== undefined && abnRaw.trim() !== "") {
      candidate["ownerAbn"] = abnRaw.replace(/\s+/g, "").trim();
    }
    const lotRaw = get(cells, "lot_plan");
    if (lotRaw !== undefined && lotRaw.trim() !== "") {
      candidate["lotPlan"] = lotRaw.trim();
    }
    const latRaw = get(cells, "lat");
    if (latRaw !== undefined && latRaw.trim() !== "") {
      candidate["lat"] = num(latRaw);
    }
    const lngRaw = get(cells, "lng");
    if (lngRaw !== undefined && lngRaw.trim() !== "") {
      candidate["lng"] = num(lngRaw);
    }
    const parsed = RatingRollRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(row)"}: ${i.message}`)
        .join("; ");
      errors.push({
        row: r,
        ...(rawAssessment !== "" ? { assessmentNumber: rawAssessment } : {}),
        message,
      });
      continue;
    }
    rows.push(parsed.data);
  }
  return { ok: true, rows, errors };
}
