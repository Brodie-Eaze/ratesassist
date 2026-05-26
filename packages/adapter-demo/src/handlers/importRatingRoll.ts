/**
 * `import_rating_roll` handler — TechOne CSV ingestion for a council.
 *
 * Two-phase commit (matches `add_council`, `update_owner_contact`, etc.):
 *
 *   1. Preview (`confirm=false`): parse the CSV, validate rows, return
 *      counts + sample + a commit token. No mutation.
 *   2. Confirm (`confirm=true` + matching token): apply the merge to the
 *      `DataStore` according to `mergeStrategy` and materialise owner records
 *      from the row data.
 *
 * Owner materialisation: each unique `ownerName` (or `ownerAbn` if present)
 * produces a deterministic `ownerId`. Re-imports therefore do not duplicate
 * owners. Existing owner records are not overwritten if already present (we
 * only fill in placeholders for newly-discovered owners).
 *
 * Audit: a single `write.import_rating_roll` mutation row is written on
 * commit, carrying before/after property counts.
 */

import {
  parseRatingRollCsv,
  mapCsvLandUseToDomain,
  type Owner,
  type Property,
  type RatingRollRow,
  type schemas,
} from "@ratesassist/contract";
import { createHash } from "node:crypto";

import { recordMutation } from "../audit/index.js";
import type { RequestContext } from "../runtime/context.js";
import { conflict, invalidInput, notFound } from "../runtime/errors.js";

/** Deterministic ownerId — ABN if present, else SHA-1 of council+name. */
function ownerIdFor(councilCode: string, ownerName: string, abn?: string): string {
  if (abn !== undefined && abn.length > 0) {
    return `O-ABN-${abn}`;
  }
  const h = createHash("sha1")
    .update(`${councilCode}::${ownerName.toLowerCase().trim()}`)
    .digest("hex")
    .slice(0, 12);
  return `O-GEN-${h.toUpperCase()}`;
}

/** Build a Property record from a parsed CSV row. */
function rowToProperty(
  row: RatingRollRow,
  councilCode: string,
  ownerId: string,
  centroidFallback: { lat: number; lng: number },
): Property {
  // Postcode-derived state stays as supplied (we lock WA via the schema).
  const property: Property = {
    assessmentNumber: row.assessmentNumber,
    council: councilCode,
    address: row.address,
    suburb: row.suburb,
    postcode: row.postcode,
    state: row.state,
    landUse: mapCsvLandUseToDomain(row.landUse),
    valuation: row.valuation,
    annualRates: row.annualRates,
    balance: row.balance,
    lastPaymentDate: null,
    lastPaymentAmount: null,
    paymentMethod: null,
    pensionerRebate: false,
    paymentArrangement: false,
    ownerIds: [ownerId],
    notes: [],
    lat: row.lat ?? centroidFallback.lat,
    lng: row.lng ?? centroidFallback.lng,
  };
  return property;
}

/** Build a placeholder Owner record from a parsed CSV row. */
function rowToOwner(row: RatingRollRow, ownerId: string): Owner {
  return {
    ownerId,
    name: row.ownerName,
    abn: row.ownerAbn ?? null,
    abnCheck: { kind: "unchecked" },
    postalAddress: `${row.address}, ${row.suburb} ${row.state} ${row.postcode}`,
    email: null,
    phone: null,
    ownerSince: new Date().toISOString().slice(0, 10),
    previousOwners: [],
  };
}

