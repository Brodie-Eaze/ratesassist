/**
 * Workspace-package client wiring for `apps/web`.
 *
 * The web app composes types and engines from `@ratesassist/contract`,
 * `@ratesassist/recovery-engine`, and `@ratesassist/identity`. Each of those
 * packages takes its configuration through explicit constructors — they do
 * not read `process.env` themselves. This module is the single place where
 * the web app instantiates those clients and caches them at module scope.
 *
 * Because Next.js may import this module from server components, route
 * handlers, and tool handlers within the same process, the singletons here
 * are intentionally process-local and lazily initialised.
 */

import { createAbnClient, type AbnClient } from "@ratesassist/identity";
import { buildLiveTenementsByAssessment } from "@ratesassist/spatial";
import {
  recoveryStats as engineRecoveryStats,
  findMismatches,
  type ChangeDetectionEntry,
  type EvaluationContext,
} from "@ratesassist/recovery-engine";
import {
  TARGET_STATE_SCOPE,
  WA_RATE_TABLES,
  type Encumbrance,
  type MismatchCandidate,
  type Owner,
  type PensionerConcession,
  type Pin,
  type Property,
  type RateTable,
  type StrataChild,
  type Tenement,
  type TitleSourceFreshness,
  type WaterCorpEligibilityStatus,
} from "@ratesassist/contract";

import { OWNERS, PROPERTIES, TENEMENTS } from "./data";
import { isDbWired } from "./db";
import { scoped } from "./logger";

// IMPORTANT: `@ratesassist/db` and `./db` (the web-app DB factory) are
// dynamically imported inside the async functions below to keep the
// pglite WASM payload + pino thread-stream worker off the synchronous
// module-load graph. Loading them up-front confuses Next.js's webpack
// vendor-chunk splitting and breaks dev-server worker spawning for
// routes that don't touch the DB at all. The cost is a one-time async
// import per process — bootstrap is memoised in {@link getWebDb}.

/**
 * Default ABN-Lookup base. Library code does not read environment, so we read
 * `ABN_LOOKUP_BASE` here and pass it through to the factory.
 */
const ABN_LOOKUP_BASE: string =
  process.env["ABN_LOOKUP_BASE"] ?? "https://abr.business.gov.au/json";

/**
 * Singleton ABN client. The legacy app silently fell back to mock data on
 * upstream failure even when a GUID was configured; the new client
 * distinguishes "no GUID" (mock allowed) from "live call failed" (returns an
 * error). Web-app callers should treat `ok: false` as a real failure mode.
 *
 * Strict mode is left off in the web app so that local development without an
 * ABN_LOOKUP_GUID still surfaces honest mock results. Pilot deployments will
 * flip `strict: true` via configuration change at deploy time.
 */
export const abnClient: AbnClient = createAbnClient({
  baseUrl: ABN_LOOKUP_BASE,
  guid: process.env["ABN_LOOKUP_GUID"] ?? "",
  strict: process.env.NODE_ENV === "production",
});

// ===== Evaluation context for the recovery engine =====

let cachedContext: EvaluationContext | null = null;

/**
 * Build (and memoise) the {@link EvaluationContext} that the recovery engine
 * sweeps over.
 *
 * The context is constructed once per process from the in-memory data layer:
 * an `ownersById` map and a `tenementsByAssessment` index keyed by the
 * `intersectsAssessmentNumbers` field. The recovery engine then evaluates
 * signals in O(1) per property given the indexes.
 *
 * Phase 1B will replace this in-process context with one populated through
 * the MCP client; the engine's signature stays the same.
 */
/**
 * Synthetic GRV / UV overlays for the demo properties that the accurate
 * uplift calculator needs. Production runs receive these from the
 * Valuer-General's record via the rating-system adapter. For the demo we
 * pin plausible numbers against the same assessments the lifecycle-change
 * mocks reference so the accurate path fires end-to-end.
 */
const VALUATIONS_OVERLAY: ReadonlyMap<
  string,
  { readonly grv?: number; readonly uv?: number }
> = new Map([
  ["TPS-1102-91", { grv: 18_000, uv: 40_400 }],
  ["KAL-4401-12", { grv: 22_500, uv: 63_100 }],
  ["ESH-1102-92", { grv: 19_800, uv: 71_200 }],
  ["TPS-3041-12", { grv: 32_500, uv: 280_000 }],
  ["ESH-7011-08", { grv: 184_000, uv: 1_120_000 }],
  ["KAL-7777-01", { grv: 168_000, uv: 1_350_000 }],
  ["ASH-9911-04", { grv: 412_000, uv: 2_800_000 }],
  ["TPS-1102-44", { grv: 22_000, uv: 55_000 }],
  ["MEK-3303-58", { grv: 8_400, uv: 23_500 }],
  ["NEW-9001-12", { grv: 14_200, uv: 42_000 }],
  ["KAL-7000-08", { grv: 28_500, uv: 145_000 }],
  ["IND-EXP-2200", { grv: 96_000, uv: 540_000 }],
]);

function overlayValuations(props: readonly Property[]): readonly Property[] {
  return props.map((p) => {
    const overlay = VALUATIONS_OVERLAY.get(p.assessmentNumber);
    if (overlay === undefined) return p;
    return { ...p, grv: overlay.grv, uv: overlay.uv };
  });
}

/**
 * VEN + CT + Concession property overlay for the demo dataset.
 *
 * The seeded `PROPERTIES` array in `lib/data.ts` does not carry the new
 * optional VEN/CT/Concession fields (the rating-roll CSV importer doesn't
 * receive them either — the council-side schema predates the Landgate
 * cross-reference). The Round-3 demo signals need the council-side fields
 * populated so the engine can compare them against the synthetic Landgate
 * + Water Corp records below.
 *
 * Each entry mutates the council's view of the title — e.g. a deliberate
 * proprietor mismatch (council records JONES; Landgate records SMITH) so
 * `mismatch.proprietor` fires. The entries are deliberately partial —
 * legacy assessments without overlay entries continue to behave exactly
 * as before.
 *
 * Source-freshness labels (`titleSource`) carry an honest source tier and
 * timestamp so the evidence pack renders an accurate provenance caveat.
 */
type VenCtOverlay = {
  readonly ven?: string;
  readonly pins?: readonly Pin[];
  readonly ctVolume?: string;
  readonly ctFolio?: string;
  readonly ctIssuedDate?: string;
  readonly proprietorOnTitle?: string;
  readonly proprietorPostalAddress?: string;
  readonly strataParentCt?: { readonly volume: string; readonly folio: string };
  readonly strataChildren?: readonly StrataChild[];
  readonly encumbrances?: readonly Encumbrance[];
  readonly pensionerConcession?: PensionerConcession;
  readonly titleSource?: TitleSourceFreshness;
};

const VEN_CT_OVERLAY: ReadonlyMap<string, VenCtOverlay> = new Map<
  string,
  VenCtOverlay
