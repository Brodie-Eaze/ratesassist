/**
 * `add_council` handler — register a new council (tenant).
 *
 * Two-phase mutation mirroring `update_owner_contact` and
 * `add_property_note`: a preview call returns a server-issued commit token;
 * a follow-up confirm call (`confirm=true` + matching token) actually
 * appends the council to the in-memory tenant registry.
 *
 * Authorisation is enforced upstream at the REST/web layer — handlers in
 * this adapter trust the dispatcher's auth boundary. Refuses if a council
 * with the supplied `code` already exists.
 */

import type { Council, schemas } from "@ratesassist/contract";

import { recordMutation } from "../audit/index.js";
import type { RequestContext } from "../runtime/context.js";
import {
  conflict,
  invalidInput,
} from "../runtime/errors.js";
import { aud } from "./format.js";

export async function addCouncilHandler(
  input: schemas.ToolInputs["add_council"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  // Confirm path — token must be present and valid for this operation.
  if (input.confirm) {
    if (input.commitToken === undefined) {
      return invalidInput(
        "confirm=true requires a commitToken from the preview call.",
        ctx.correlationId,
      );
    }
    const consumed = ctx.commitTokens.consume(
      input.commitToken,
      "add_council",
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
    if (mut.operation !== "add_council") {
      return conflict("commitToken operation mismatch.", ctx.correlationId);
    }
    if (mut.code !== input.code) {
      return conflict(
        "commitToken was issued for a different council code.",
        ctx.correlationId,
      );
    }
    // Re-check uniqueness at commit time; the registry could have changed
    // between preview and confirm.
    if (ctx.store.getCouncil(mut.code) !== undefined) {
      return conflict(
        `A council with code "${mut.code}" already exists.`,
        ctx.correlationId,
      );
    }
    const council: Council = {
      code: mut.code,
      name: mut.name,
      state: mut.state,
      centerLat: mut.centerLat,
      centerLng: mut.centerLng,
      population: mut.population,
      rateableProperties: mut.rateableProperties,
      rateRevenue: mut.rateRevenue,
    };
    const stored = ctx.store.addCouncil(council);
    if (stored === undefined) {
      return conflict(
        `A council with code "${mut.code}" already exists.`,
        ctx.correlationId,
      );
    }
    recordMutation({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorKind: ctx.actorKind,
      action: "write.add_council",
      target: { type: "council", id: stored.code },
      before: null,
      after: { ...stored },
      correlationId: ctx.correlationId,
      ...(ctx.ip !== undefined ? { ip: ctx.ip } : {}),
      ...(ctx.userAgent !== undefined ? { userAgent: ctx.userAgent } : {}),
    });
    return {
      ok: true,
      output: `Added council ${stored.name} (${stored.code}, ${stored.state}). Persistence is in-memory only — restart will reset the registry.`,
      data: { council: stored },
      mutated: true,
    };
  }

  // Preview path — uniqueness check + token.
  if (ctx.store.getCouncil(input.code) !== undefined) {
    return conflict(
      `A council with code "${input.code}" already exists.`,
      ctx.correlationId,
    );
  }
  const token = ctx.commitTokens.issue({
    operation: "add_council",
    code: input.code,
    name: input.name,
    state: input.state,
    centerLat: input.centerLat,
    centerLng: input.centerLng,
    population: input.population,
    rateableProperties: input.rateableProperties,
    rateRevenue: input.rateRevenue,
  }, { tenantId: ctx.tenantId, actorId: ctx.actorId });
  const text = [
    `Proposed new council:`,
    `  Code: ${input.code}`,
    `  Name: ${input.name}`,
    `  State: ${input.state}`,
    `  Centroid: ${input.centerLat.toFixed(4)}, ${input.centerLng.toFixed(4)}`,
    `  Population: ${input.population.toLocaleString()}`,
    `  Rateable properties: ${input.rateableProperties.toLocaleString()}`,
    `  Rate revenue: ${aud(input.rateRevenue)}`,
    ``,
    `[NOT COMMITTED — re-run with confirm=true and commitToken=${token} within 5 minutes to apply.]`,
  ].join("\n");
  return {
    ok: true,
    output: text,
    data: {
      preview: {
        code: input.code,
        name: input.name,
        state: input.state,
        centerLat: input.centerLat,
        centerLng: input.centerLng,
        population: input.population,
        rateableProperties: input.rateableProperties,
        rateRevenue: input.rateRevenue,
      },
    },
    commitToken: token,
    mutated: false,
  };
}
