/**
 * Identity handlers — ABN verification (mock-mode demo) and council list.
 */
import { failure, invalidInput, notFound } from "../runtime/errors.js";
import { intAu } from "./format.js";
/** `verify_abn` — composed over `@ratesassist/identity`. */
export async function verifyAbnHandler(input, ctx) {
    const result = await ctx.abnClient.lookupAbn(input.abn, {
        correlationId: ctx.correlationId,
    });
    if (!result.ok) {
        switch (result.code) {
            case "invalid_input":
                return invalidInput(result.error, ctx.correlationId);
            case "not_found":
                return notFound(`ABN ${input.abn} was not found in the ABR.`, ctx.correlationId);
            case "timeout":
                return failure("timeout", result.error, ctx.correlationId, true);
            case "upstream_error":
                return failure("upstream_error", result.error, ctx.correlationId, true);
            case "unconfigured":
                return failure("internal_error", "ABN client is not configured for live lookups (no GUID).", ctx.correlationId, false);
            default:
                return failure("internal_error", result.error, ctx.correlationId, false);
        }
    }
    const text = [
        `ABN ${result.abn} — ${result.entityName}`,
        `Status: ${result.status}`,
        `Type: ${result.entityType ?? "unspecified"}`,
        `GST registered: ${result.gstRegistered ? "yes" : "no"}${result.gstRegisteredFrom ? ` (since ${result.gstRegisteredFrom})` : ""}`,
        `Address (best effort): ${result.address ?? "not provided"}`,
        `Source: ${result.source}`,
    ].join("\n");
    return {
        ok: true,
        output: text,
        data: { lookup: result },
        mutated: false,
    };
}
/** `list_councils` — list every tenant the adapter knows about. */
export async function listCouncilsHandler(_input, ctx) {
    const councils = ctx.store.listCouncils();
    const lines = councils
        .map((c) => `  - ${c.code} | ${c.name} (${c.state}) | population ${intAu(c.population)} | rateable ${intAu(c.rateableProperties)}`)
        .join("\n");
    return {
        ok: true,
        output: `${councils.length} councils:\n${lines}`,
        data: { councils: [...councils] },
        mutated: false,
    };
}
//# sourceMappingURL=identity.js.map