>([
  // Proprietor mismatch: council says JONES, Landgate (below) says SMITH.
  // Existing fixture already fires reg.address_mismatch + renovation
  // detection, so this stacks two title signals on the same property.
  [
    "TPS-3041-12",
    {
      ven: "VEN-TPS-3041-12",
      ctVolume: "1845",
      ctFolio: "207",
      ctIssuedDate: "2018-03-12",
      proprietorOnTitle: "JONES, ROBERT A. & JONES, MARGARET J.",
      proprietorPostalAddress: "12 Stadium Road, Tom Price WA 6751",
      titleSource: {
        source: "council_uploaded_pdf",
        retrievedAt: "2026-05-01T08:30:00Z",
        lagWarning:
          "CT search PDF uploaded 2026-05-01 by council clerk; predates the 2026-03 Landgate refresh.",
      },
    },
  ],
  // CT volume/folio changed: council still records the pre-amendment CT.
  // Landgate (overlay below) has issued a new CT after the boundary
  // amendment.
  [
    "ASH-9911-04",
    {
      ven: "VEN-ASH-9911-04",
      ctVolume: "2718",
      ctFolio: "104",
      ctIssuedDate: "2015-03-14",
      proprietorOnTitle: "Pilbara Minerals Processing Ltd",
      proprietorPostalAddress:
        "Level 8, 240 St Georges Terrace, Perth WA 6000",
      titleSource: {
        source: "council_uploaded_pdf",
        retrievedAt: "2026-04-10T09:00:00Z",
        lagWarning:
          "Council's CT search PDF dates from before the BA-2026-019 boundary amendment.",
      },
    },
  ],
  // Multi-PIN landuse divergence: 3 PINs under one VEN. Council rates the
  // parcel Commercial; one of the three PINs has flipped to Industrial on
  // Landgate per the DA-2025-184 fitout (lifecycle-change record on file).
  [
    "ESH-7011-08",
    {
      ven: "VEN-ESH-7011-08",
      pins: [
        {
          pin: "9001247-A",
          lotPlan: "Lot 7011A DP 23145",
          landuseCode: "Commercial",
          areaSquareMetres: 4_200,
        },
        {
          pin: "9001247-B",
          lotPlan: "Lot 7011B DP 23145",
          landuseCode: "Commercial",
          areaSquareMetres: 3_100,
        },
        {
          pin: "9001247-C",
          lotPlan: "Lot 7011C DP 23145",
          landuseCode: "Commercial",
          areaSquareMetres: 2_800,
        },
      ],
      ctVolume: "2901",
      ctFolio: "812",
      ctIssuedDate: "2010-07-10",
      proprietorOnTitle: "Newman Trading Co Pty Ltd",
      proprietorPostalAddress: "PO Box 401, Newman WA 6753",
      titleSource: {
        source: "landgate_restricted",
        retrievedAt: "2026-05-10T03:15:00Z",
      },
    },
  ],
  // Strata parent — council still rates Hannan Street 211 as one parcel;
  // Landgate has issued 3 child CTs (SUB-2025-722) following subdivision.
  // The change-detection record on file already says subdivision_detected.
  [
    "KAL-7777-01",
    {
      ven: "VEN-KAL-7777-01",
      ctVolume: "2410",
      ctFolio: "199",
      ctIssuedDate: "1999-02-03",
      proprietorOnTitle: "Hannan Holdings Pty Ltd",
      proprietorPostalAddress: "Hannan Street 211, Kalgoorlie WA 6430",
      strataParentCt: { volume: "2410", folio: "199" },
      strataChildren: [
        { volume: "3801", folio: "211" },
        { volume: "3801", folio: "211A" },
        { volume: "3801", folio: "211B" },
      ],
      titleSource: {
        source: "landgate_restricted",
        retrievedAt: "2026-05-11T01:30:00Z",
      },
    },
  ],
  // Pensioner deceased — council still applying rebate; Water Corp records
  // status DECEASED. Margaret Thompson, 44 Yampire Road, Tom Price.
  [
    "TPS-3041-44",
    {
      ven: "VEN-TPS-3041-44",
      ctVolume: "1610",
      ctFolio: "044",
      ctIssuedDate: "1998-03-22",
      proprietorOnTitle: "THOMPSON, MARGARET",
      proprietorPostalAddress: "44 Yampire Road, Tom Price WA 6751",
      pensionerConcession: {
        applied: true,
        type: "pensioner",
        appliedAt: "2014-07-01",
        cardNumber: "****-****-1188",
        cardExpiry: "2027-04-30",
        wcEligibilityVerifiedAt: "2026-05-10T22:00:00Z",
        wcEligibilityStatus: "deceased",
        wcCancellationReason: "Death notified by next of kin",
        wcCancellationDate: "2026-02-14",
      },
      titleSource: {
        source: "wc_feed",
        retrievedAt: "2026-05-10T22:00:00Z",
      },
    },
  ],
  // Pensioner eligibility cancelled — Lot 1147 Great Northern Highway.
  // Demo narrative: original holder downsized to a smaller assessment;
  // WC cancelled the card; council's monthly recon hasn't picked it up.
  [
    "TPS-1102-47",
    {
      ven: "VEN-TPS-1102-47",
      ctVolume: "1622",
      ctFolio: "147",
      ctIssuedDate: "2017-08-21",
      proprietorOnTitle: "Pilbara Iron Holdings Pty Ltd",
      proprietorPostalAddress:
        "Level 12, 100 St Georges Terrace, Perth WA 6000",
      pensionerConcession: {
        applied: true,
        type: "senior",
        appliedAt: "2017-09-01",
        cardNumber: "****-****-7321",
        cardExpiry: "2027-09-30",
        wcEligibilityVerifiedAt: "2026-05-09T18:45:00Z",
        wcEligibilityStatus: "cancelled",
        wcCancellationReason: "Holder downsized to another assessment",
        wcCancellationDate: "2026-01-19",
      },
      titleSource: {
        source: "wc_feed",
        retrievedAt: "2026-05-09T18:45:00Z",
      },
    },
  ],
  // Pensioner card expired — Lot 1171 Karratha-Tom Price Road. Card
  // lapsed; council still applying the rebate.
  [
    "ESH-1102-71",
    {
      ven: "VEN-ESH-1102-71",
      ctVolume: "2540",
      ctFolio: "171",
      ctIssuedDate: "2022-11-14",
      proprietorOnTitle: "MURPHY, KEVIN J.",
      proprietorPostalAddress: "Lot 1171 Karratha-Tom Price Road, Karratha WA 6714",
      pensionerConcession: {
        applied: true,
        type: "pensioner",
        appliedAt: "2020-04-01",
        cardNumber: "****-****-9920",
        cardExpiry: "2024-12-31",
        wcEligibilityVerifiedAt: "2026-05-09T18:45:00Z",
        wcEligibilityStatus: "expired",
      },
      titleSource: {
        source: "wc_feed",
        retrievedAt: "2026-05-09T18:45:00Z",
      },
    },
  ],
]);

function overlayVenCt(props: readonly Property[]): readonly Property[] {
  return props.map((p) => {
    const overlay = VEN_CT_OVERLAY.get(p.assessmentNumber);
    if (overlay === undefined) return p;
    return {
      ...p,
      ...(overlay.ven !== undefined ? { ven: overlay.ven } : {}),
      ...(overlay.pins !== undefined ? { pins: overlay.pins } : {}),
      ...(overlay.ctVolume !== undefined ? { ctVolume: overlay.ctVolume } : {}),
      ...(overlay.ctFolio !== undefined ? { ctFolio: overlay.ctFolio } : {}),
      ...(overlay.ctIssuedDate !== undefined
        ? { ctIssuedDate: overlay.ctIssuedDate }
        : {}),
      ...(overlay.proprietorOnTitle !== undefined
        ? { proprietorOnTitle: overlay.proprietorOnTitle }
        : {}),
      ...(overlay.proprietorPostalAddress !== undefined
        ? { proprietorPostalAddress: overlay.proprietorPostalAddress }
        : {}),
      ...(overlay.strataParentCt !== undefined
        ? { strataParentCt: overlay.strataParentCt }
        : {}),
      ...(overlay.strataChildren !== undefined
        ? { strataChildren: overlay.strataChildren }
        : {}),
      ...(overlay.encumbrances !== undefined
        ? { encumbrances: overlay.encumbrances }
        : {}),
      ...(overlay.pensionerConcession !== undefined
        ? { pensionerConcession: overlay.pensionerConcession }
        : {}),
      ...(overlay.titleSource !== undefined
        ? { titleSource: overlay.titleSource }
        : {}),
    };
  });
}

export function getEvaluationContext(): EvaluationContext {
  if (cachedContext !== null) return cachedContext;

  // Sync path: build from the in-process arrays. When `RA_USE_DB=true` the
  // intent is to read from Postgres — but the existing API surface is sync
  // and we cannot await here. Callers that need a DB-backed snapshot should
  // call {@link getEvaluationContextAsync} (or trigger a bootstrap during
  // module-init); they then see the DB-derived cache on this sync call.
  // The fallback is preserved so that routes don't crash when the bootstrap
  // hasn't completed yet — they get the in-memory shape, identical in
  // semantics to the DB-derived one.
  cachedContext = buildContextFromInMemory();
  return cachedContext;
}

/**
 * Async DB-aware companion to {@link getEvaluationContext}. When
 * {@link isDbWired} returns true, hydrates the EvaluationContext from the
 * Postgres rows (via `@ratesassist/db`) and caches the result. When DB
 * routing is disabled, behaves identically to the sync variant.
 *
 * Returns the same cached object as a subsequent sync call so callers can
 * interleave the two: a bootstrap call awaits this once, then every
 * `getEvaluationContext()` invocation in the same process serves the
 * DB-derived snapshot from cache.
 */
export async function getEvaluationContextAsync(): Promise<EvaluationContext> {
  if (cachedContext !== null) return cachedContext;
  if (!isDbWired()) {
    cachedContext = buildContextFromInMemory();
    return cachedContext;
  }
  cachedContext = await buildContextFromDb();
  return cachedContext;
}

// ── E3: Per-tenant evaluation context (scale-safe path) ──────────────────────
// Scale improvement:
//   Before E3: 1 context = all tenants × all properties (unbounded)
//   After  E3: 1 context per tenant × candidate properties only
//              (~30–40% of full dataset after SQL pre-filter)
//
// Key design choices:
//   1. Per-tenant isolation — each tenantId gets its own cache entry.
//      A mutation in tenant A invalidates only A's entry, not all others.
//   2. TTL = 5 minutes — officers actively query the system; staleness
//      of up to 5 minutes is acceptable. Mutations call
//      `invalidateEvaluationContextForTenant` immediately so they see the
//      new state on the next request.
//   3. SQL candidate pre-filter — `findCandidateAssessmentsBySql` from
//      `./mismatchSql` returns only the assessment numbers that can fire
//      at least one signal. This avoids loading urban/residential
//      properties that no current signal ever touches.
//   4. Tenement scope — loads only tenements that overlap this tenant's
//      candidate properties (via `tenement_properties` join table), not
//      the entire global tenement register.

const LIVE_TENEMENTS_ENABLED =
  process.env["RA_LIVE_TENEMENTS"] === "1" ||
  process.env["RA_LIVE_TENEMENTS"]?.toLowerCase() === "true";

const PER_TENANT_CTX_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface PerTenantCacheEntry {
  readonly ctx: EvaluationContext;
  readonly ts: number;
}

const _tenantCtxCache = new Map<string, PerTenantCacheEntry>();

/**
 * Build an EvaluationContext scoped to a single tenant (E3 path).
 *
 * Unlike the legacy `buildContextFromDb` (which loads all tenants), this
 * function:
 *   1. Loads only the specified tenant's properties (filtered to candidates
 *      by `findCandidateAssessmentsBySql`).
 *   2. Loads only that tenant's owners.
 *   3. Loads only tenements that intersect this tenant's candidate
 *      properties, via the `tenement_properties` FK join table.
 *   4. Falls back to the full-context build if the SQL pre-filter is
 *      unavailable (e.g. fresh DB with no tenement_properties rows) so the
 *      recovery engine still produces results.
 */
