/**
 * @ratesassist/identity
 *
 * Identity / entity-verification integrations: ATO ABN Lookup with
 * strict-live mode, bounded retry, and PII-safe failure surfaces.
 *
 * Depends only on `@ratesassist/contract` and `zod`.
 */

export {
  createAbnClient,
  KNOWN_MOCK_ABNS,
  type AbnClient,
  type AbnClientConfig,
  type AbnLookupResult,
  type AbnErrorCode,
  type LookupAbnOptions,
} from "./abn.js";
