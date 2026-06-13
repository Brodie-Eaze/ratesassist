"use client";

import { useState, useEffect, useMemo, useRef, Suspense } from "react";
// Round 4B: dashboard now reads from /api/recovery/candidates (slim
// envelope — candidates + stats only) instead of /api/data which also
// shipped properties/owners/tenements arrays.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { LiveGrantsWidget } from "@/components/LiveGrantsWidget";
import { formatAud } from "@/lib/utils";
import { useFetch, LoadingState, ErrorState } from "@/lib/useFetch";
import type { MismatchCandidate, SignalCategory, SignalHit } from "@/lib/types";
import {
  TrendingUp,
  AlertTriangle,
  FileText,
  ArrowUpRight,
  Sparkles,
  Activity,
  Building2,
  Layers,
  Database,
  Eye,
  GanttChart,
  BellRing,
  ClipboardList,
  Home,
  Scale,
  Filter,
  ChevronDown,
  Check,
} from "lucide-react";

const RECENTLY_GRANTED_SIGNAL_ID = "reg.tenement.recently_granted";
const CADASTRE_LAG_SIGNAL_ID = "reg.dmirs_ahead_of_landgate";
const ADDRESS_MISMATCH_SIGNAL_ID = "reg.address_mismatch_landgate";

/**
 * Title-mismatch family — any signal that diverges the council's title-state
 * from Landgate's canonical record (proprietor, CT number, encumbrance, PINs).
 * The "Title mismatch" pill filters candidates with ANY of these firing.
 */
const TITLE_MISMATCH_SIGNAL_IDS: ReadonlySet<string> = new Set([
  "mismatch.proprietor",
  "mismatch.ct_number_changed",
  "mismatch.encumbrance_added",
  "mismatch.pin_landuse_diverges",
  "mismatch.pin_missing_from_record",
]);

/**
 * Concession-review family — every `id.pensioner_*` signal. The "Concession
 * review" pill filters candidates with ANY of these firing.
 */
const CONCESSION_REVIEW_SIGNAL_IDS: ReadonlySet<string> = new Set([
  "id.pensioner_deceased_continued_rebate",
  "id.pensioner_eligibility_cancelled",
  "id.pensioner_card_expired",
  "id.pensioner_not_at_property",
]);

/**
 * Strata-conversion family — the single canonical signal that drives the
 * strata-conversion workflow. Rows under this pill expose a "Convert →"
 * button linking to `/strata/<assessment>`.
 */
const STRATA_CONVERSION_SIGNAL_ID = "mismatch.strata_parent_still_rated";

/**
 * Discriminated set of recovery-type filter values. Kept at module scope so
 * the dropdown options and the filtered-cascade switch share one source of
 * truth.
 */
type RecoveryTypeValue =
  | "recently_granted"
  | "cadastre_lag"
  | "address_mismatch"
  | "title_mismatch"
  | "concession_review"
  | "strata_conversion";

/**
 * Dropdown option metadata for the Recovery-type filter. Ordering here is
 * the order users see in the menu — register-level signals first (high
 * recovery confidence), then identity/concession (more nuanced), then the
 * strata workflow (separate page).
 */
const RECOVERY_TYPE_OPTIONS: ReadonlyArray<{
  readonly value: RecoveryTypeValue;
  readonly label: string;
  readonly icon: typeof Activity;
  readonly description: string;
}> = [
  {
    value: "recently_granted",
    label: "Newly granted",
    icon: BellRing,
    description:
      "Candidates with a tenement granted within the last 90 days (DMIRS MINEDEX).",
  },
  {
    value: "cadastre_lag",
    label: "Cadastre lag",
    icon: Sparkles,
    description:
      "DMIRS has granted a tenement but Landgate landuse hasn't caught up — the highest-confidence recovery window.",
  },
  {
    value: "address_mismatch",
    label: "Address mismatch",
    icon: FileText,
    description:
      "Landgate's address, lot/plan or landuse code differs from the council's rating record.",
  },
  {
    value: "title_mismatch",
    label: "Title mismatch",
    icon: ClipboardList,
    description:
      "Proprietor, CT number, encumbrance or per-PIN mismatch against Landgate's canonical title record.",
  },
  {
    value: "concession_review",
    label: "Concession review",
    icon: Home,
    description:
      "Pensioner concession diverges from Water Corp eligibility (deceased / cancelled / expired card / postal-vs-property mismatch).",
  },
  {
    value: "strata_conversion",
    label: "Strata conversion",
    icon: Scale,
    description:
      "Parent assessments where Landgate records strata children but council is still rating the parent. Each row exposes a Convert workflow.",
  },
];

