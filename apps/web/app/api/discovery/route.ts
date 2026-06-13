import { NextResponse, type NextRequest } from "next/server";
import { findMismatches } from "@ratesassist/recovery-engine";
import { COUNCILS, PROPERTIES, TENEMENTS } from "@/lib/data";
import { getEvaluationContextForTenant, recoveryStatsForWeb } from "@/lib/clients";
import { fail, resolveRouteSession } from "@/lib/api-helpers";
import { getClientIp, rateLimitComposite, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Autonomous-discovery pipeline state. Synthesises the kind of metrics a
 * production scheduler would publish:
 *   - Per-stage throughput
 *   - Recent activity feed
 *   - Watchlist (parcels under continuous monitoring)
 *   - Outcome ledger (candidate → reclassified → collected)
 *
 * In production each value comes from a real worker queue + audit log table.
 */
export async function GET(req: NextRequest) {
  // Discovery surfaces per-parcel candidates, a watchlist of assessment
  // numbers + addresses, and pipeline aggregates — all cross-council in the
  // raw data. Require a session and scope everything to the caller's council
  // unless they are a platform_admin (cross-tenant ops/support).
  const session = await resolveRouteSession(req);
  if (session === null) {
    return fail("unauthorized", "Authentication required.");
  }
  const ip = getClientIp(req);
  const rl = rateLimitComposite({ scope: "discovery", ip, tenantId: session.tenantId, max: 5 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": retryAfterSeconds(rl.resetAt) } }
    );
  }
  const isAdmin = session.roles.includes("platform_admin");

  // E3: per-tenant SQL-scoped context. With per-tenant ctx the
  // `council: session.tenantId` filter in findMismatches is redundant
  // (ctx already contains only this tenant's data) but is left in
  // place for forward-compat and as an explicit safety net.
  const ctx = await getEvaluationContextForTenant(session.tenantId);
  const stats = isAdmin
    ? recoveryStatsForWeb()
    : recoveryStatsForWeb(session.tenantId);
  const candidates = isAdmin
    ? findMismatches(ctx)
    : findMismatches(ctx, { council: session.tenantId });

  const scopedProperties = isAdmin
    ? PROPERTIES
    : PROPERTIES.filter((p) => p.council === session.tenantId);
  const totalParcels = scopedProperties.length;
  const tenements = TENEMENTS.length; // statewide public DMIRS register
  const intersectionsPerHour = Math.round(totalParcels * 1.2); // synthetic — ingestion runs daily, recompute hourly
  const lastRunAt = new Date(Date.now() - 1000 * 60 * 7).toISOString();

  const stages = [
    {
      id: "ingest",
      name: "Continuous ingestion",
      sources: [
        { name: "DMIRS Mining Tenements", schedule: "daily 02:00 AWST", lastSyncedHoursAgo: 6, recordsToday: tenements },
        { name: "Landgate Cadastre", schedule: "weekly", lastSyncedHoursAgo: 36, recordsToday: 0 },
        { name: "Nearmap AI change feed", schedule: "every 15 min", lastSyncedHoursAgo: 0.25, recordsToday: 14 },
        { name: "ASIC company / director changes", schedule: "every 30 min", lastSyncedHoursAgo: 0.5, recordsToday: 4 },
        { name: "ATO ABN status feed", schedule: "every 6h", lastSyncedHoursAgo: 1, recordsToday: 1 },
        { name: "TechOne supplementary valuations", schedule: "nightly", lastSyncedHoursAgo: 8, recordsToday: 32 },
      ],
    },
    {
      id: "intersect",
      name: "Spatial intersection",
      detail: "PostGIS ST_Intersects: every parcel × every active tenement, every Nearmap change polygon, every zoning overlay.",
      throughput: intersectionsPerHour,
      computedNow: totalParcels * (tenements + 3),
    },
    {
      id: "reconcile",
      name: "Reconciliation vs rating record",
      detail: "Compare what authoritative external data says about the parcel vs. how it's currently rated in TechOne.",
      divergencesFound: candidates.length,
      candidatesOpened: candidates.length,
    },
    {
      id: "score",
      name: "Composite signal scoring",
      detail: "Weighted-additive signal engine with hand-set, fully-auditable priors. An outcome-calibrated ML head is on the roadmap once labelled verdicts accumulate (Phase 8) — not yet trained.",
      signalsFiringNow: Object.values(stats.signalCounts).reduce((s, n) => s + n, 0),
      modelVersion: "v0.3-rule (hand-set priors) · ML head: roadmap",
    },
    {
      id: "triage",
      name: "AI-assisted triage",
      detail: "LLM agent investigates each high-confidence candidate: pulls news mentions, ASIC director changes, aerial-imagery diff, drafts evidence pack. Output is presented for officer review — never auto-actioned.",
      packsDraftedToday: stats.high,
      readyForReview: stats.high,
    },
    {
      id: "feedback",
      name: "Outcome feedback loop",
      detail: "Designed so officer + council determinations + collected dollars flow back as labels to calibrate the scoring model (roadmap — activates once a pilot accumulates labelled outcomes).",
      verdictsRecorded30d: 142,
      reclassifiedPct: 0.71,
      collectionsRealised: 412_000,
    },
  ];

  // Synthetic activity feed — what an autonomous worker would log. Each
  // entry is tagged with the council it pertains to; `council: undefined`
  // marks a statewide data-source / infrastructure event (DMIRS, Nearmap,
  // ASIC, ATO, cadastral refresh) that carries no council-specific PII.
  // Non-admin sessions only ever see their own council's entries plus the
  // statewide ones — an officer must not see another council's assessment
  // numbers or recovery narratives.
  const now = Date.now();
  const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();
  const activityAll: ReadonlyArray<{
    readonly ts: string;
    readonly stage: string;
    readonly council?: string;
    readonly text: string;
  }> = [
    { ts: ago(2),    stage: "triage",    council: "KAL", text: "Drafted evidence pack for KAL-4401-12 — composite 0.90, awaiting officer review" },
    { ts: ago(5),    stage: "score",     text: "Re-scored 28 candidates after Nearmap change-feed update" },
    { ts: ago(8),    stage: "intersect", text: "ST_Intersects refresh: 14,200 parcels × 21 active tenements (East Pilbara + Tom Price)" },
    { ts: ago(12),   stage: "ingest",    text: "Nearmap AI change feed: 14 new change polygons in WA goldfields region" },
    { ts: ago(18),   stage: "reconcile", council: "TPS", text: "Divergence detected at TPS-1102-91: industry-name owner on rural rate" },
    { ts: ago(22),   stage: "ingest",    text: "DMIRS export refreshed: 21,400 live tenements across WA" },
    { ts: ago(36),   stage: "feedback",  council: "ESH", text: "Verdict logged: Council X reclassified ESH-1102-88 to Mining (uplift $4.4k/yr collected)" },
    { ts: ago(48),   stage: "ingest",    text: "ASIC change: holder of M70/1284 director change registered" },
    { ts: ago(74),   stage: "score",     text: "Signal priors reviewed against 142 sample verdicts (illustrative — outcome calibration is roadmap)" },
    { ts: ago(90),   stage: "triage",    council: "TPS", text: "TPS-3041-12 surfaced via portfolio-inconsistency signal" },
    { ts: ago(120),  stage: "intersect", text: "Cadastral refresh: 47 new parcels, 3 new lots in Newman" },
    { ts: ago(160),  stage: "ingest",    text: "ATO ABN status change: O-WA-002 (Karratha Exploration Pty Ltd) cancelled" },
  ];
  const activity = isAdmin
    ? activityAll
    : activityAll.filter(
        (a) => a.council === undefined || a.council === session.tenantId,
      );

  // Watchlist — parcels the system is actively monitoring (top 10 highest score)
  const watchlist = candidates.slice(0, 10).map((c, i) => ({
    rank: i + 1,
    assessment: c.assessmentNumber,
    address: `${c.property.address}, ${c.property.suburb}`,
    council: c.property.council,
    composite: c.compositeScore,
    severity: c.severity,
    estUplift: c.estUplift,
    signalCount: c.signals.length,
    lastReevaluated: ago(Math.floor(Math.random() * 60)),
    nextScheduledScan: ago(-Math.floor(Math.random() * 24 * 60)),
  }));

  // Discovery throughput rolling stats
  const summary = {
    parcelsUnderContinuousMonitoring: totalParcels,
    councilsLive: isAdmin ? COUNCILS.length : 1,
    candidatesOpenNow: candidates.length,
    candidatesAwaitingReview: stats.high,
    estUpliftPipeline: stats.totalUplift,
    estCollectionsPipeline: stats.totalRecovery,
    lastFullSweepAt: lastRunAt,
    nextScheduledSweep: new Date(Date.now() + 1000 * 60 * 53).toISOString(),
    avgTimeToCandidateSec: 47,
    aiVerdictsPerDay: 1_240,
    falsePositiveRate: 0.18,
  };

  return NextResponse.json({ stages, activity, watchlist, summary });
}
