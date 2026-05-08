/**
 * Owner handler — single-owner read.
 */

import type { schemas } from "@ratesassist/contract";

import type { RequestContext } from "../runtime/context.js";
import { notFound } from "../runtime/errors.js";

/** `get_owner` — full owner record. */
export async function getOwnerHandler(
  input: schemas.ToolInputs["get_owner"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const owner = ctx.store.getOwner(input.ownerId);
  if (owner === undefined) {
    return notFound(
      `No owner with id "${input.ownerId}".`,
      ctx.correlationId,
    );
  }
  const previous =
    owner.previousOwners.length > 0
      ? owner.previousOwners
          .map((p) => `  - ${p.name} (${p.period})`)
          .join("\n")
      : "  (none on file)";
  const text = [
    `Owner ${owner.ownerId}: ${owner.name}`,
    `ABN: ${owner.abn ?? "not on record"}${owner.abnCheck.kind === "checked" ? ` (status: ${owner.abnCheck.status}, checked ${owner.abnCheck.checkedAt.slice(0, 10)})` : ""}`,
    `Postal address: ${owner.postalAddress}`,
    `Phone: ${owner.phone ?? "not on record"}`,
    `Email: ${owner.email ?? "not on record"}`,
    `Owner since: ${owner.ownerSince}`,
    ``,
    `Previous owners:`,
    previous,
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: { owner },
    mutated: false,
  };
}