/**
 * Read the matching per-type count out of the in-page memoised counters.
 * Splitting the lookup out of the JSX keeps the dropdown markup tight and
 * lets the dropdown option count, the trigger badge, and the strata
 * detection share one path.
 */
function recoveryTypeCount(
  value: RecoveryTypeValue,
  counts: {
    readonly recentlyGrantedCount: number;
    readonly cadastreLagCount: number;
    readonly addressMismatchCount: number;
    readonly titleMismatchCount: number;
    readonly concessionReviewCount: number;
    readonly strataConversionCount: number;
  },
): number {
  switch (value) {
    case "recently_granted":
      return counts.recentlyGrantedCount;
    case "cadastre_lag":
      return counts.cadastreLagCount;
    case "address_mismatch":
      return counts.addressMismatchCount;
    case "title_mismatch":
      return counts.titleMismatchCount;
    case "concession_review":
      return counts.concessionReviewCount;
    case "strata_conversion":
      return counts.strataConversionCount;
  }
}

type OvertaxedStats = {
  count: number;
  annualOvercharge: number;
  refundExposure3y: number;
};

type DataResponse = {
  mismatches: MismatchCandidate[];
  stats: {
    total: number;
    high: number;
    medium: number;
    low: number;
    totalUplift: number;
    totalArrears: number;
    totalRecovery: number;
    highUplift: number;
    signalCounts: Record<string, number>;
  };
  overtaxed: MismatchCandidate[];
  overtaxedStats: OvertaxedStats;
};

const SEVERITY_BADGE = {
  high: "bg-critical-50 text-critical-700",
  medium: "bg-warn-50 text-warn-700",
  low: "bg-ink-100 text-ink-700",
};

const CATEGORY_META: Record<
  SignalCategory,
  { icon: typeof Activity; cls: string; label: string }
> = {
  register:    { icon: Database,    cls: "bg-accent-50 text-accent-700",   label: "Register" },
  aerial:      { icon: Eye,         cls: "bg-warn-50 text-warn-700",       label: "Aerial" },
  identity:    { icon: Building2,   cls: "bg-success-50 text-success-700", label: "Identity" },
  spatial:     { icon: Layers,      cls: "bg-ink-100 text-ink-700",        label: "Spatial" },
  behavioural: { icon: GanttChart,  cls: "bg-ink-100 text-ink-700",        label: "Behavioural" },
  corporate:   { icon: Building2,   cls: "bg-success-50 text-success-700", label: "Corporate" },
};

export default function RecoveryPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RecoveryPageInner />
    </Suspense>
  );
}

type CandidatesEnvelope = {
  ok: boolean;
  data: {
    candidates: MismatchCandidate[];
    stats: DataResponse["stats"];
    overtaxedCandidates?: MismatchCandidate[];
    overtaxedStats?: OvertaxedStats;
  };
  pagination?: { total: number; limit: number; offset: number };
};

const EMPTY_OVERTAXED_STATS: OvertaxedStats = {
  count: 0,
  annualOvercharge: 0,
  refundExposure3y: 0,
};

type Fetched =
  | { status: "loading"; data: null; error: null }
  | { status: "ok"; data: DataResponse; error: null }
  | { status: "error"; data: null; error: string };