async function buildContextFromDbForTenant(
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  db: import("@ratesassist/db").Db,
): Promise<EvaluationContext> {
  const log = scoped("apps/web/clients");
  const start = Date.now();
  const {
    eq,
    and,
    inArray,
    sql: sqlTag,
    owners: ownersTable,
    properties: propertiesTable,
    propertyOwners: propertyOwnersTable,
    tenants: tenantsTable,
    tenements: tenementsTable,
    tenementProperties: tenementPropertiesTable,
    withTenant,
  } = await import("@ratesassist/db");

  // ── Step 0: Resolve the tenant's council code ─────────────────────────────
  // The `council` field on Property uses the short code (e.g. "TPS"), not
  // the UUID. The session's tenantId IS the short code, so look it up by
  // `code` (not `id` which is a UUID — querying a UUID column with "TPS"
  // produces a 22P02 error). If no row is found, fall back to tenantId itself.
  const tenantRows = await db
    .select({ id: tenantsTable.id, code: tenantsTable.code })
    .from(tenantsTable)
    .where(eq(tenantsTable.code, tenantId));
  const tenantCode = tenantRows[0]?.code ?? tenantId;
  // The UUID to use for columns typed as `uuid` (e.g. properties.tenant_id,
  // owners.tenant_id). The session tenantId is the short code; the DB rows
  // hold the UUID. If no row was found (fresh DB with no tenants row yet),
  // fall back to tenantId — it will produce a graceful empty result rather
  // than a 22P02 error.
  const tenantUuid = tenantRows[0]?.id ?? tenantId;

  // ── Step 1: SQL candidate pre-filter ─────────────────────────────────────
  // Identify assessment numbers that CAN fire a signal before loading rows.
  // Degrades gracefully: if the filter returns 0 (e.g. empty DB), fall back
  // to loading all properties for the tenant.
  let candidateAssessments: ReadonlySet<string> | null = null;
  try {
    const { findCandidateAssessmentsBySql } = await import("./mismatchSql");
    candidateAssessments = await findCandidateAssessmentsBySql(db, tenantUuid);
  } catch (e) {
    log.warn({
      msg: "eval_context.candidate_prefilter_failed",
      tenantId,
      err: e instanceof Error ? e.message : String(e),
    });
  }

  // ── Step 2: Load candidate properties for this tenant ────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const propertyRows: any[] = await withTenant(db, tenantUuid, async (tx) => {
    const baseCondition = and(
      eq(propertiesTable.tenantId, tenantUuid),
      sqlTag`${propertiesTable.deletedAt} IS NULL`,
    );
    // If we got a non-empty candidate set, add the IN filter. If the set is
    // empty (no candidates) or null (filter failed), load everything.
    if (candidateAssessments !== null && candidateAssessments.size > 0) {
      const candidates = Array.from(candidateAssessments);
      return tx
        .select()
        .from(propertiesTable)
        .where(and(baseCondition, inArray(propertiesTable.assessmentNumber, candidates)));
    }
    return tx
      .select()
      .from(propertiesTable)
      .where(baseCondition);
  });

  const propertyIdSet = new Set<string>(propertyRows.map((p) => p.id));
  const assessmentNumberSet = new Set<string>(propertyRows.map((p) => p.assessmentNumber));

  // ── Step 3: Load owners for this tenant ──────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ownerRows: any[] = await withTenant(db, tenantUuid, async (tx) => {
    return tx
      .select()
      .from(ownersTable)
      .where(eq(ownersTable.tenantId, tenantUuid));
  });
  const ownerIdToExt = new Map<string, string>();
  const ownersAcc: Owner[] = [];
  for (const o of ownerRows) {
    ownerIdToExt.set(o.id, o.ownerExtId);
    const ownerExtId: string = o.ownerExtId;
    const checkedAt: Date | null = o.abnCheckedAt ?? null;
    const status: "Active" | "Cancelled" | "Suspended" | null = o.abnStatus ?? null;
    ownersAcc.push({
      ownerId: ownerExtId,
      name: o.name,
      abn: o.abn ?? null,
      abnCheck:
        checkedAt !== null && status !== null
          ? { kind: "checked", status, checkedAt: checkedAt.toISOString() }
          : { kind: "unchecked" },
      postalAddress: o.postalAddress,
      email: o.email ?? null,
      phone: o.phone ?? null,
      ownerSince: o.ownerSince,
      previousOwners: o.previousOwners ?? [],
    });
  }

  // ── Step 4: Property→Owner join (scoped to candidate properties) ─────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allPropertyOwnerRows: any[] = await withTenant(db, tenantUuid, async (tx) => {
    return tx.select().from(propertyOwnersTable)
      .where(inArray(propertyOwnersTable.propertyId, Array.from(propertyIdSet)));
  });
  const propertyOwnerRows = allPropertyOwnerRows.filter((r) =>
    propertyIdSet.has(r.propertyId),
  );
  const ownersByPropertyId = new Map<string, string[]>();
  for (const row of propertyOwnerRows) {
    const list = ownersByPropertyId.get(row.propertyId) ?? [];
    const extId = ownerIdToExt.get(row.ownerId);
    if (extId !== undefined) list.push(extId);
    ownersByPropertyId.set(row.propertyId, list);
  }

  // ── Step 5: Build Property objects ───────────────────────────────────────
  const propertiesAcc: Property[] = [];
  for (const p of propertyRows) {
    const ownerIds: string[] = ownersByPropertyId.get(p.id) ?? [];
    propertiesAcc.push({
      assessmentNumber: p.assessmentNumber,
      council: tenantCode,
      address: p.address,
      suburb: p.suburb,
      postcode: p.postcode,
      state: p.state,
      landUse: p.landUse,
      valuation: Number(p.valuation),
      annualRates: Number(p.annualRates),
      balance: Number(p.balance),
      lastPaymentDate: p.lastPaymentDate
        ? (p.lastPaymentDate as Date).toISOString().slice(0, 10)
        : null,
      lastPaymentAmount:
        p.lastPaymentAmount !== null && p.lastPaymentAmount !== undefined
          ? Number(p.lastPaymentAmount)
          : null,
      paymentMethod: p.paymentMethod ?? null,
      pensionerRebate: p.pensionerRebate ?? false,
      paymentArrangement: p.paymentArrangement ?? false,
      ownerIds,
      notes: p.notes ?? [],
      lat: Number(p.centroidLat),
      lng: Number(p.centroidLng),
      ...parcelFromGeoJson(p.parcel),
    });
  }

  // ── Step 7: Load tenements scoped to candidate properties ────────────────
  // Use the tenement_properties join table to avoid loading the entire
  // global tenement register. Only load tenements that intersect at least
  // one candidate property for this tenant.
  let tenementsAcc: Tenement[] = [];
  if (propertyIdSet.size > 0) {
    const propertyIds = Array.from(propertyIdSet);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const joinRows: any[] = await db
      .select({ tenementId: tenementPropertiesTable.tenementId })
      .from(tenementPropertiesTable)
      .where(inArray(tenementPropertiesTable.propertyId, propertyIds));

    const tenementUuids = [...new Set(joinRows.map((r) => r.tenementId))];
    if (tenementUuids.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tenementRows: any[] = await db
        .select()
        .from(tenementsTable)
        .where(inArray(tenementsTable.id, tenementUuids));

      tenementsAcc = tenementRows.map((t) => ({
        tenementId: t.tenementId,
        type: t.type,
        status: t.status,
        holder: t.holder,
        holderAbn: t.holderAbn ?? null,
        commodity: t.commodity ?? [],
        grantedDate: t.grantedDate,
        expiryDate: t.expiryDate,
        areaHectares: Number(t.areaHectares),
        intersectsAssessmentNumbers: (t.intersectsAssessmentNumbers ?? []).filter(
          (an: string) => assessmentNumberSet.has(an),
        ),
        isProducing: t.isProducing ?? false,
        lastWorkProgramYear: t.lastWorkProgramYear ?? null,
        polygon: polygonFromGeoJson(t.polygon),
      }));
    }
  }

  // ── Step 8: Build indexes ─────────────────────────────────────────────────
  const ownersById = new Map<string, Owner>(
    ownersAcc.map((o) => [o.ownerId, o]),
  );
  const tenementsByAssessment = new Map<string, Tenement[]>();
  for (const tenement of tenementsAcc) {
    for (const an of tenement.intersectsAssessmentNumbers) {
      const list = tenementsByAssessment.get(an);
      if (list === undefined) {
        tenementsByAssessment.set(an, [tenement]);
      } else {
        list.push(tenement);
      }
    }
  }

  const enrichedProperties = overlayVenCt(overlayValuations(propertiesAcc));

  // Live tenements gate — honours the RA_LIVE_TENEMENTS flag (same as the
  // global buildContextFromDb path).
  let finalTenementsByAssessment: ReadonlyMap<string, readonly Tenement[]> =
    tenementsByAssessment;
  if (LIVE_TENEMENTS_ENABLED) {
    const live = await buildLiveTenementsByAssessment(enrichedProperties);
    if (live.ok) {
      finalTenementsByAssessment = live.tenementsByAssessment;
      log.info({
        msg: "eval_context.live_tenements",
        source: live.source,
        tenements: live.tenementCount,
        matchedAssessments: live.matchedAssessments,
        tenantId,
      });
    }
  }

  const propertiesByOwnerId = new Map<string, Property[]>();
  const ruralBySuburb = new Map<string, Property[]>();
  for (const p of enrichedProperties) {
    for (const ownerId of p.ownerIds) {
      const bucket = propertiesByOwnerId.get(ownerId);
      if (bucket === undefined) {
        propertiesByOwnerId.set(ownerId, [p]);
      } else {
        bucket.push(p);
      }
    }
    if (p.landUse === "Rural") {
      const bucket = ruralBySuburb.get(p.suburb);
      if (bucket === undefined) {
        ruralBySuburb.set(p.suburb, [p]);
      } else {
        bucket.push(p);
      }
    }
  }

  log.info({
    msg: "eval_context.tenant_hydrated",
    tenantId,
    tenantCode,
    durationMs: Date.now() - start,
    properties: enrichedProperties.length,
    candidatesFiltered: candidateAssessments?.size ?? "all",
    owners: ownersAcc.length,
    tenements: tenementsAcc.length,
  });

  return {
    properties: enrichedProperties,
    ownersById,
    tenementsByAssessment: finalTenementsByAssessment,
    propertiesByOwnerId,
    ruralBySuburb,
    lagCandidatesByAssessment: MOCK_LAG_CANDIDATES_BY_ASSESSMENT,
    addressDiscrepanciesByAssessment: MOCK_ADDRESS_DISCREPANCIES_BY_ASSESSMENT,
    emitsApprovalsByTenement: MOCK_EMITS_APPROVALS_BY_TENEMENT,
    changeDetectionByAssessment: MOCK_CHANGE_DETECTION_BY_ASSESSMENT,
    landgateRecordsByVen: MOCK_LANDGATE_RECORDS_BY_VEN,
    waterCorpEligibilityByCardOrProprietor: MOCK_WC_ELIGIBILITY,
    proprietorDeceasedReferences: MOCK_PROPRIETOR_DECEASED_REFERENCES,
    rateTablesByCouncil: RATE_TABLES_BY_COUNCIL,
    targetStateScope: TARGET_STATE_SCOPE,
  };
}

