/**
 * Owner handler — single-owner read.
 */
import { notFound } from "../runtime/errors.js";
/** `get_owner` — full owner record. */
export async function getOwnerHandler(input, ctx) {
    const owner = ctx.store.getOwner(input.ownerId);
    if (owner === undefined) {
        return notFound(`No owner with id "${input.ownerId}".`, ctx.correlationId);
    }
    const previous = owner.previousOwners.length > 0
        ? owner.previousOwners
            .map((p) => `  - ${p.name} (${p.period})`)
            .join("\n")
        : "  (none on file)";
    const text = [
        `Owner ${owner.ownerId}: ${owner.name}`,
        `ABN: ${owner.abn ?? "not on record"}${owner.abnStatus ? ` (status: ${owner.abnStatus})` : ""}`,
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
//# sourceMappingURL=owner.js.map