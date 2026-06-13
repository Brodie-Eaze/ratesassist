/**
 * Search handlers — free-text property search and owner-name search.
 *
 * Both return human-readable summaries plus structured `data` payloads so
 * the calling UI can render rich results without re-parsing the text.
 */

import type { schemas } from "@ratesassist/contract";

import type { RequestContext } from "../runtime/context.js";
import { aud } from "./format.js";

/**
 * Cap on result rows surfaced in the human-readable text. Structured `data`
 * is unbounded so the UI can paginate; the narration is bounded so the LLM
 * doesn't drown in noise.
 */
const MAX_RESULT_LINES = 25;

/**
 * Render one property as a single-line search result.
 */
function lineForProperty(
  p: { assessmentNumber: string; address: string; suburb: string; postcode: string; landUse: string; balance: number },
): string {
  return `${p.assessmentNumber} — ${p.address}, ${p.suburb} ${p.postcode} | ${p.landUse} | balance ${aud(p.balance)}`;
}

/** `search_property` — substring match across address, suburb, postcode, assessment. */
export async function searchPropertyHandler(
  input: schemas.ToolInputs["search_property"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const matches = ctx.store.searchProperties(input.query, input.council);
  if (matches.length === 0) {
    return {
      ok: true,
      output: `No properties found matching "${input.query}".`,
      data: { matches: [] },
      mutated: false,
    };
  }
  const shown = matches.slice(0, MAX_RESULT_LINES);
  const overflow = matches.length - shown.length;
  const lines = shown.map(lineForProperty).join("\n");
  const trailer =
    overflow > 0 ? `\n... and ${overflow} more (truncated)` : "";
  return {
    ok: true,
    output: `Found ${matches.length} match(es) for "${input.query}":\n${lines}${trailer}`,
    data: { matches: [...matches] },
    mutated: false,
  };
}

/** `search_by_owner` — owner name (partial) with optional suburb filter. */
export async function searchByOwnerHandler(
  input: schemas.ToolInputs["search_by_owner"],
  ctx: RequestContext,
): Promise<schemas.ToolResult> {
  const matches = ctx.store.searchByOwner(input.name, input.suburb, input.council);
  if (matches.length === 0) {
    return {
      ok: true,
      output: `No properties found for owner matching "${input.name}".`,
      data: { matches: [] },
      mutated: false,
    };
  }
  const shown = matches.slice(0, MAX_RESULT_LINES);
  const overflow = matches.length - shown.length;
  const lines = shown
    .map((p) => {
      const owners = ctx.store.ownersForProperty(p).map((o) => o.name).join(", ");
      return `${p.assessmentNumber} — ${p.address}, ${p.suburb} | owner: ${owners} | balance ${aud(p.balance)}`;
    })
    .join("\n");
  const trailer = overflow > 0 ? `\n... and ${overflow} more (truncated)` : "";
  return {
    ok: true,
    output: `Found ${matches.length} property(ies) for owner "${input.name}":\n${lines}${trailer}`,
    data: { matches: [...matches] },
    mutated: false,
  };
}