/**
 * Per-tenant evaluation context (E3 path — scoped, cached, SQL-pre-filtered).
 *
 * Returns the EvaluationContext for the specified tenant, building and
 * caching it per-tenant with a 5-minute TTL. Prefers the tenant-scoped
 * DB path when `isDbWired()` is true; falls back to the in-memory demo
 * data when the DB is not wired (dev without `RA_USE_DB=true`).
 *
 * Call sites that know the active tenantId (routes with a resolved session)
 * should prefer this function over `getEvaluationContext()` to get the
 * scale-safe path.
 */
export async function getEvaluationContextForTenant(
  tenantId: string,
): Promise<EvaluationContext> {
  // Per-tenant cache hit?
  const cached = _tenantCtxCache.get(tenantId);
  if (cached !== undefined && Date.now() - cached.ts < PER_TENANT_CTX_TTL_MS) {
    return cached.ctx;
  }

  if (!isDbWired()) {
    // Dev without DB: fall back to the in-memory demo data (same data for
    // every tenantId, but correct in shape for signal evaluation).
    const ctx = buildContextFromInMemory();
    _tenantCtxCache.set(tenantId, { ctx, ts: Date.now() });
    return ctx;
  }

  const { getWebDb } = await import("./db");
  const db = await getWebDb();
  const ctx = await buildContextFromDbForTenant(tenantId, db);
  _tenantCtxCache.set(tenantId, { ctx, ts: Date.now() });
  return ctx;
}

/**
 * Invalidate the cached EvaluationContext for a specific tenant.
 *
 * Mutation handlers (import, strata conversion, Landgate title import, etc.)
 * MUST call this after a successful commit so subsequent recovery sweeps for
 * that tenant observe the new state.
 *
 * This is narrower than `invalidateEvaluationContext()` (which clears the
 * global single-tenant cache); callers that know the tenantId should prefer
 * this to avoid invalidating other tenants' caches unnecessarily.
 */
export function invalidateEvaluationContextForTenant(tenantId: string): void {
  _tenantCtxCache.delete(tenantId);
  // No async re-hydration here — the next call to
  // getEvaluationContextForTenant will rebuild lazily.
}

/** Test hook: reset ALL per-tenant cache entries. */
export function __resetPerTenantContextCacheForTests(): void {
  _tenantCtxCache.clear();
}

function buildContextFromInMemory(): EvaluationContext {
  const ownersById = new Map(OWNERS.map((o) => [o.ownerId, o]));

  const tenementsByAssessment = new Map<string, Tenement[]>();
  for (const tenement of TENEMENTS) {
    for (const assessment of tenement.intersectsAssessmentNumbers) {
      const list = tenementsByAssessment.get(assessment);
      if (list === undefined) {
        tenementsByAssessment.set(assessment, [tenement]);
      } else {
        list.push(tenement);
      }
    }
  }

  // PERF-002 / PERF-003: build per-owner and per-suburb-rural indexes in a
  // single pass over PROPERTIES so the scoring engine can look up O(1)
  // instead of re-scanning the full property list on every signal eval.
  const enrichedProperties = overlayVenCt(overlayValuations(PROPERTIES));
  const propertiesByOwnerId = new Map<string, Property[]>();
  const ruralBySuburb = new Map<string, Property[]>();
  for (const p of enrichedProperties) {
    for (const ownerId of p.ownerIds) {
      const bucket = propertiesByOwnerId.get(ownerId);
      if (bucket === undefined) {
        propertiesByOwnerId.set(ownerId, [p]);
      } else {
        bucket.push(p);
      }
    }
    if (p.landUse === "Rural") {
      const bucket = ruralBySuburb.get(p.suburb);
      if (bucket === undefined) {
        ruralBySuburb.set(p.suburb, [p]);
      } else {
        bucket.push(p);
      }
    }
  }

  return {
    properties: enrichedProperties,
    ownersById,
    tenementsByAssessment,
    propertiesByOwnerId,
    ruralBySuburb,
    lagCandidatesByAssessment: MOCK_LAG_CANDIDATES_BY_ASSESSMENT,
    addressDiscrepanciesByAssessment: MOCK_ADDRESS_DISCREPANCIES_BY_ASSESSMENT,
    emitsApprovalsByTenement: MOCK_EMITS_APPROVALS_BY_TENEMENT,
    changeDetectionByAssessment: MOCK_CHANGE_DETECTION_BY_ASSESSMENT,
    landgateRecordsByVen: MOCK_LANDGATE_RECORDS_BY_VEN,
    waterCorpEligibilityByCardOrProprietor: MOCK_WC_ELIGIBILITY,
    proprietorDeceasedReferences: MOCK_PROPRIETOR_DECEASED_REFERENCES,
    rateTablesByCouncil: RATE_TABLES_BY_COUNCIL,
    targetStateScope: TARGET_STATE_SCOPE,
  };
}

/**
 * Build an EvaluationContext by reading properties / owners / tenements /
 * transactions from Postgres. Each tenant scope is queried separately
 * inside {@link withTenant} so RLS-enforced reads succeed. Tenements live
 * outside RLS and are read directly.
 */