export async function importRatingRollHandler(
  input: schemas.ToolInputs["import_rating_roll"],
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
      "import_rating_roll",
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
    if (mut.operation !== "import_rating_roll") {
      return conflict("commitToken operation mismatch.", ctx.correlationId);
    }
    if (mut.councilCode !== input.councilCode) {
      return conflict(
        "commitToken was issued for a different council code.",
        ctx.correlationId,
      );
    }
    if (mut.mergeStrategy !== input.mergeStrategy) {
      return conflict(
        "commitToken was issued for a different mergeStrategy.",
        ctx.correlationId,
      );
    }

    const rows = mut.rows as readonly RatingRollRow[];
    const centroidFallback = {
      lat: council.centerLat,
      lng: council.centerLng,
    };

    // Materialise owners + properties.
    const newOwners: Owner[] = [];
    const newProperties: Property[] = [];
    const seenOwners = new Set<string>();
    for (const row of rows) {
      const oid = ownerIdFor(input.councilCode, row.ownerName, row.ownerAbn);
      if (!seenOwners.has(oid)) {
        seenOwners.add(oid);
        if (ctx.store.getOwner(oid) === undefined) {
          newOwners.push(rowToOwner(row, oid));
        }
      }
      newProperties.push(rowToProperty(row, input.councilCode, oid, centroidFallback));
    }

    const beforePropertyCount = ctx.store.countPropertiesForCouncil(
      input.councilCode,
    );
    let inserted = 0;
    let updated = 0;
    let removed = 0;
    if (input.mergeStrategy === "replace") {
      const r = ctx.store.replaceProperties(input.councilCode, newProperties);
      removed = r.removed;
      inserted = r.inserted;
    } else {
      const r = ctx.store.upsertProperties(input.councilCode, newProperties);
      inserted = r.inserted;
      updated = r.updated;
    }
    const ownerResult = ctx.store.upsertOwners(newOwners);
    const afterPropertyCount = ctx.store.countPropertiesForCouncil(
      input.councilCode,
    );

    recordMutation({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorKind: ctx.actorKind,
      action: "write.import_rating_roll",
      target: { type: "council", id: input.councilCode },
      before: { propertyCount: beforePropertyCount },
      after: {
        propertyCount: afterPropertyCount,
        inserted,
        updated,
        removed,
        ownersInserted: ownerResult.inserted,
        mergeStrategy: input.mergeStrategy,
      },
      correlationId: ctx.correlationId,
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
    });

    const output =
      input.mergeStrategy === "replace"
        ? `Imported ${inserted} properties (${removed} replaced). ${ownerResult.inserted} owners materialised. Recovery sweep ready.`
        : `Imported ${inserted + updated} properties (${inserted} new, ${updated} updated). ${ownerResult.inserted} owners materialised. Recovery sweep ready.`;

    return {
      ok: true,
      output,
      data: {
        councilCode: input.councilCode,
        mergeStrategy: input.mergeStrategy,
        inserted,
        updated,
        removed,
        ownersInserted: ownerResult.inserted,
        beforePropertyCount,
        afterPropertyCount,
      },
      mutated: true,
    };
  }

  // ===== PREVIEW PATH =====
  const parsed = parseRatingRollCsv(input.csvText);
  if (!parsed.ok) {
    return invalidInput(`CSV parse failed: ${parsed.reason}`, ctx.correlationId);
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
    operation: "import_rating_roll",
    councilCode: input.councilCode,
    mergeStrategy: input.mergeStrategy,
    rowCount: validCount,
    rows: parsed.rows as ReadonlyArray<Record<string, unknown>>,
  }, { tenantId: ctx.tenantId, actorId: ctx.actorId });

  const sampleRows = parsed.rows.slice(0, 5).map((r) => ({
    assessmentNumber: r.assessmentNumber,
    address: r.address,
    suburb: r.suburb,
    landUse: r.landUse,
    valuation: r.valuation,
    annualRates: r.annualRates,
    ownerName: r.ownerName,
  }));
  const errorPreview = parsed.errors.slice(0, 10);

  const verb = input.mergeStrategy === "replace" ? "replace" : "upsert into";
  const output = [
    `Preview: ${validCount} valid rows, ${errorCount} errors. Will ${verb} council ${input.councilCode}.`,
    ``,
    `[NOT COMMITTED — re-run with confirm=true and commitToken=${token} within 5 minutes to apply.]`,
  ].join("\n");

  return {
    ok: true,
    output,
    data: {
      councilCode: input.councilCode,
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
