/**
 * Property handlers — single-property detail, transaction history, paginated list.
 */

import type { schemas } from "@ratesassist/contract";

import type { RequestContext } from "../runtime/context.js";
import { notFound } from "../runtime/errors.js";
import { aud } from "./format.js";

/** Default page size when `limit` is not supplied. */
const DEFAULT_LIST_LIMIT = 50;

/** Hard upper bound on a single page (mirrors the contract schema's max). */
const MAX_LIST_LIMIT = 1_000;

/** `get_property_detail` — full record for one property. */
export async function getPropertyDetailHandler(
  input: schemas.ToolInputs["get_property_detail"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const property = ctx.store.getProperty(input.assessmentNumber);
  if (property === undefined) {
    return notFound(
      `No property with assessment number "${input.assessmentNumber}".`,
      ctx.correlationId,
    );
  }
  const owners = ctx.store.ownersForProperty(property);
  const tenements = ctx.store.tenementsForAssessment(property.assessmentNumber);

  const ownerLines =
    owners.length > 0
      ? owners
          .map(
            (o) =>
              `  - ${o.name} | ${o.phone ?? "no phone"} | ${o.email ?? "no email"} | postal: ${o.postalAddress} | since ${o.ownerSince}`,
          )
          .join("\n")
      : "  (no owner records resolved)";

  const tenementLines =
    tenements.length > 0
      ? tenements
          .map(
            (t) =>
              `  - ${t.tenementId} | ${t.type}-class ${t.status} | ${t.commodity.join(", ")} | holder: ${t.holder}${t.isProducing ? " | producing" : ""}`,
          )
          .join("\n")
      : "  (no intersecting tenements on file)";

  const lastPaymentSegment =
    property.lastPaymentDate !== null
      ? `${property.lastPaymentDate}${
          property.lastPaymentAmount !== null
            ? ` (${aud(property.lastPaymentAmount)} via ${property.paymentMethod ?? "unknown method"})`
            : ""
        }`
      : "none";

  const text = [
    `Assessment ${property.assessmentNumber}`,
    `Address: ${property.address}, ${property.suburb} ${property.postcode} ${property.state}`,
    `Land use: ${property.landUse}`,
    `Valuation: ${aud(property.valuation)}`,
    `Annual rates: ${aud(property.annualRates)}`,
    `Outstanding balance: ${aud(property.balance)}`,
    `Last payment: ${lastPaymentSegment}`,
    `Pensioner rebate: ${property.pensionerRebate ? "yes" : "no"}`,
    `Payment arrangement: ${property.paymentArrangement ? "yes" : "no"}`,
    ``,
    `Owner(s):`,
    ownerLines,
    ``,
    `Intersecting mining tenements:`,
    tenementLines,
    ``,
    `Notes:`,
    property.notes.length > 0
      ? property.notes.map((n) => `  - ${n}`).join("\n")
      : "  (none)",
  ].join("\n");

  return {
    ok: true,
    output: text,
    data: { property, owners: [...owners], tenements: [...tenements] },
    mutated: false,
  };
}

/** `get_transaction_history` — chronological transaction list. */
export async function getTransactionHistoryHandler(
  input: schemas.ToolInputs["get_transaction_history"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const property = ctx.store.getProperty(input.assessmentNumber);
  if (property === undefined) {
    return notFound(
      `No property with assessment number "${input.assessmentNumber}".`,
      ctx.correlationId,
    );
  }
  const txs = ctx.store.getTransactions(input.assessmentNumber);
  if (txs.length === 0) {
    return {
      ok: true,
      output: `No transactions on file for ${input.assessmentNumber}.`,
      data: { assessmentNumber: input.assessmentNumber, transactions: [] },
      mutated: false,
    };
  }
  const lines = txs
    .map(
      (t) =>
        `${t.date} | ${t.type.padEnd(18)} | ${aud(t.amount).padStart(12)} | ${t.reference} | bal ${aud(t.balance)}`,
    )
    .join("\n");
  return {
    ok: true,
    output: `Transactions for ${input.assessmentNumber}:\n${lines}`,
    data: { assessmentNumber: input.assessmentNumber, transactions: [...txs] },
    mutated: false,
  };
}

/** `list_properties` — paginated list, optionally restricted to one council. */
export async function listPropertiesHandler(
  input: schemas.ToolInputs["list_properties"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const all = ctx.store.listProperties(input.council);
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const offset = input.offset ?? 0;
  const page = all.slice(offset, offset + limit);
  if (page.length === 0) {
    const where = input.council ? ` for council "${input.council}"` : "";
    return {
      ok: true,
      output: `No properties found${where} at offset ${offset}.`,
      data: { total: all.length, offset, limit, properties: [] },
      mutated: false,
    };
  }
  const text = [
    `Page of ${page.length} of ${all.length} properties${input.council ? ` for ${input.council}` : ""} (offset ${offset}, limit ${limit}):`,
    ...page.map(
      (p) =>
        `  - ${p.assessmentNumber} | ${p.address}, ${p.suburb} | ${p.landUse} | balance ${aud(p.balance)}`,
    ),
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { total: all.length, offset, limit, properties: [...page] },
    mutated: false,
  };
}