async function buildContextFromDb(): Promise<EvaluationContext> {
  const log = scoped("apps/web/clients");
  const start = Date.now();
  const { getWebDb } = await import("./db");
  const {
    eq,
    owners: ownersTable,
    properties: propertiesTable,
    propertyOwners: propertyOwnersTable,
    tenants: tenantsTable,
    tenements: tenementsTable,
    withTenant,
  } = await import("@ratesassist/db");
  const db = await getWebDb();

  const tenantRows = await db
    .select({ id: tenantsTable.id, code: tenantsTable.code })
    .from(tenantsTable);

  const propertiesAcc: Property[] = [];
  const ownersAcc: Owner[] = [];

  for (const t of tenantRows) {
    // pglite runs as superuser and ignores RLS row filters, which means a
    // bare `SELECT * FROM owners` returns rows for every tenant on every
    // iteration. Use an explicit `where(tenantId = t.id)` filter — it's a
    // no-op on real Postgres where the policy already enforces it, and it
    // keeps pglite honest in dev.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ownerRows: any[] = await withTenant(db, t.id, async (tx) => {
      return tx
        .select()
        .from(ownersTable)
        .where(eq(ownersTable.tenantId, t.id));
    });
    const ownerIdToExt = new Map<string, string>(); // pk -> ownerExtId
    for (const o of ownerRows) {
      ownerIdToExt.set(o.id, o.ownerExtId);
      const ownerExtId: string = o.ownerExtId;
      const checkedAt: Date | null = o.abnCheckedAt ?? null;
      const status: "Active" | "Cancelled" | "Suspended" | null = o.abnStatus ?? null;
      ownersAcc.push({
        ownerId: ownerExtId,
        name: o.name,
        abn: o.abn ?? null,
        abnCheck:
          checkedAt !== null && status !== null
            ? {
                kind: "checked",
                status,
                checkedAt: checkedAt.toISOString(),
              }
            : { kind: "unchecked" },
        postalAddress: o.postalAddress,
        email: o.email ?? null,
        phone: o.phone ?? null,
        ownerSince: o.ownerSince,
        previousOwners: o.previousOwners ?? [],
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propertyRows: any[] = await withTenant(db, t.id, async (tx) => {
      return tx
        .select()
        .from(propertiesTable)
        .where(eq(propertiesTable.tenantId, t.id));
    });
    const propertyIdSet = new Set<string>(propertyRows.map((p) => p.id));
    // propertyOwners has no tenant_id column; filter client-side by the
    // properties we just pulled.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allPropertyOwnerRows: any[] = await withTenant(
      db,
      t.id,
      async (tx) => {
        return tx.select().from(propertyOwnersTable);
      },
    );
    const propertyOwnerRows = allPropertyOwnerRows.filter((r) =>
      propertyIdSet.has(r.propertyId),
    );

    const ownersByPropertyId = new Map<string, string[]>();
    for (const row of propertyOwnerRows) {
      const list = ownersByPropertyId.get(row.propertyId) ?? [];
      const extId = ownerIdToExt.get(row.ownerId);
      if (extId !== undefined) list.push(extId);
      ownersByPropertyId.set(row.propertyId, list);
    }

    for (const p of propertyRows) {
      const ownerIds: string[] = ownersByPropertyId.get(p.id) ?? [];
      propertiesAcc.push({
        assessmentNumber: p.assessmentNumber,
        council: t.code,
        address: p.address,
        suburb: p.suburb,
        postcode: p.postcode,
        state: p.state,
        landUse: p.landUse,
        valuation: Number(p.valuation),
        annualRates: Number(p.annualRates),
        balance: Number(p.balance),
        lastPaymentDate: p.lastPaymentDate
          ? (p.lastPaymentDate as Date).toISOString().slice(0, 10)
          : null,
        lastPaymentAmount:
          p.lastPaymentAmount !== null && p.lastPaymentAmount !== undefined
            ? Number(p.lastPaymentAmount)
            : null,
        paymentMethod: p.paymentMethod ?? null,
        pensionerRebate: p.pensionerRebate ?? false,
        paymentArrangement: p.paymentArrangement ?? false,
        ownerIds,
        notes: p.notes ?? [],
        lat: Number(p.centroidLat),
        lng: Number(p.centroidLng),
        ...parcelFromGeoJson(p.parcel),
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenementRows: any[] = await db.select().from(tenementsTable);
  const tenementsAcc: Tenement[] = tenementRows.map((t) => ({
    tenementId: t.tenementId,
    type: t.type,
    status: t.status,
    holder: t.holder,
    holderAbn: t.holderAbn ?? null,
    commodity: t.commodity ?? [],
    grantedDate: t.grantedDate,
    expiryDate: t.expiryDate,
    areaHectares: Number(t.areaHectares),
    intersectsAssessmentNumbers: t.intersectsAssessmentNumbers ?? [],
    isProducing: t.isProducing ?? false,
    lastWorkProgramYear: t.lastWorkProgramYear ?? null,
    polygon: polygonFromGeoJson(t.polygon),
  }));

  // Build the indexes from the DB-derived arrays.
  const ownersById = new Map<string, Owner>(
    ownersAcc.map((o) => [o.ownerId, o]),
  );
  const tenementsByAssessment = new Map<string, Tenement[]>();
  for (const tenement of tenementsAcc) {
    for (const an of tenement.intersectsAssessmentNumbers) {
      const list = tenementsByAssessment.get(an);
      if (list === undefined) {
        tenementsByAssessment.set(an, [tenement]);
      } else {
        list.push(tenement);
      }
    }
  }
  const enrichedProperties = overlayVenCt(overlayValuations(propertiesAcc));
  const propertiesByOwnerId = new Map<string, Property[]>();
  const ruralBySuburb = new Map<string, Property[]>();
  for (const p of enrichedProperties) {
    for (const ownerId of p.ownerIds) {
      const bucket = propertiesByOwnerId.get(ownerId);
      if (bucket === undefined) {
        propertiesByOwnerId.set(ownerId, [p]);
      } else {
        bucket.push(p);
      }
    }
    if (p.landUse === "Rural") {
      const bucket = ruralBySuburb.get(p.suburb);
      if (bucket === undefined) {
        ruralBySuburb.set(p.suburb, [p]);
      } else {
        bucket.push(p);
      }
    }
  }

  log.info({
    msg: "eval_context.db_hydrated",
    durationMs: Date.now() - start,
    properties: enrichedProperties.length,
    owners: ownersAcc.length,
    tenements: tenementsAcc.length,
    tenants: tenantRows.length,
  });

  return {
    properties: enrichedProperties,
    ownersById,
    tenementsByAssessment,
    propertiesByOwnerId,
    ruralBySuburb,
    lagCandidatesByAssessment: MOCK_LAG_CANDIDATES_BY_ASSESSMENT,
    addressDiscrepanciesByAssessment: MOCK_ADDRESS_DISCREPANCIES_BY_ASSESSMENT,
    emitsApprovalsByTenement: MOCK_EMITS_APPROVALS_BY_TENEMENT,
    changeDetectionByAssessment: MOCK_CHANGE_DETECTION_BY_ASSESSMENT,
    landgateRecordsByVen: MOCK_LANDGATE_RECORDS_BY_VEN,
    waterCorpEligibilityByCardOrProprietor: MOCK_WC_ELIGIBILITY,
    proprietorDeceasedReferences: MOCK_PROPRIETOR_DECEASED_REFERENCES,
    rateTablesByCouncil: RATE_TABLES_BY_COUNCIL,
    targetStateScope: TARGET_STATE_SCOPE,
  };
}

/**
 * Convert a GeoJSON Polygon (as stored in `properties.parcel`) back into
 * the Leaflet-order `[lat, lng]` array the contract type uses. Returns an
 * object with a `parcel` field when present, an empty object otherwise so
 * the caller can spread it.
 */
function parcelFromGeoJson(
  geo: unknown,
): { readonly parcel?: readonly [number, number][] } {
  if (geo === null || geo === undefined || typeof geo !== "object") {
    return {};
  }
  const obj = geo as { type?: string; coordinates?: number[][][] };
  if (obj.type !== "Polygon" || !Array.isArray(obj.coordinates)) {
    return {};
  }
  const ring = obj.coordinates[0];
  if (!Array.isArray(ring)) return {};
  // GeoJSON is [lng, lat]; the contract expects [lat, lng].
  const parcel: [number, number][] = ring.map(
    ([lng, lat]) => [lat, lng] as [number, number],
  );
  return { parcel };
}

/** GeoJSON polygon → Leaflet-ordered list of [lat, lng] pairs. */
function polygonFromGeoJson(geo: unknown): readonly [number, number][] {
  if (geo === null || geo === undefined || typeof geo !== "object") {
    return [];
  }
  const obj = geo as { type?: string; coordinates?: number[][][] };
  if (obj.type !== "Polygon" || !Array.isArray(obj.coordinates)) {
    return [];
  }
  const ring = obj.coordinates[0];
  if (!Array.isArray(ring)) return [];
  return ring.map(([lng, lat]) => [lat, lng] as [number, number]);
}

const RATE_TABLES_BY_COUNCIL: ReadonlyMap<string, RateTable> = new Map(
  Object.entries(WA_RATE_TABLES),
);

/**
 * Mock property-lifecycle change-detection records. Each entry carries
 * `kind` (matching one of the six `change.*` signals), an ISO
 * `detectedAt` date for backdating math, and an optional `correctLandUse`
 * hypothesis that routes the accurate uplift calculator. Plausible WA
 * narratives across the demo assessments.
 */
const MOCK_CHANGE_DETECTION_BY_ASSESSMENT: ReadonlyMap<
  string,
  readonly ChangeDetectionEntry[]
> = new Map<string, readonly ChangeDetectionEntry[]>([
  [
    "KAL-4401-12",
    [
      {
        kind: "commercial_use_observed",
        detectedAt: "2024-02-15",
        correctLandUse: "Mining",
        reasoning:
          "Nearmap change-feed confirms continuous heavy-vehicle activity and ROM pad construction on Lot 4412 since Feb 2024; tenement M 26/0987 (producing gold) intersects. Rural rating is stale.",
      },
    ],
  ],
  [
    "ESH-1102-92",
    [
      {
        kind: "commercial_use_observed",
        detectedAt: "2023-09-01",
        correctLandUse: "Mining",
        reasoning:
          "Producing iron-ore mining lease M 47/1655 on a parcel still rated Rural since Sep 2023; backdating period exceeds practical 3y cap — statutory 5y cap applies.",
      },
    ],
  ],
  [
    "TPS-3041-12",
    [
      {
        // No `correctLandUse` — the parcel remains Residential; the recovery
        // signal here is a stale-GRV one (consolidated lots, post-renumber
        // address), not a re-classification. Route through the heuristic so
        // findMismatches keeps the candidate.
        kind: "renovation_detected",
        detectedAt: "2025-03-20",
        reasoning:
          "Landgate cadastre records post-renumber address; GRV likely stale after consolidation of lots 12 and 14 (March 2025).",
      },
    ],
  ],
  [
    "ESH-7011-08",
    [
      {
        // The fitout post-DA-2025-184 should drive a GRV revaluation rather
        // than a rate-code change (ESH's GRV Non-Residential rate-line
        // already covers commercial + industrial). Route through the
        // heuristic so the candidate surfaces; uplift then comes from the
        // pending revaluation, not the (same) rate-line.
        kind: "gru_revaluation_pending",
        detectedAt: "2024-07-08",
        reasoning:
          "DA-2025-184 occupancy certificate issued July 2024 for heavy-industrial fitout. GRV revaluation pending; ESH treats non-residential as a single line so the rate-code stays Commercial.",
      },
    ],
  ],
  [
    "KAL-7777-01",
    [
      {
        // No `correctLandUse` — the three child lots stay Commercial; the
        // upliftcomes from each child being independently rated rather than
        // bundled in the parent record. The heuristic path applies a
        // multiplier per severity tier; the strata-conversion workflow is the
        // mechanical fix.
        kind: "subdivision_detected",
        detectedAt: "2025-01-10",
        reasoning:
          "Landgate records 211, 211A, 211B Hannan St as three separately-titled child lots since Jan 2025 (SUB-2025-722). Parent still rated as one parcel. Each child should carry its own assessment for the next levy run.",
      },
    ],
  ],
  [
    "ASH-9911-04",
    [
      {
        kind: "renovation_detected",
        detectedAt: "2024-11-22",
        correctLandUse: "Industrial",
        reasoning:
          "BA-2026-019 boundary amendment in Nov 2024 added processing-plant footprint; GRV revaluation not yet flowed through.",
      },
    ],
  ],
  [
    "TPS-1102-44",
    [
      {
        kind: "commercial_use_observed",
        detectedAt: "2024-05-30",
        correctLandUse: "Industrial",
        reasoning:
          "Aerial feed confirms haul-road maintenance depot on parcel rated Rural since May 2024. Industrial reclassification overdue.",
      },
    ],
  ],
  [
    "MEK-3303-58",
    [
      {
        kind: "commercial_use_observed",
        detectedAt: "2025-02-14",
        correctLandUse: "Mining",
        reasoning:
          "Gold tailings reprocessing tied to M 51/0902 commenced Feb 2025 on parcel still rated Vacant.",
      },
    ],
  ],

  // ----- New lifecycle-demo records (residential / commercial / industrial) -----
  [
    "NEW-9001-12",
    [
      {
        kind: "subdivision_detected",
        detectedAt: "2025-08-04",
        correctLandUse: "Residential",
        reasoning:
          "Landgate registered four child lots (Lots 12A-D) carved from a vacant Karratha block in Aug 2025; council still issues a single rate notice against the parent.",
      },
      {
        kind: "construction_approved",
        detectedAt: "2025-11-10",
        reasoning:
          "DA-2025-411 approves four single-storey dwellings on the subdivided lots; pre-emptive rating-system review prevents arrears compounding.",
      },
    ],
  ],
  [
    "KAL-7000-08",
    [
      {
        kind: "commercial_use_observed",
        detectedAt: "2024-12-01",
        correctLandUse: "Commercial",
        reasoning:
          "Rural shed at Lot 7000 fitted out as a roadside retail outlet since Dec 2024 — signage, customer parking, and EFTPOS activity visible in aerial feed.",
      },
    ],
  ],
  [
    "IND-EXP-2200",
    [
      {
        kind: "construction_completed",
        detectedAt: "2025-06-18",
        correctLandUse: "Industrial",
        reasoning:
          "Factory extension completed June 2025 (occupancy certificate OC-2025-088); GRV revaluation pending.",
      },
      {
        kind: "gru_revaluation_pending",
        detectedAt: "2025-07-01",
        reasoning:
          "Valuer-General's last GRV for this parcel dates from 2022 — past the 3-year cycle for this district.",
      },
    ],
  ],
]);

/**
 * Mock cadastre-lag candidates for the demo.
 *
 * Each entry represents a parcel where a DMIRS tenement is registered but
 * the underlying Landgate title record does NOT yet list that tenement
 * number as an interest/encumbrance. The council's normal Lot-Plan lookup
 * therefore misses the mining activity and the parcel keeps being rated
 * from its old landuse code (Rural / Vacant).
 *
 * In production this map is populated by the cross-register pull in
 * scripts/lag-window-pull.ts (DMIRS × Landgate-restricted-tier). For demo
 * we hand-curate plausible entries against properties whose addresses
 * already telegraph the narrative (Tom Price Mining Road, Goldfields
 * Highway, Auski Road, etc.).
 *
 * Each reasoning string follows the shape the
 * `reg.dmirs_ahead_of_landgate` signal renders verbatim into the evidence
 * pack — tenement id, type, grant date, parcel landuse, lag days,
 * reclassification consequence.
 */
const MOCK_LAG_CANDIDATES_BY_ASSESSMENT: ReadonlyMap<
  string,
  ReadonlyArray<{ severityHint: "high" | "medium" | "low"; reasoning: string }>
> = new Map([
  [
    "TPS-1102-91",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Tenement M 47/1612 (Mining Lease — iron ore) granted 2026-03-18 (54 days ago) intersects Lot 1191 Tom Price Mining Road. Landgate title does not yet list M 47/1612 as a registered interest. Current rating: Rural. Reclassification window open.",
      },
    ],
  ],
  [
    "KAL-4401-12",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Tenement M 26/0987 (Mining Lease — gold, producing) granted 2026-04-02 (39 days ago) intersects Lot 4412 Goldfields Highway. Landgate title omits the tenement number. Current rating: Rural at $2,800/yr; Kalgoorlie-Boulder mining differential rate applies.",
      },
    ],
  ],
  [
    "ASH-9911-22",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Tenement M 47/1709 (Mining Lease — iron ore) granted 2026-02-11 (89 days ago) intersects Lot 9922 Tom Price-Karratha Road. Landgate title last refreshed 2025-12; tenement notation missing. Current rating: Rural.",
      },
    ],
  ],
  [
    "KAL-4401-77",
    [
      {
        severityHint: "medium" as const,
        reasoning:
          "Tenement G 26/0123 (General-Purpose Lease — mineral processing infrastructure) granted 2026-04-19 (22 days ago) intersects Lot 4477 Coolgardie Esplanade. Landgate title shows no interest. Current rating: Vacant.",
      },
    ],
  ],
  [
    "MEK-3303-58",
    [
      {
        severityHint: "medium" as const,
        reasoning:
          "Tenement M 51/0902 (Mining Lease — gold tailings reprocessing) granted 2026-03-30 (42 days ago) intersects Lot 358 Yulgan Road. Adjacent to gold-rush era dump. Landgate title not updated. Current rating: Vacant.",
      },
    ],
  ],
  [
    "ESH-1102-92",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Tenement M 47/1655 (Mining Lease — iron ore, producing) granted 2026-01-28 (103 days ago) intersects Lot 1192 Auski Road. Landgate title shows the parcel free of mining interests. Current rating: Rural.",
      },
    ],
  ],
]);

