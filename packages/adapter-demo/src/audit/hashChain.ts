/**
 * Back-compat re-export shim. The chain primitives now live in
 * {@link @ratesassist/audit-core}; both this package and `@ratesassist/db`
 * share the same canonicaliser so rows hash byte-identical across the
 * in-memory store and the Postgres-backed sink.
 *
 * Do NOT add new logic here — change it in `packages/audit-core/src/index.ts`
 * (and update tests there). Keeping this file as a passthrough preserves the
 * existing import surface (`./hashChain.js`) used by other modules in
 * adapter-demo.
 */

export {
  PRE_CHAIN_SENTINEL,
  canonicalise,
  canonicalize,
  chainHash,
  computeRowHash,
  genesisHash,
  verifyChain,
  type AuditRowWithHashes,
  type AuditRowWithoutHash,
  type VerifyChainResult,
} from "@ratesassist/audit-core";
