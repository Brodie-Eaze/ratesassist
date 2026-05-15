"use client";

/**
 * /strata/[assessment] — Strata conversion workflow page.
 *
 * Wraps the <StrataConversionWizard /> component, manages the two-phase
 * commit handshake against `POST /api/strata/:assessment/request-conversion`,
 * and surfaces the lifecycle state to the wizard.
 *
 * The wizard is the source of truth for what to render at each step; this
 * page owns the API client calls + the persisted state. RBAC enforcement
 * lives behind the route (write.commit_mutation, per the contract's RBAC
 * matrix).
 */

import { useCallback, useEffect, useMemo, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import {
  StrataConversionWizard,
  type ChildCt,
  type StrataLifecycleState,
} from "@/components/StrataConversionWizard";
import type { Property } from "@/lib/types";
import { ArrowLeft, FileText } from "lucide-react";

type PropertyDetail = {
  property: Property;
};

type ApiEnvelope<T> =
  | { ok: true; output?: string; data?: T; commitToken?: string; mutated?: boolean }
  | { ok: false; code?: string; message?: string };

type ConversionData = {
  parentAssessmentNumber?: string;
  previousState?: StrataLifecycleState;
  state?: StrataLifecycleState;
  childCts?: ReadonlyArray<{
    volume: string;
    folio: string;
    ven?: string;
    address?: string;
    childAssessmentNumber?: string;
  }>;
  createdChildren?: number;
};

type PreviewState = {
  commitToken: string;
  childCts: readonly ChildCt[];
};

export default function StrataPage({
  params,
}: {
  params: Promise<{ assessment: string }> | { assessment: string };
}): JSX.Element {
  // Next 14/15 unwrap: params can be a plain object or a Promise depending on
  // the runtime. Use React.use() defensively so the page works on both.
  const resolved =
    typeof (params as { then?: unknown }).then === "function"
      ? (use(params as Promise<{ assessment: string }>))
      : (params as { assessment: string });
  const { assessment } = resolved;
  const router = useRouter();

  const [property, setProperty] = useState<Property | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentState, setCurrentState] =
    useState<StrataLifecycleState>("parent_strata_detected");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/properties/${assessment}`);
        if (!r.ok) {
          setLoadError(`HTTP ${r.status} loading property ${assessment}`);
          return;
        }
        const body = (await r.json()) as ApiEnvelope<PropertyDetail>;
        if (cancelled) return;
        if (!body.ok || !body.data) {
          setLoadError(body.ok ? "Property payload missing." : (body.message ?? "Unable to load property."));
          return;
        }
        setProperty(body.data.property);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assessment]);

  const callApi = useCallback(
    async (body: Record<string, unknown>): Promise<ApiEnvelope<ConversionData>> => {
      const r = await fetch(`/api/strata/${assessment}/request-conversion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const env = (await r.json()) as ApiEnvelope<ConversionData>;
      if (!r.ok && !("ok" in env)) {
        return { ok: false, code: "internal_error", message: `HTTP ${r.status}` };
      }
      return env;
    },
    [assessment],
  );

  // Step 2 → Step 3: clerk submits the child CTs. We run the preview round of
  // request_strata_conversion to materialise the commit token + state-machine
  // step into children_previewed.
  const onSubmitChildCts = useCallback(
    async (childCts: readonly ChildCt[]) => {
      setApiError(null);
      setSubmitting(true);
      try {
        // First lift parent_strata_detected → strata_plan_uploaded (preview +
        // confirm). The state machine forbids skipping states.
        if (currentState === "parent_strata_detected") {
          const previewPlan = await callApi({
            toState: "strata_plan_uploaded",
            childCts,
            confirm: false,
          });
          if (!previewPlan.ok || !previewPlan.commitToken) {
            setApiError(previewPlan.ok ? "Missing commit token from preview." : (previewPlan.message ?? "Preview failed."));
            return;
          }
          const commitPlan = await callApi({
            toState: "strata_plan_uploaded",
            childCts,
            confirm: true,
            commitToken: previewPlan.commitToken,
          });
          if (!commitPlan.ok) {
            setApiError(commitPlan.message ?? "Commit failed.");
            return;
          }
          setCurrentState("strata_plan_uploaded");
        }

        // strata_plan_uploaded → children_previewed. Preview + confirm.
        const previewChildren = await callApi({
          toState: "children_previewed",
          childCts,
          confirm: false,
        });
        if (!previewChildren.ok || !previewChildren.commitToken) {
          setApiError(previewChildren.ok ? "Missing commit token from preview." : (previewChildren.message ?? "Preview failed."));
          return;
        }
        const commitChildren = await callApi({
          toState: "children_previewed",
          childCts,
          confirm: true,
          commitToken: previewChildren.commitToken,
        });
        if (!commitChildren.ok) {
          setApiError(commitChildren.message ?? "Commit failed.");
          return;
        }
        setCurrentState("children_previewed");

        // Now issue a preview for the children_imported transition so the
        // confirm screen can carry a fresh commit token.
        const previewImport = await callApi({
          toState: "children_imported",
          childCts,
          confirm: false,
        });
        if (!previewImport.ok || !previewImport.commitToken) {
          setApiError(previewImport.ok ? "Missing commit token from preview." : (previewImport.message ?? "Preview failed."));
          return;
        }
        setPreview({ commitToken: previewImport.commitToken, childCts });
      } finally {
        setSubmitting(false);
      }
    },
    [callApi, currentState],
  );

  // Step 3 → Step 4: clerk confirms the import. Two-phase commit fires; on
  // success child Property rows materialise.
  const onConfirm = useCallback(
    async (childCts: readonly ChildCt[], commitToken: string) => {
      setApiError(null);
      setSubmitting(true);
      try {
        const commit = await callApi({
          toState: "children_imported",
          childCts,
          confirm: true,
          commitToken,
        });
        if (!commit.ok) {
          setApiError(commit.message ?? "Import failed.");
          return;
        }
        setCurrentState("children_imported");
        setPreview(null);
      } finally {
        setSubmitting(false);
      }
    },
    [callApi],
  );

  // Withdraw — legal from any non-terminal state.
  const onWithdraw = useCallback(
    async (reason: string) => {
      setApiError(null);
      setSubmitting(true);
      try {
        const previewW = await callApi({
          toState: "withdrawn",
          reason,
          confirm: false,
        });
        if (!previewW.ok || !previewW.commitToken) {
          setApiError(previewW.ok ? "Missing commit token from preview." : (previewW.message ?? "Preview failed."));
          return;
        }
        const commitW = await callApi({
          toState: "withdrawn",
          reason,
          confirm: true,
          commitToken: previewW.commitToken,
        });
        if (!commitW.ok) {
          setApiError(commitW.message ?? "Withdraw failed.");
          return;
        }
        setCurrentState("withdrawn");
      } finally {
        setSubmitting(false);
      }
    },
    [callApi],
  );

  const parentCtVolume = property?.ctVolume ?? "—";
  const parentCtFolio = property?.ctFolio ?? "—";
  const landgateStrataChildCount = property?.strataChildren?.length;

  const initialChildCts = useMemo<ChildCt[] | undefined>(() => {
    if (!property?.strataChildren || property.strataChildren.length === 0)
      return undefined;
    return property.strataChildren.map((c) => ({
      volume: c.volume,
      folio: c.folio,
    }));
  }, [property]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <div className="flex items-center gap-3">
            <Link
              href="/recovery?signal=strata_conversion"
              aria-label="Back to recovery audit"
              className="text-ink-500 hover:text-ink-900"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </Link>
            <h1 className="text-xl font-semibold text-ink-900">
              Strata conversion
            </h1>
            <span className="badge bg-warn-100 text-warn-700">
              <FileText className="w-3 h-3 mr-1 inline" aria-hidden="true" />
              Two-phase commit
            </span>
          </div>
          <div className="text-sm text-ink-500">
            Drive a strata-parent record through the conversion lifecycle.
            Every transition is audit-logged.
          </div>
          <div className="text-xs text-ink-400 mt-1">
            Parent assessment:{" "}
            <code className="font-mono text-xs">{assessment}</code>
            {property && (
              <>
                {" "}
                · {property.address}, {property.suburb}{" "}
                {property.state} {property.postcode}
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-ink-50">
          {loadError && (
            <div
              role="alert"
              className="text-sm text-critical-700 bg-critical-50 border border-critical-200 rounded p-3"
            >
              Failed to load property {assessment}: {loadError}
            </div>
          )}
          {property === null && loadError === null && (
            <div className="text-sm text-ink-500">Loading…</div>
          )}
          {property !== null && (
            <StrataConversionWizard
              parentAssessment={assessment}
              parentCtVolume={parentCtVolume}
              parentCtFolio={parentCtFolio}
              landgateStrataChildCount={landgateStrataChildCount}
              currentState={currentState}
              initialChildCts={initialChildCts}
              preview={preview ?? undefined}
              error={apiError ?? undefined}
              submitting={submitting}
              onSubmitChildCts={onSubmitChildCts}
              onConfirm={onConfirm}
              onWithdraw={onWithdraw}
            />
          )}

          {currentState === "children_imported" && (
            <div className="flex items-center justify-end gap-2">
              <Link
                href={`/recovery?council=${property?.council ?? ""}`}
                className="btn bg-accent-600 text-white hover:bg-accent-700"
              >
                Open recovery audit
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