/**
 * Mock Landgate × rating-record address-discrepancy entries.
 *
 * Each entry mirrors the {@link AddressDiscrepancy} contract from
 * `@ratesassist/spatial`. The recovery engine consumes only
 * `severityHint` and `reasoning` so the wider shape is informational only
 * — the UI doesn't render this map directly. In production this map is
 * populated by reconciling the council's TechOne export against the
 * council-licensed Landgate restricted-tier feed (see
 * internal/LANDGATE-ACCESS.md). For demo we hand-curate plausible
 * narratives against WA-only assessments.
 */
const MOCK_ADDRESS_DISCREPANCIES_BY_ASSESSMENT: ReadonlyMap<
  string,
  ReadonlyArray<{ severityHint: "high" | "medium" | "low"; reasoning: string }>
> = new Map([
  [
    "TPS-3041-12",
    [
      {
        severityHint: "medium" as const,
        reasoning:
          "Landgate cadastre records the parcel as 14 Stadium Road, Tom Price (RPDLU 211, residential). Council rating record carries 12 Stadium Road — consistent with post-2024 street renumbering after lots 12 and 14 were consolidated. Address-of-record correction required before the next levy run.",
      },
    ],
  ],
  [
    "ESH-7011-08",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Landgate updated landuse to Industrial - heavy industry (RPDLU 511) following DA-2025-184 in Nov 2025. Council still rating Commercial. East Pilbara differential between commercial and industrial classes is ~2.4x.",
      },
    ],
  ],
  [
    "KAL-7777-01",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Landgate now records 211, 211A and 211B Hannan Street as three separately-titled child lots (SUB-2025-722, Sep 2025). Council is still rating the consolidated parent parcel. Three rateable parcels currently invoiced as one.",
      },
    ],
  ],
  [
    "ASH-9911-04",
    [
      {
        severityHint: "medium" as const,
        reasoning:
          "Landgate lot/plan revised to Lot 9914A DP 552108 after BA-2026-019 boundary amendment (Feb 2026). Council rating record still keyed to the pre-amendment lot reference — records-only discrepancy today but blocks reliable Landgate lookups for every future cross-reference.",
      },
    ],
  ],
  [
    "TPS-1102-44",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Landgate landuse code now 513 (Industrial - mining-related infrastructure) after parcel converted to a haul-road maintenance depot in 2025. Council still rating Rural at $1,820/yr. Mining differential rate applies — uplift likely 8x.",
      },
    ],
  ],
  [
    "MEK-3303-58",
    [
      {
        severityHint: "medium" as const,
        reasoning:
          "Landgate landuse now records tailings reprocessing (RPDLU 523) tied to M 51/0902 granted March 2026. Council rating still Vacant. Stacks with cadastre-lag signal on the same assessment.",
      },
    ],
  ],
  [
    "KAL-4401-12",
    [
      {
        severityHint: "high" as const,
        reasoning:
          "Landgate cadastre now references the southern portion of the parcel as 4412A after a 2025 boundary amendment registered the mining-lease footprint separately. Council rating record uses the pre-split address and rural classification. Stacks with cadastre-lag and recently-granted signals.",
      },
    ],
  ],
]);

