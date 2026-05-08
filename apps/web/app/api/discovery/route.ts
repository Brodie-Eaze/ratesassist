import { NextResponse } from "next/server";
import { findMismatches } from "@ratesassist/recovery-engine";
import { COUNCILS, PROPERTIES, TENEMENTS } from "@/lib/data";
import { getEvaluationContext, recoveryStatsForWeb } from "@/lib/clients";

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
export async function GET() {
  const ctx = getEvaluationContext();
  const stats = recoveryStatsForWeb();
  const candidates = findMismatches(ctx);

  const totalParcels = PROPERTIES.length;
  const tenements = TENEMENTS.length;
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
      detail: "Weighted-additive signal engine + ML calibration head trained on prior officer verdicts.",
      signalsFiringNow: Object.values(stats.signalCounts).reduce((s, n) => s + n, 0),
      modelVersion: "v0.3-rule + v0.1-ml-calibration (synthetic)",
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
      detail: "Officer + council determinations + collected dollars flow back to the scoring model as labels. Re-trained quarterly.",
      verdictsRecorded30d: 142,
      reclassifiedPct: 0.71,
      collectionsRealised: 412_000,
    },
  ];

  // Synthetic activity feed — what an autonomous worker would log
  const now = Date.now();
  const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();
  const activity = [
    { ts: ago(2),    stage: "triage",    text: "Drafted evidence pack for KAL-4401-12 — composite 0.90, awaiting officer review" },
    { ts: ago(5),    stage: "score",     text: "Re-scored 28 candidates after Nearmap change-feed update" },
    { ts: ago(8),    stage: "intersect", text: "ST_Intersects refresh: 14,200 parcels × 21 active tenements (East Pilbara + Tom Price)" },
    { ts: ago(12),   stage: "ingest",    text: "Nearmap AI change feed: 14 new change polygons in WA goldfields region" },
    { ts: ago(18),   stage: "reconcile", text: "Divergence detected at TPS-1102-91: industry-name owner on rural rate" },
    { ts: ago(22),   stage: "ingest",    text: "DMIRS export refreshed: 21,400 live tenements across WA" },
    { ts: ago(36),   stage: "feedback",  text: "Verdict logged: Council X reclassified ESH-1102-88 to Mining (uplift $4.4k/yr collected)" },
    { ts: ago(48),   stage: "ingest",    text: "ASIC change: holder of M70/1284 director change registered" },
    { ts: ago(74),   stage: "score",     text: "Calibration head retrained on 142 new verdicts — AUC 0.89" },
    { ts: ago(90),   stage: "triage",    text: "TPS-3041-12 surfaced via portfolio-inconsistency signal" },
    { ts: ago(120),  stage: "intersect", text: "Cadastral refresh: 47 new parcels, 3 new lots in Newman" },
    { ts: ago(160),  stage: "ingest",    text: "ATO ABN status change: O-WA-002 (Karratha Exploration Pty Ltd) cancelled" },
  ];

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
    councilsLive: COUNCILS.length,
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