function RecoveryPageInner() {
  const envState = useFetch<CandidatesEnvelope>("/api/recovery/candidates");
  // Adapt the new envelope back to the legacy DataResponse shape that the
  // rest of this component already consumes. The page-internal contract is
  // unchanged.
  const fetchState: Fetched =
    envState.status === "ok"
      ? {
          status: "ok",
          data: {
            mismatches: envState.data.data.candidates,
            stats: envState.data.data.stats,
            overtaxed: envState.data.data.overtaxedCandidates ?? [],
            overtaxedStats:
              envState.data.data.overtaxedStats ?? EMPTY_OVERTAXED_STATS,
          },
          error: null,
        }
      : envState.status === "error"
        ? { status: "error", data: null, error: envState.error }
        : { status: "loading", data: null, error: null };
  /**
   * Single recovery-type filter replaces the 6 boolean toggle pills the page
   * used to show (Newly granted, Cadastre lag, Address mismatch, Title
   * mismatch, Concession review, Strata conversion). One dropdown carries
   * the same intent without crowding the filter row. The legacy
   * `?signal=<family>` deep-link from /alerts and older bookmarks is
   * still DECODED on mount (so old links keep working), but the URL is
   * normalised to the canonical `?recoveryType=` form on first render —
   * the legacy param shape is read-compatible, not write-preserved.
   */
  const searchParams = useSearchParams();
  const router = useRouter();
  // Filter state is initialised from the URL ONCE at mount, then written
  // back to the URL on every change (router.replace, no history spam).
  // This makes Back from /recovery/[assessment] land on the SAME filtered
  // view (a 40-candidate triage session no longer resets 39 times), and
  // makes every filtered view bookmarkable/shareable — a manager can send
  // `?recoveryType=cadastre_lag&severity=high` and the clerk lands in
  // exactly the right queue. Mount-only initialisation (not a
  // useEffect([searchParams])) so the user's dropdown click stays sticky.
  const initialSeverity: "all" | "high" | "medium" | "low" = (() => {
    const sev = searchParams?.get("severity");
    return sev === "high" || sev === "medium" || sev === "low" ? sev : "all";
  })();
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">(
    initialSeverity,
  );
  const [signalFilter, setSignalFilter] = useState<string | "all">(
    searchParams?.get("signalId") ?? "all",
  );
  const initialRecoveryType: "all" | RecoveryTypeValue = (() => {
    // `?recoveryType=` is the canonical param; `?signal=` is the legacy
    // deep-link from /alerts and older bookmarks.
    const sig =
      searchParams?.get("recoveryType") ?? searchParams?.get("signal");
    if (
      sig === "recently_granted" ||
      sig === "cadastre_lag" ||
      sig === "address_mismatch" ||
      sig === "title_mismatch" ||
      sig === "concession_review" ||
      sig === "strata_conversion"
    ) {
      return sig;
    }
    return "all";
  })();
  const [recoveryType, setRecoveryType] = useState<"all" | RecoveryTypeValue>(
    initialRecoveryType,
  );

  // Write filter state back to the URL. replace (not push) so each filter
  // click doesn't pollute history; scroll: false so the page doesn't jump.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("severity", filter);
    if (recoveryType !== "all") params.set("recoveryType", recoveryType);
    if (signalFilter !== "all") params.set("signalId", signalFilter);
    const qs = params.toString();
    router.replace(qs ? `/recovery?${qs}` : "/recovery", { scroll: false });
  }, [filter, recoveryType, signalFilter, router]);
  const [recoveryDropdownOpen, setRecoveryDropdownOpen] = useState<boolean>(false);
  const [signalDropdownOpen, setSignalDropdownOpen] = useState<boolean>(false);
  const recoveryDropdownRef = useRef<HTMLDivElement | null>(null);
  const signalDropdownRef = useRef<HTMLDivElement | null>(null);

  // Close the recovery-type dropdown on outside click.
  useEffect(() => {
    if (!recoveryDropdownOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        recoveryDropdownRef.current &&
        !recoveryDropdownRef.current.contains(e.target as Node)
      ) {
        setRecoveryDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [recoveryDropdownOpen]);

  // Close the signal-filter dropdown on outside click.
  useEffect(() => {
    if (!signalDropdownOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        signalDropdownRef.current &&
        !signalDropdownRef.current.contains(e.target as Node)
      ) {
        setSignalDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [signalDropdownOpen]);

  // PERF-009: per-signal sample lookup, computed once per data change.
  // Previously every render iterated `data.stats.signalCounts` and called
  // `data.mismatches.find(...)` for every entry — O(signals * mismatches)
  // each render.
  const signalSamples = useMemo(() => {
    const map = new Map<string, SignalHit>();
    if (fetchState.status !== "ok") return map;
    for (const m of fetchState.data.mismatches) {
      for (const s of m.signals) {
        if (!map.has(s.id)) map.set(s.id, s);
      }
    }
    return map;
  }, [fetchState]);

  // PERF-008: count of recently-granted candidates is derived data; cache
  // it instead of re-filtering every render.
  const recentlyGrantedCount = useMemo(() => {
    if (fetchState.status !== "ok") return 0;
    let n = 0;
    for (const m of fetchState.data.mismatches) {
      if (m.signals.some((s) => s.id === RECENTLY_GRANTED_SIGNAL_ID)) n++;
    }
    return n;
  }, [fetchState]);

  const cadastreLagCount = useMemo(() => {
    if (fetchState.status !== "ok") return 0;
    let n = 0;
    for (const m of fetchState.data.mismatches) {
      if (m.signals.some((s) => s.id === CADASTRE_LAG_SIGNAL_ID)) n++;
    }
    return n;
  }, [fetchState]);

  const addressMismatchCount = useMemo(() => {
    if (fetchState.status !== "ok") return 0;
    let n = 0;
    for (const m of fetchState.data.mismatches) {
      if (m.signals.some((s) => s.id === ADDRESS_MISMATCH_SIGNAL_ID)) n++;
    }
    return n;
  }, [fetchState]);

  const titleMismatchCount = useMemo(() => {
    if (fetchState.status !== "ok") return 0;
    let n = 0;
    for (const m of fetchState.data.mismatches) {
      if (m.signals.some((s) => TITLE_MISMATCH_SIGNAL_IDS.has(s.id))) n++;
    }
    return n;
  }, [fetchState]);

  const concessionReviewCount = useMemo(() => {
    if (fetchState.status !== "ok") return 0;
    let n = 0;
    for (const m of fetchState.data.mismatches) {
      if (m.signals.some((s) => CONCESSION_REVIEW_SIGNAL_IDS.has(s.id))) n++;
    }
    return n;
  }, [fetchState]);

  const strataConversionCount = useMemo(() => {
    if (fetchState.status !== "ok") return 0;
    let n = 0;
    for (const m of fetchState.data.mismatches) {
      if (m.signals.some((s) => s.id === STRATA_CONVERSION_SIGNAL_ID)) n++;
    }
    return n;
  }, [fetchState]);

  if (fetchState.status === "loading") return <LoadingState />;
  if (fetchState.status === "error") return <ErrorState message={fetchState.error} />;
  const data = fetchState.data;

  let filtered = data.mismatches;
  if (filter !== "all") filtered = filtered.filter((m) => m.severity === filter);
  if (signalFilter !== "all")
    filtered = filtered.filter((m) => m.signals.some((s) => s.id === signalFilter));
  // Single switch on the new recovery-type enum replaces the previous
  // 6-boolean fan-out. The behaviour is identical (each branch maps to one
  // of the old `*Only` filters); only the call-site shape collapsed.
  switch (recoveryType) {
    case "recently_granted":
      filtered = filtered.filter((m) =>
        m.signals.some((s) => s.id === RECENTLY_GRANTED_SIGNAL_ID),
      );
      break;
    case "cadastre_lag":
      filtered = filtered.filter((m) =>
        m.signals.some((s) => s.id === CADASTRE_LAG_SIGNAL_ID),
      );
      break;
    case "address_mismatch":
      filtered = filtered.filter((m) =>
        m.signals.some((s) => s.id === ADDRESS_MISMATCH_SIGNAL_ID),
      );
      break;
    case "title_mismatch":
      filtered = filtered.filter((m) =>
        m.signals.some((s) => TITLE_MISMATCH_SIGNAL_IDS.has(s.id)),
      );
      break;
    case "concession_review":
      filtered = filtered.filter((m) =>
        m.signals.some((s) => CONCESSION_REVIEW_SIGNAL_IDS.has(s.id)),
      );
      break;
    case "strata_conversion":
      filtered = filtered.filter((m) =>
        m.signals.some((s) => s.id === STRATA_CONVERSION_SIGNAL_ID),
      );
      break;
    case "all":
    default:
      // No additional filtering.
      break;
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-ink-900">Recovery Audit</h1>
            <span className="badge bg-accent-100 text-accent-700">RatesRecovery</span>
            <span className="badge bg-ink-100 text-ink-700">
              <Sparkles className="w-3 h-3 mr-1 inline" />
              Multi-signal detection
            </span>
          </div>
          <div className="text-sm text-ink-500">
            Cross-references against DMIRS, ABN/ASIC, portfolio + spatial signals · Composite scoring with auditable trail
          </div>
          <div className="text-xs text-ink-400 mt-1">
            Scope: Western Australia (LGA-1995). Inter-state expansion in roadmap.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-ink-50">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            <Stat
              icon={<AlertTriangle className="w-5 h-5 text-critical-500" />}
              label="High-severity candidates"
              value={data.stats.high.toString()}
              sub={`of ${data.stats.total} total`}
            />
            <Stat
              icon={<TrendingUp className="w-5 h-5 text-success-500" />}
              label="Est. annual uplift"
              value={formatAud(data.stats.totalUplift)}
              sub={`${formatAud(data.stats.highUplift)} high-conf only`}
            />
            <Stat
              icon={<FileText className="w-5 h-5 text-accent-500" />}
              label="Est. arrears (3y)"
              value={formatAud(data.stats.totalArrears)}
              sub="Within statutory backdating limit"
            />
            <Stat
              icon={<TrendingUp className="w-5 h-5 text-accent-500" />}
              label="Total recovery opportunity"
              value={formatAud(data.stats.totalRecovery)}
              sub="Annual uplift + arrears"
              highlight
            />
          </div>

          {/* Pinned live DMIRS feed — proves the upstream connection is
              real even when downstream candidates run over demo fixtures. */}
          <LiveGrantsWidget />

          {/*
            Signal contribution rollup — single-line dropdown.

            History: the page used to render a wall of ~20 chips (one per
            signal id) across multiple wrap-rows. Clerks called the result
            "extremely disorganised". Even hiding the grid behind a toggle
            still exposed a chip wall once expanded.

            The compact form: card header carries the title, the active
            filter (if any), a reset, and a single trigger "Filter by
            signal: All signals ▾". Selecting an option from the dropdown
            applies a signal-id filter to the candidate list below — same
            behaviour, one button instead of 20.

            The dropdown itself is scrollable so the full catalogue is
            still reachable in-page (top 20+ signals, sorted by fire
            count). "Signal catalogue →" link stays for the full reference
            grid on /signals.
          */}
          <div className="card p-5" ref={signalDropdownRef}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium text-ink-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-accent-500" />
                  Detection-signal contribution
                  {signalFilter !== "all" && (
                    <span className="badge bg-accent-100 text-accent-700 text-[10px]">
                      filtered
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-500">
                  Pick a single signal to drill the candidate list, or browse the catalogue.
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href="/signals"
                  className="text-xs text-accent-700 hover:underline"
                >
                  Signal catalogue →
                </Link>
                {signalFilter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setSignalFilter("all")}
                    data-testid="signal-filter-clear"
                    className="text-xs text-ink-500 hover:text-ink-700 hover:underline"
                  >
                    Clear
                  </button>
                )}
                <div className="relative" data-testid="signal-filter-dropdown">
                  <button
                    type="button"
                    onClick={() => setSignalDropdownOpen((v) => !v)}
                    aria-haspopup="listbox"
                    aria-expanded={signalDropdownOpen}
                    aria-controls="signal-filter-listbox"
                    data-testid="signal-filter-trigger"
                    className={`btn ${
                      signalFilter === "all"
                        ? "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                        : "bg-accent-600 text-white hover:bg-accent-700"
                    }`}
                    title="Drill the candidate list by a single detection signal."
                  >
                    <Filter className="w-3 h-3" />
                    {signalFilter === "all"
                      ? "Filter by signal"
                      : signalSamples.get(signalFilter)?.short ?? "Filter by signal"}
                    <span className="text-[10px] opacity-70 ml-1">
                      {/* Candidates, not signal firings — summing firings
                          double-counts every candidate with >1 signal. */}
                      {signalFilter === "all"
                        ? data.mismatches.length
                        : data.stats.signalCounts[signalFilter] ?? 0}
                    </span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {signalDropdownOpen && (
                    <div
                      id="signal-filter-listbox"
                      role="listbox"
                      aria-label="Filter by detection signal"
                      data-testid="signal-filter-options"
                      className="absolute right-0 top-full mt-1 z-30 w-80 max-h-96 overflow-y-auto bg-white border border-ink-200 rounded-md shadow-lg"
                    >
                      <button
                        role="option"
                        type="button"
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus
                        onClick={() => {
                          setSignalFilter("all");
                          setSignalDropdownOpen(false);
                        }}
                        aria-selected={signalFilter === "all"}
                        data-testid="signal-filter-option-all"
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-ink-50 ${
                          signalFilter === "all"
                            ? "bg-accent-50 text-accent-700"
                            : "text-ink-700"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          {signalFilter === "all" ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <span className="w-3 h-3 inline-block" />
                          )}
                          All signals
                        </span>
                        <span className="text-[10px] text-ink-500">
                          {data.mismatches.length}
                        </span>
                      </button>
                      <div className="border-t border-ink-100" />
                      {Object.entries(data.stats.signalCounts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([id, count]) => {
                          const sig = signalSamples.get(id);
                          if (!sig) return null;
                          const meta = CATEGORY_META[sig.category];
                          const Icon = meta.icon;
                          const active = signalFilter === id;
                          return (
                            <button
                              key={id}
                              role="option"
                              type="button"
                              onClick={() => {
                                setSignalFilter(id);
                                setSignalDropdownOpen(false);
                              }}
                              aria-selected={active}
                              data-testid={`signal-filter-option-${id}`}
                              title={sig.evidence ?? sig.short}
                              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-ink-50 ${
                                active
                                  ? "bg-accent-50 text-accent-700"
                                  : "text-ink-700"
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                {active ? (
                                  <Check className="w-3 h-3 shrink-0" />
                                ) : (
                                  <Icon className="w-3 h-3 shrink-0 text-ink-400" />
                                )}
                                <span className="truncate">{sig.short}</span>
                                <span className="text-[10px] text-ink-400 shrink-0">
                                  · {meta.label}
                                </span>
                              </span>
                              <span className="text-[10px] text-ink-500 shrink-0">
                                {count}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/*
            Severity row + Recovery-type dropdown.

            Before: the page rendered TWO wrap-rows totalling 6 boolean
            pills (Newly granted, Cadastre lag, Address mismatch, Title
            mismatch, Concession review, Strata conversion) on top of the
            severity row. Clerks reported the page felt "overwhelming" on
            first load.

            After: severity stays as inline pills (4 buttons, low risk
            of crowding), and the 6 recovery-type filters fold into one
            dropdown. Only one recovery-type can be active at a time —
            this matches how clerks actually triaged ("show me the
            strata-conversion queue" is mutually exclusive with "show me
            the cadastre-lag queue"). The dropdown also exposes the same
            counts as the old pills via badges on each option.
          */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-500">Severity:</span>
            {(["all", "high", "medium", "low"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`btn ${
                  filter === f
                    ? "bg-ink-900 text-white"
                    : "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                }`}
              >
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                <span className="text-[10px] opacity-70 ml-1">
                  {f === "all"
                    ? data.stats.total
                    : data.stats[f as "high" | "medium" | "low"]}
                </span>
              </button>
            ))}
            <span className="text-xs text-ink-400 ml-3">
              Showing {filtered.length} of {data.mismatches.length}
            </span>
            <div
              className="ml-auto relative"
              ref={recoveryDropdownRef}
              data-testid="recovery-type-dropdown"
            >
              <button
                type="button"
                onClick={() => setRecoveryDropdownOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={recoveryDropdownOpen}
                aria-controls="recovery-type-listbox"
                data-testid="recovery-type-trigger"
                className={`btn ${
                  recoveryType === "all"
                    ? "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                    : "bg-accent-600 text-white hover:bg-accent-700"
                }`}
                title="Narrow the candidate list to a single recovery workflow (Cadastre lag, Strata conversion, etc.)"
              >
                <Filter className="w-3 h-3" />
                {recoveryType === "all"
                  ? "Recovery type"
                  : RECOVERY_TYPE_OPTIONS.find((o) => o.value === recoveryType)
                      ?.label ?? "Recovery type"}
                {recoveryType !== "all" && (
                  <span className="text-[10px] opacity-80 ml-1">
                    {recoveryTypeCount(recoveryType, {
                      recentlyGrantedCount,
                      cadastreLagCount,
                      addressMismatchCount,
                      titleMismatchCount,
                      concessionReviewCount,
                      strataConversionCount,
                    })}
                  </span>
                )}
                <ChevronDown className="w-3 h-3" />
              </button>
              {recoveryDropdownOpen && (
                <div
                  id="recovery-type-listbox"
                  role="listbox"
                  aria-label="Recovery type filter"
                  data-testid="recovery-type-options"
                  className="absolute right-0 top-full mt-1 z-30 w-72 bg-white border border-ink-200 rounded-md shadow-lg overflow-hidden"
                >
                  <button
                    role="option"
                    type="button"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    onClick={() => {
                      setRecoveryType("all");
                      setRecoveryDropdownOpen(false);
                    }}
                    aria-selected={recoveryType === "all"}
                    data-testid="recovery-type-option-all"
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-ink-50 ${
                      recoveryType === "all" ? "bg-accent-50 text-accent-700" : "text-ink-700"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {recoveryType === "all" ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <span className="w-3 h-3 inline-block" />
                      )}
                      All recovery types
                    </span>
                    <span className="text-[10px] text-ink-500">{data.stats.total}</span>
                  </button>
                  <div className="border-t border-ink-100" />
                  {RECOVERY_TYPE_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const count = recoveryTypeCount(opt.value, {
                      recentlyGrantedCount,
                      cadastreLagCount,
                      addressMismatchCount,
                      titleMismatchCount,
                      concessionReviewCount,
                      strataConversionCount,
                    });
                    const active = recoveryType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        role="option"
                        type="button"
                        onClick={() => {
                          setRecoveryType(opt.value);
                          setRecoveryDropdownOpen(false);
                        }}
                        aria-selected={active}
                        data-testid={`recovery-type-option-${opt.value}`}
                        title={opt.description}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover:bg-ink-50 ${
                          active ? "bg-accent-50 text-accent-700" : "text-ink-700"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          {active ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <Icon className="w-3 h-3 text-ink-400" />
                          )}
                          {opt.label}
                        </span>
                        <span className="text-[10px] text-ink-500">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Candidates */}
          <div className="space-y-3">
            {filtered.map((c, i) => (
              <CandidateCard
                key={c.assessmentNumber}
                candidate={c}
                rank={i + 1}
              />
            ))}
            {filtered.length === 0 && (
              <div className="text-center text-ink-500 text-sm py-12">
                No candidates match the current filter.
              </div>
            )}
          </div>

          {/* Over-rated properties — "review & refund" governance surface.
              Distinct from the amber/red recovery list: muted accent-blue,
              framed as a council LIABILITY (money the council may owe back),
              not an opportunity. Only renders when the engine found any. */}
          {data.overtaxedStats.count > 0 && (
            <OvertaxedSection
              overtaxed={data.overtaxed}
              stats={data.overtaxedStats}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`card p-4 ${highlight ? "border-accent-400 bg-accent-50/40" : ""}`}
    >
      <div className="flex items-center justify-between">
        <div className="label">{label}</div>
        {icon}
      </div>
      <div className="text-2xl font-semibold text-ink-900 mt-1">{value}</div>
      <div className="text-xs text-ink-500 mt-1">{sub}</div>
    </div>
  );
}

/**
 * Over-rated ("review & refund") section. The recovery list is money the
 * council can RECOVER (amber/red urgency); this is the inverse — properties
 * the engine believes are being OVER-rated, i.e. money the council may OWE.
 * Treated in muted accent-blue (a governance/integrity tone, not an alarm),
 * framed honestly as exposure to be reviewed, never as guaranteed liability.
 */
function OvertaxedSection({
  overtaxed,
  stats,
}: {
  overtaxed: MismatchCandidate[];
  stats: OvertaxedStats;
}) {
  return (
    <section
      className="card p-5 mt-6 bg-accent-50/40 border-accent-300"
      aria-label="Over-rated properties for refund review"
      data-testid="overtaxed-section"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-accent-600" />
          <div>
            <h2 className="text-base font-semibold text-ink-900">
              Review &amp; refund — possibly over-rated
            </h2>
            <p className="text-xs text-ink-500 mt-0.5">
              The engine estimates the correct category is{" "}
              <span className="font-medium">cheaper</span> than the current
              rate for {stats.count}{" "}
              {stats.count === 1 ? "property" : "properties"}. Review before any
              refund — figures are advisory, not a determination.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6 shrink-0">
          <div className="text-right">
            <div className="label">Annual over-charge</div>
            <div className="text-xl font-semibold text-ink-900 tabular-nums">
              {formatAud(stats.annualOvercharge)}
            </div>
          </div>
          <div className="text-right">
            <div className="label">Refund exposure (3y)</div>
            <div className="text-xl font-semibold text-ink-900 tabular-nums">
              {formatAud(stats.refundExposure3y)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-accent-200 pt-3 space-y-2">
        {overtaxed.map((c) => (
          <Link
            key={c.assessmentNumber}
            href={`/recovery/${c.assessmentNumber}`}
            data-testid="overtaxed-row"
            className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-accent-50 transition-colors"
          >
            <span className="flex items-center gap-2 min-w-0">
              <code className="text-xs text-accent-700 font-mono font-medium shrink-0">
                {c.assessmentNumber}
              </code>
              <span className="text-sm text-ink-700 truncate">
                {c.property.address}, {c.property.suburb}
              </span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-medium text-ink-900 tabular-nums">
                −{formatAud(Math.abs(c.estUplift))}/yr
              </span>
              <ArrowUpRight className="w-3 h-3 text-ink-400" />
            </span>
          </Link>
        ))}
        {stats.count > overtaxed.length && (
          <div className="text-xs text-ink-500 px-3 pt-1">
            Showing {overtaxed.length} of {stats.count}. The exposure figures
            above cover all {stats.count}.
          </div>
        )}
      </div>
    </section>
  );
}

function CandidateCard({
  candidate: c,
  rank,
}: {
  candidate: MismatchCandidate;
  rank: number;
}) {
  const isRecentlyGranted = c.signals.some(
    (s) => s.id === RECENTLY_GRANTED_SIGNAL_ID,
  );
  const cadastreLagSignal = c.signals.find((s) => s.id === CADASTRE_LAG_SIGNAL_ID);
  const addressMismatchSignal = c.signals.find(
    (s) => s.id === ADDRESS_MISMATCH_SIGNAL_ID,
  );
  const strataConversionSignal = c.signals.find(
    (s) => s.id === STRATA_CONVERSION_SIGNAL_ID,
  );
  // Parse the lag-days figure out of the evidence string for a quick badge.
  const lagDaysMatch = cadastreLagSignal?.evidence.match(/Cadastre lag: (\d+) days?/);
  const lagDays = lagDaysMatch ? Number(lagDaysMatch[1]) : null;
  // Actions surface from DATA, not filter modes. The Convert button used to
  // be gated behind the strata_conversion filter being active — the
  // highest-value action in the product was invisible in the default view.
  const exposeConvertButton = strataConversionSignal !== undefined;
  return (
    <div
      className="card p-5 hover:border-accent-400 transition-colors relative"
      data-testid="candidate-card"
      data-assessment={c.assessmentNumber}
    >
      <Link
        href={`/recovery/${c.assessmentNumber}`}
        className="absolute inset-0 z-0 rounded"
        aria-label={`View evidence pack for assessment ${c.assessmentNumber}`}
      />
      <div className="flex items-start justify-between gap-4 relative z-10 pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-ink-400 text-sm">#{rank}</span>
            <code className="text-sm text-accent-700 font-mono font-medium">
              {c.assessmentNumber}
            </code>
            <span className={`badge ${SEVERITY_BADGE[c.severity]}`}>
              {c.severity.toUpperCase()}
            </span>
            {isRecentlyGranted && (
              <span
                className="badge bg-warn-100 text-warn-700 border border-warn-300"
                title="An intersecting tenement was granted within the last 90 days (DMIRS MINEDEX)"
              >
                <BellRing className="w-3 h-3 mr-1 inline" />
                NEW GRANT
              </span>
            )}
            {cadastreLagSignal && (
              <span
                className="badge bg-accent-100 text-accent-700 border border-accent-300"
                title={cadastreLagSignal.evidence}
              >
                <Sparkles className="w-3 h-3 mr-1 inline" />
                CADASTRE LAG
              </span>
            )}
            {addressMismatchSignal && (
              <span
                className="badge border"
                style={{
                  backgroundColor: "#ede9fe",
                  color: "#5b21b6",
                  borderColor: "#c4b5fd",
                }}
                title={addressMismatchSignal.evidence}
              >
                <FileText className="w-3 h-3 mr-1 inline" />
                ADDRESS MISMATCH
              </span>
            )}
            {lagDays !== null && (
              <span
                className="badge bg-warn-100 text-warn-700 border border-warn-300"
                title="Days since DMIRS grant vs Landgate landuse classification"
              >
                {lagDays}d lag
              </span>
            )}
            <span className="badge badge-neutral">
              {(c.compositeScore * 100).toFixed(0)}% composite
            </span>
            <span className="badge badge-neutral">
              {c.signals.length} signal{c.signals.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="text-ink-900 font-medium">
            {c.property.address}, {c.property.suburb}
          </div>
          <div className="text-sm text-ink-600 mt-1">
            {c.kind}
          </div>
          {/* Signal trail */}
          <SignalRow signals={c.signals} />
        </div>
        <div className="text-right shrink-0">
          <div className="label">Annual uplift</div>
          <div className="text-xl font-semibold text-ink-900">
            {formatAud(c.estUplift)}
          </div>
          <div className="text-xs text-ink-500">
            {c.property.annualRates ? formatAud(c.property.annualRates) : "—"} → {formatAud(c.estAnnualRatesNew)}
          </div>
          <ScoreBar score={c.compositeScore} />
          <div className="text-xs text-success-700 mt-1 flex items-center justify-end gap-1">
            View pack <ArrowUpRight className="w-3 h-3" />
          </div>
        </div>
      </div>
      {exposeConvertButton && (
        <div className="mt-3 pt-3 border-t border-ink-200 flex items-center justify-between gap-3 relative z-20">
          <div className="text-xs text-ink-600">
            <span className="font-medium text-ink-900">Strata parent detected.</span>{" "}
            Convert the parent to its child CTs before the next levy run.
          </div>
          <Link
            href={`/strata/${c.assessmentNumber}`}
            data-testid="strata-convert-link"
            aria-label={`Open strata conversion workflow for assessment ${c.assessmentNumber}`}
            className="btn bg-warn-600 text-white hover:bg-warn-700 text-xs"
          >
            <Scale className="w-3 h-3" />
            Convert
            <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

function SignalRow({ signals }: { signals: readonly SignalHit[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {[...signals]
        .sort((a, b) => b.weight - a.weight)
        .map((s) => {
          const meta = CATEGORY_META[s.category];
          const Icon = meta.icon;
          return (
            <span
              key={s.id}
              className={`badge ${meta.cls} text-[11px]`}
              title={s.evidence}
            >
              <Icon className="w-3 h-3 mr-1 inline" />
              {s.short}
              <span className="text-ink-400 ml-1">+{s.weight.toFixed(2)}</span>
            </span>
          );
        })}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const colour = score >= 0.6 ? "bg-critical-500" : score >= 0.35 ? "bg-warn-500" : "bg-ink-400";
  return (
    <div className="mt-2 w-32 ml-auto">
      <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${colour} transition-all`}
          style={{ width: `${score * 100}%` }}
        ></div>
      </div>
    </div>
  );
}