/**
 * Mock DMIRS EMITS environmental approvals, keyed by tenement id.
 *
 * EMITS publishes no public machine-readable export today (see
 * internal/SIGNAL-environmental-approval.md). This map mirrors the seed
 * pool the adapter-demo handler ships, but rekeyed against the
 * slash-format tenement ids that the web-app's in-memory data layer
 * uses (e.g. `M70/1284`) so the recovery engine's
 * `reg.environmental_approval_active` signal compounds correctly with the
 * cadastre-lag rows for the same assessments.
 *
 * Each entry carries `active: true|false` and a verbatim `reasoning`
 * string the signal renders into the evidence pack.
 */
const MOCK_EMITS_APPROVALS_BY_TENEMENT: ReadonlyMap<
  string,
  ReadonlyArray<{ active: boolean; reasoning: string }>
> = new Map([
  [
    "M70/1284",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Mining Proposal MP-12345 (approved 2025-09-12, expires 2030-09-12) for tenement M70/1284. Scope: iron ore open-pit pre-strip and ROM pad. Active environmental approval is strong evidence of on-ground works.",
      },
    ],
  ],
  [
    "M70/1411",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Programme of Work POW-98711 (approved 2026-01-04, expires 2026-12-31) for tenement M70/1411. Scope: Year 1 iron-ore production at Tom Price.",
      },
    ],
  ],
  [
    "M70/1502",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Mine Management Plan MMP-44091 (approved 2026-02-28, expires 2031-02-28) for tenement M70/1502. Scope: iron ore haul-road, water management and rehab schedule.",
      },
    ],
  ],
  [
    "M26/0444",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Mining Proposal MP-13988 (approved 2026-01-28, expires 2031-01-28) for tenement M26/0444. Scope: gold production at Kalgoorlie-Boulder.",
      },
    ],
  ],
  [
    "M51/0144",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Programme of Work POW-71248 (approved 2026-03-30, expires 2027-03-30) for tenement M51/0144. Scope: gold tailings reprocessing at Meekatharra.",
      },
    ],
  ],
  [
    "M08/0211",
    [
      {
        active: true,
        reasoning:
          "EMITS records active Mining Proposal MP-15004 (approved 2025-11-19, expires 2030-11-19) for tenement M08/0211. Scope: mineral-sands processing at Onslow.",
      },
    ],
  ],
  [
    "G26/0119",
    [
      {
        active: false,
        reasoning:
          "EMITS records expired Programme of Work POW-30221 (approved 2021-04-12, expired 2024-04-12) for tenement G26/0119. Historical entry only — included for completeness; does not fire the signal.",
      },
    ],
  ],
]);

/**
 * Mock Landgate restricted-tier title records keyed by VEN.
 *
 * Each entry is the canonical title-state the engine compares the
 * council's view against. The narratives line up with the council-side
 * overlay in {@link VEN_CT_OVERLAY} so a deliberate mismatch fires per
 * the demo plan:
 *
 *   - TPS-3041-12 — proprietor mismatch (council JONES, Landgate SMITH)
 *   - ASH-9911-04 — CT volume/folio rolled forward after BA-2026-019
 *   - ESH-7011-08 — multi-PIN landuse divergence (3 PINs, 1 flipped to
 *     Industrial after DA-2025-184 fitout)
 *   - KAL-7777-01 — strata parent still rated; 3 child CTs on Landgate
 *
 * Every entry carries a `source: TitleSourceFreshness` so the evidence
 * pack renders an accurate provenance caveat.
 */
const MOCK_LANDGATE_RECORDS_BY_VEN: ReadonlyMap<
  string,
  {
    readonly ven: string;
    readonly ctVolume: string;
    readonly ctFolio: string;
    readonly ctIssuedDate?: string;
    readonly proprietorOnTitle: string;
    readonly proprietorPostalAddress?: string;
    readonly pins: ReadonlyArray<Pin>;
    readonly encumbrances: ReadonlyArray<Encumbrance>;
    readonly strataChildren?: ReadonlyArray<StrataChild>;
    readonly source: TitleSourceFreshness;
  }
> = new Map([
  [
    "VEN-TPS-3041-12",
    {
      ven: "VEN-TPS-3041-12",
      ctVolume: "1845",
      ctFolio: "207",
      ctIssuedDate: "2018-03-12",
      proprietorOnTitle: "SMITH, DANIEL R.",
      proprietorPostalAddress: "PO Box 821, Tom Price WA 6751",
      pins: [
        {
          pin: "8001127",
          lotPlan: "Lot 12 DP 18337",
          landuseCode: "Residential",
          areaSquareMetres: 720,
        },
      ],
      encumbrances: [],
      source: {
        source: "landgate_restricted",
        retrievedAt: "2026-05-11T01:30:00Z",
      },
    },
  ],
  [
    "VEN-ASH-9911-04",
    {
      ven: "VEN-ASH-9911-04",
      ctVolume: "2952",
      ctFolio: "108",
      ctIssuedDate: "2026-02-22",
      proprietorOnTitle: "Pilbara Minerals Processing Ltd",
      proprietorPostalAddress:
        "Level 8, 240 St Georges Terrace, Perth WA 6000",
      pins: [
        {
          pin: "9914-A",
          lotPlan: "Lot 9914A DP 552108",
          landuseCode: "Industrial",
          areaSquareMetres: 28_400,
        },
      ],
      encumbrances: [
        {
          type: "mortgage",
          reference: "K994221",
          date: "2026-02-22",
          source: "landgate_restricted",
        },
      ],
      source: {
        source: "landgate_restricted",
        retrievedAt: "2026-05-11T01:30:00Z",
      },
    },
  ],
  [
    "VEN-ESH-7011-08",
    {
      ven: "VEN-ESH-7011-08",
      ctVolume: "2901",
      ctFolio: "812",
      ctIssuedDate: "2010-07-10",
      proprietorOnTitle: "Newman Trading Co Pty Ltd",
      proprietorPostalAddress: "PO Box 401, Newman WA 6753",
      pins: [
        {
          pin: "9001247-A",
          lotPlan: "Lot 7011A DP 23145",
          landuseCode: "Commercial",
          areaSquareMetres: 4_200,
        },
        {
          pin: "9001247-B",
          lotPlan: "Lot 7011B DP 23145",
          landuseCode: "Industrial",
          areaSquareMetres: 3_100,
        },
        {
          pin: "9001247-C",
          lotPlan: "Lot 7011C DP 23145",
          landuseCode: "Commercial",
          areaSquareMetres: 2_800,
        },
      ],
      encumbrances: [],
      source: {
        source: "landgate_restricted",
        retrievedAt: "2026-05-10T03:15:00Z",
      },
    },
  ],
  [
    "VEN-KAL-7777-01",
    {
      ven: "VEN-KAL-7777-01",
      ctVolume: "2410",
      ctFolio: "199",
      ctIssuedDate: "1999-02-03",
      proprietorOnTitle: "Hannan Holdings Pty Ltd",
      proprietorPostalAddress: "Hannan Street 211, Kalgoorlie WA 6430",
      pins: [
        {
          pin: "7000211",
          lotPlan: "Lot 211 DP 18810",
          landuseCode: "Commercial",
          areaSquareMetres: 1_800,
        },
      ],
      encumbrances: [],
      strataChildren: [
        { volume: "3801", folio: "211" },
        { volume: "3801", folio: "211A" },
        { volume: "3801", folio: "211B" },
      ],
      source: {
        source: "landgate_restricted",
        retrievedAt: "2026-05-11T01:30:00Z",
      },
    },
  ],
]);

/**
 * Mock Water Corporation eligibility records keyed by masked card number.
 *
 * The recovery engine matches against either the masked card number or the
 * proprietor name (whichever the council uploaded as the WC eligibility
 * CSV's join key). The card-number lookups below align with the
 * `pensionerConcession.cardNumber` field in {@link VEN_CT_OVERLAY}.
 */
const MOCK_WC_ELIGIBILITY: ReadonlyMap<
  string,
  {
    readonly status: WaterCorpEligibilityStatus;
    readonly validFrom?: string;
    readonly validTo?: string;
    readonly cancellationReason?: string;
    readonly cancellationDate?: string;
    readonly retrievedAt: string;
  }
> = new Map([
  [
    "****-****-1188",
    {
      status: "deceased",
      validFrom: "2014-07-01",
      validTo: "2026-02-14",
      cancellationReason: "Death notified by next of kin",
      cancellationDate: "2026-02-14",
      retrievedAt: "2026-05-10T22:00:00Z",
    },
  ],
  [
    "****-****-7321",
    {
      status: "cancelled",
      validFrom: "2017-09-01",
      validTo: "2026-01-19",
      cancellationReason: "Holder downsized to another assessment",
      cancellationDate: "2026-01-19",
      retrievedAt: "2026-05-09T18:45:00Z",
    },
  ],
  [
    "****-****-9920",
    {
      status: "expired",
      validFrom: "2020-04-01",
      validTo: "2024-12-31",
      retrievedAt: "2026-05-09T18:45:00Z",
    },
  ],
]);

/**
 * Proprietor names known to be deceased. Sourced from the Water Corp feed
 * plus council probate intake. Normalised comparison (upper-case,
 * punctuation-stripped, whitespace-collapsed) is done inside the engine.
 *
 * Margaret Thompson is the holder of `TPS-3041-44` whose `pensionerConcession`
 * Water Corp status is also DECEASED — the engine fires
 * `id.pensioner_deceased_continued_rebate` once and the standalone
 * `id.proprietor_deceased` independently.
 */
const MOCK_PROPRIETOR_DECEASED_REFERENCES: ReadonlySet<string> = new Set([
  "THOMPSON, MARGARET",
]);

/**
 * Reset the memoised {@link EvaluationContext} so the next call to
 * {@link getEvaluationContext} rebuilds from the underlying data.
 *
 * Mutation handlers in `apps/web/lib/tools.ts` (e.g. `add_property_note`,
 * `update_owner_contact`, payment-arrangement bookings) MUST call this
 * function after a successful commit so subsequent recovery-engine sweeps
 * observe the new state. Without it, mutations are invisible until the
 * process restarts.
 *
 * When the DB-wired path is active ({@link isDbWired} returns true), this
 * helper also returns a Promise that resolves once the cache has been
 * re-hydrated from Postgres. Callers awaiting the promise see the new
 * state on the next sync `getEvaluationContext()` call; callers that
 * ignore the promise still get correct behaviour — the cache lazily
 * re-hydrates from the in-memory fallback on the next sync read, and
 * any later async caller sees the DB-derived snapshot.
 */
export function invalidateEvaluationContext(): Promise<void> | void {
  cachedContext = null;
  if (!isDbWired()) return;
  // Kick off an async DB refresh. Surface failures via the scoped logger so
  // a partial DB outage doesn't silently keep stale data alive.
  return (async () => {
    const log = scoped("apps/web/clients");
    try {
      cachedContext = await buildContextFromDb();
    } catch (e) {
      log.warn({
        msg: "eval_context.db_refresh.failed",
        err: e instanceof Error ? e.message : String(e),
      });
    }
  })();
}

/**
 * Persist a mutation through to the DB and refresh the cached
 * EvaluationContext. Returns a discriminated result so callers can surface
 * a real `ToolResult.ok=false` on DB failure rather than silently losing
 * the change.
 *
 * Currently supports the four scoped mutations: `add_property_note`,
 * `update_owner_contact`, `add_council`, and `import_rating_roll`. Any
 * other operation is a no-op (returns ok=true) so the caller can adopt the
 * helper incrementally without breaking existing flows.
 *
 * When {@link isDbWired} returns false the helper is also a no-op — the
 * in-memory store remains authoritative.
 */
export type PersistMutationInput =
  | {
      readonly kind: "add_property_note";
      readonly councilCode: string;
      readonly assessmentNumber: string;
      readonly note: string;
    }
  | {
      readonly kind: "update_owner_contact";
      readonly councilCode: string;
      readonly ownerExtId: string;
      readonly newPhone?: string;
      readonly newEmail?: string;
    }
  | {
      readonly kind: "add_council";
      readonly council: {
        readonly code: string;
        readonly name: string;
        readonly state:
          | "WA"
          | "NSW"
          | "VIC"
          | "QLD"
          | "SA"
          | "TAS"
          | "ACT"
          | "NT";
        readonly centerLat: number;
        readonly centerLng: number;
        readonly population: number;
        readonly rateableProperties: number;
        readonly rateRevenue: number;
      };
    };

export type PersistMutationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

export async function persistMutation(
  input: PersistMutationInput,
): Promise<PersistMutationResult> {
  if (!isDbWired()) return { ok: true };
  const log = scoped("apps/web/clients");
  try {
    const { getWebDb } = await import("./db");
    const {
      eq,
      owners: ownersTable,
      properties: propertiesTable,
      tenants: tenantsTable,
      withTenant,
    } = await import("@ratesassist/db");
    const db = await getWebDb();
    switch (input.kind) {
      case "add_council": {
        await db
          .insert(tenantsTable)
          .values({
            code: input.council.code,
            name: input.council.name,
            state: input.council.state,
            centerLat: input.council.centerLat,
            centerLng: input.council.centerLng,
            population: input.council.population,
            rateableProperties: input.council.rateableProperties,
            rateRevenue: String(input.council.rateRevenue),
          })
          .onConflictDoNothing();
        break;
      }
      case "add_property_note": {
        const tenant = (
          await db
            .select({ id: tenantsTable.id })
            .from(tenantsTable)
            .where(eq(tenantsTable.code, input.councilCode))
            .limit(1)
        )[0];
        if (tenant === undefined) {
          return {
            ok: false,
            code: "not_found",
            message: `Council ${input.councilCode} not found in DB.`,
          };
        }
        await withTenant(db, tenant.id, async (tx) => {
          const existing = (
            await tx
              .select({
                id: propertiesTable.id,
                notes: propertiesTable.notes,
              })
              .from(propertiesTable)
              .where(
                eq(
                  propertiesTable.assessmentNumber,
                  input.assessmentNumber,
                ),
              )
              .limit(1)
          )[0];
          if (existing === undefined) {
            throw Object.assign(new Error("property_not_found"), {
              code: "not_found",
            });
          }
          const nextNotes = [
            ...(Array.isArray(existing.notes) ? existing.notes : []),
            input.note,
          ];
          await tx
            .update(propertiesTable)
            .set({ notes: nextNotes })
            .where(eq(propertiesTable.id, existing.id));
        });
        break;
      }
      case "update_owner_contact": {
        const tenant = (
          await db
            .select({ id: tenantsTable.id })
            .from(tenantsTable)
            .where(eq(tenantsTable.code, input.councilCode))
            .limit(1)
        )[0];
        if (tenant === undefined) {
          return {
            ok: false,
            code: "not_found",
            message: `Council ${input.councilCode} not found in DB.`,
          };
        }
        await withTenant(db, tenant.id, async (tx) => {
          const existing = (
            await tx
              .select({ id: ownersTable.id })
              .from(ownersTable)
              .where(eq(ownersTable.ownerExtId, input.ownerExtId))
              .limit(1)
          )[0];
          if (existing === undefined) {
            throw Object.assign(new Error("owner_not_found"), {
              code: "not_found",
            });
          }
          await tx
            .update(ownersTable)
            .set({
              ...(input.newPhone !== undefined ? { phone: input.newPhone } : {}),
              ...(input.newEmail !== undefined ? { email: input.newEmail } : {}),
            })
            .where(eq(ownersTable.id, existing.id));
        });
        break;
      }
    }
    // Invalidate cache; let the caller decide whether to await the refresh.
    void invalidateEvaluationContext();
    return { ok: true };
  } catch (e) {
    const code =
      (e as { code?: string } | undefined)?.code ?? "upstream_error";
    const message = e instanceof Error ? e.message : String(e);
    log.error({
      msg: "persistMutation.failed",
      kind: input.kind,
      code,
      err: message,
    });
    return { ok: false, code, message };
  }
}

// ===== Recovery stats — legacy-shape helper =====
//
// The new `recoveryStats` from `@ratesassist/recovery-engine` returns a
// readonly aggregate keyed by `bySeverity` and `*Aud`-suffixed monetary
// fields. The web app's UI and `recovery_summary` tool currently consume the
// legacy shape (`high`, `medium`, `low`, `totalUplift`, etc.). Rather than
// touching every consumer in this refactor, we expose a thin adapter that
// produces the legacy shape from the new aggregate.
//
// The legacy shape will be retired alongside the in-process data layer in
// Phase 1B; until then, every consumer is funnelled through this helper so
// there is exactly one place to delete.

/**
 * Web-app-shaped recovery summary. Composed from the engine's
 * {@link engineRecoveryStats} output plus a couple of derived counts the UI
 * needs (per-severity totals at the top level, total recovery as a
 * convenience).
 */
export type WebRecoveryStats = {
  readonly total: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly totalUplift: number;
  readonly highUplift: number;
  readonly totalArrears: number;
  readonly totalRecovery: number;
  readonly signalCounts: Readonly<Record<string, number>>;
};

/**
 * Compute web-app-shaped recovery stats for the given (optional) council
 * filter. Calls the engine internally so callers do not need to wire up the
 * evaluation context themselves.
 */
export function recoveryStatsForWeb(councilCode?: string): WebRecoveryStats {
  const ctx = getEvaluationContext();
  const candidates: readonly MismatchCandidate[] =
    councilCode !== undefined
      ? findMismatches(ctx, { council: councilCode })
      : findMismatches(ctx);
  return webStatsFromCandidates(candidates);
}

/**
 * PERF-001: stats overload for callers that have already computed the
 * candidate set. Avoids the double `findMismatches` sweep that
 * `/api/data` was doing (once explicitly + once inside
 * `recoveryStatsForWeb`). Same legacy-shape output.
 */
export function recoveryStatsFor(
  candidates: readonly MismatchCandidate[],
): WebRecoveryStats {
  return webStatsFromCandidates(candidates);
}

function webStatsFromCandidates(
  candidates: readonly MismatchCandidate[],
): WebRecoveryStats {
  const s = engineRecoveryStats(candidates);
  return {
    total: s.total,
    high: s.bySeverity.high,
    medium: s.bySeverity.medium,
    low: s.bySeverity.low,
    totalUplift: s.totalUpliftAud,
    highUplift: s.highSeverityUpliftAud,
    totalArrears: s.totalArrears3yAud,
    totalRecovery: s.totalRecoveryAud,
    signalCounts: s.signalCounts,
  };
}
