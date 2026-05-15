"use client";

/**
 * StrataConversionWizard — multi-step UI that drives the strata-parent →
 * children lifecycle for a single parent assessment.
 *
 * The wizard is **stateless re: persistence**: it renders the step UI
 * appropriate to `currentState`, collects child-CT input, and calls back
 * to the page for API dispatch. The page owns the two-phase commit
 * (preview → confirm) and the API client calls; this component owns the
 * UX, the state machine's visual representation, and input validation.
 *
 * State machine (per spec §7):
 *
 *   parent_strata_detected
 *     → strata_plan_uploaded     (clerk uploads plan or pastes child CTs)
 *       → children_previewed     (engine generates N child Property previews)
 *         → children_imported    (two-phase commit; one audit row per child)
 *           → parent_superseded  (parent record marked closed)
 *      ↘ withdrawn               (legal from any non-terminal state)
 *
 * Australian English throughout. ARIA-compliant: every interactive element
 * has a label, the step progress bar uses `aria-current="step"`, and the
 * lifecycle bar carries a `role="progressbar"` with explicit min / max /
 * now / valuemin / valuemax / valuenow.
 */

import { useCallback, useId, useMemo, useRef, useState } from "react";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Plus,
  Trash2,
  XCircle,
  Scale,
} from "lucide-react";

/**
 * Strata-conversion state-machine vertices. Mirrors the contract's
 * `StrataLifecycleState` (deliberately re-typed here so the web component
 * doesn't reach into the adapter-demo package).
 */
export type StrataLifecycleState =
  | "parent_strata_detected"
  | "strata_plan_uploaded"
  | "children_previewed"
  | "children_imported"
  | "parent_superseded"
  | "withdrawn";

export type ChildCt = {
  readonly volume: string;
  readonly folio: string;
  readonly ven?: string;
  readonly address?: string;
};

export type StrataConversionWizardProps = {
  readonly parentAssessment: string;
  readonly parentCtVolume: string;
  readonly parentCtFolio: string;
  /** Optional landgate-derived count of strata children for Step 1. */
  readonly landgateStrataChildCount?: number;
  readonly currentState: StrataLifecycleState;
  /**
   * Optional pre-existing child CTs (re-loaded from the last
   * children_previewed transition); used to seed the editable list in
   * Step 2 so the clerk doesn't have to retype.
   */
  readonly initialChildCts?: readonly ChildCt[];
  /**
   * Called when the clerk submits a draft list of child CTs from Step 2.
   * The page owns the API dispatch (POST /api/strata/[assessment]/request-conversion
   * with toState=strata_plan_uploaded, then preview → confirm flow into
   * children_previewed).
   */
  readonly onSubmitChildCts: (childCts: readonly ChildCt[]) => Promise<void>;
  /**
   * Called when the clerk confirms-and-imports from Step 3. Receives the
   * full child-CT list and the commit token issued from the preview call.
   */
  readonly onConfirm: (
    childCts: readonly ChildCt[],
    commitToken: string,
  ) => Promise<void>;
  /** Called when the clerk withdraws the conversion. Requires a reason. */
  readonly onWithdraw: (reason: string) => Promise<void>;
  /**
   * Optional preview payload from the most recent server-side preview.
   * Used by Step 3 to show the proposed child Property records the engine
   * will materialise.
   */
  readonly preview?: {
    readonly commitToken: string;
    readonly childCts: readonly ChildCt[];
  };
  /** Optional inline-error string from the most recent API call. */
  readonly error?: string;
  /** Optional submitting flag — disables interactive elements while true. */
  readonly submitting?: boolean;
};

/**
 * Ordered list of pipeline states with human-readable labels for the
 * progress bar. `withdrawn` is rendered out-of-line because it's an
 * orthogonal exit.
 */
const PIPELINE_STATES: ReadonlyArray<{
  readonly state: StrataLifecycleState;
  readonly label: string;
}> = [
  { state: "parent_strata_detected", label: "Detected" },
  { state: "strata_plan_uploaded", label: "Plan uploaded" },
  { state: "children_previewed", label: "Preview ready" },
  { state: "children_imported", label: "Children imported" },
  { state: "parent_superseded", label: "Parent superseded" },
];

function pipelineIndex(state: StrataLifecycleState): number {
  const idx = PIPELINE_STATES.findIndex((s) => s.state === state);
  return idx < 0 ? -1 : idx;
}

export function StrataConversionWizard(
  props: StrataConversionWizardProps,
): JSX.Element {
  const {
    parentAssessment,
    parentCtVolume,
    parentCtFolio,
    landgateStrataChildCount,
    currentState,
    initialChildCts,
    onSubmitChildCts,
    onConfirm,
    onWithdraw,
    preview,
    error,
    submitting,
  } = props;

  const isTerminal =
    currentState === "parent_superseded" || currentState === "withdrawn";

  return (
    <section
      className="space-y-6"
      aria-label="Strata conversion workflow"
      data-testid="strata-wizard"
      data-current-state={currentState}
    >
      <LifecycleProgress current={currentState} />

      {error && (
        <div
          role="alert"
          className="text-sm text-critical-700 bg-critical-50 border border-critical-200 rounded p-3"
        >
          {error}
        </div>
      )}

      {currentState === "parent_strata_detected" && (
        <Step1ParentConfirmation
          parentAssessment={parentAssessment}
          parentCtVolume={parentCtVolume}
          parentCtFolio={parentCtFolio}
          landgateStrataChildCount={landgateStrataChildCount}
        />
      )}

      {(currentState === "parent_strata_detected" ||
        currentState === "strata_plan_uploaded") && (
        <Step2UploadOrPaste
          initialChildCts={initialChildCts}
          submitting={submitting}
          onSubmit={onSubmitChildCts}
        />
      )}

      {currentState === "children_previewed" && (
        <Step3Preview
          preview={preview}
          parentAssessment={parentAssessment}
          submitting={submitting}
          onConfirm={onConfirm}
        />
      )}

      {currentState === "children_imported" && (
        <Step4Done
          parentAssessment={parentAssessment}
          previewChildCount={preview?.childCts.length ?? 0}
        />
      )}

      {currentState === "parent_superseded" && (
        <Step5Superseded parentAssessment={parentAssessment} />
      )}

      {currentState === "withdrawn" && (
        <WithdrawnNotice parentAssessment={parentAssessment} />
      )}

      {!isTerminal && (
        <WithdrawCard submitting={submitting} onWithdraw={onWithdraw} />
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function LifecycleProgress({
  current,
}: {
  current: StrataLifecycleState;
}): JSX.Element {
  const currentIdx = pipelineIndex(current);
  const withdrawn = current === "withdrawn";
  // Map to 0..PIPELINE_STATES.length so the bar shows a "withdrawn" exit
  // visually as a separate state rather than rolling backwards.
  const valueNow = withdrawn ? 0 : Math.max(0, currentIdx);
  const valueMax = PIPELINE_STATES.length - 1;
  return (
    <div
      role="progressbar"
      aria-label="Strata conversion lifecycle"
      aria-valuemin={0}
      aria-valuemax={valueMax}
      aria-valuenow={valueNow}
      className="space-y-2"
      data-testid="lifecycle-progress"
    >
      <ol className="flex items-center gap-2 text-xs flex-wrap">
        {PIPELINE_STATES.map((s, i) => {
          const done = !withdrawn && i < currentIdx;
          const active = !withdrawn && i === currentIdx;
          return (
            <li
              key={s.state}
              {...(active ? { "aria-current": "step" } : {})}
              className="flex items-center gap-2"
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium ${
                  done
                    ? "bg-success-600 text-white"
                    : active
                      ? "bg-accent-600 text-white"
                      : "bg-ink-100 text-ink-500"
                }`}
                data-state={s.state}
                aria-hidden="true"
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={
                  active
                    ? "text-ink-900 font-medium"
                    : done
                      ? "text-ink-600"
                      : "text-ink-400"
                }
              >
                {s.label}
              </span>
              {i < PIPELINE_STATES.length - 1 && (
                <span className="text-ink-300 mx-1" aria-hidden="true">
                  &middot;
                </span>
              )}
            </li>
          );
        })}
        {withdrawn && (
          <li
            aria-current="step"
            className="flex items-center gap-2 ml-2 pl-2 border-l border-ink-200"
          >
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium bg-critical-600 text-white"
              aria-hidden="true"
            >
              W
            </span>
            <span className="text-critical-700 font-medium">Withdrawn</span>
          </li>
        )}
      </ol>
    </div>
  );
}

function Step1ParentConfirmation({
  parentAssessment,
  parentCtVolume,
  parentCtFolio,
  landgateStrataChildCount,
}: {
  parentAssessment: string;
  parentCtVolume: string;
  parentCtFolio: string;
  landgateStrataChildCount?: number;
}): JSX.Element {
  return (
    <section
      className="bg-white border border-ink-200 rounded p-5 space-y-4"
      aria-labelledby="step1-heading"
    >
      <h2 id="step1-heading" className="text-lg font-medium text-ink-900">
        Step 1 &mdash; Confirm parent title
      </h2>
      <p className="text-sm text-ink-600">
        Landgate records this parent CT was strata-subdivided. Confirm the CT
        below, then upload the plan or paste the child CTs.
      </p>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-ink-500">Parent assessment</dt>
        <dd className="text-ink-900 font-mono">{parentAssessment}</dd>
        <dt className="text-ink-500">Parent CT (Volume/Folio)</dt>
        <dd className="text-ink-900 font-mono">
          {parentCtVolume}/{parentCtFolio}
        </dd>
        <dt className="text-ink-500">Strata children on Landgate</dt>
        <dd className="text-ink-900">
          {landgateStrataChildCount !== undefined
            ? `${landgateStrataChildCount} child CT(s) recorded`
            : "(count not yet sourced)"}
        </dd>
      </dl>
    </section>
  );
}

function Step2UploadOrPaste({
  initialChildCts,
  submitting,
  onSubmit,
}: {
  initialChildCts?: readonly ChildCt[];
  submitting?: boolean;
  onSubmit: (childCts: readonly ChildCt[]) => Promise<void>;
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState<ChildCt[]>(
    initialChildCts && initialChildCts.length > 0
      ? [...initialChildCts]
      : [
          { volume: "", folio: "", ven: "", address: "" },
          { volume: "", folio: "", ven: "", address: "" },
        ],
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f) {
      setFile(f);
      void parseFileIntoRows(f).then((parsed) => {
        if (parsed && parsed.length > 0) setRows(parsed);
      });
    }
  }, []);

  const trimmedRows = useMemo(
    () =>
      rows
        .map((r) => ({
          volume: (r.volume ?? "").trim(),
          folio: (r.folio ?? "").trim(),
          ven: (r.ven ?? "").trim(),
          address: (r.address ?? "").trim(),
        }))
        .filter((r) => r.volume.length > 0 && r.folio.length > 0)
        .map(
          (r): ChildCt => ({
            volume: r.volume,
            folio: r.folio,
            ...(r.ven.length > 0 ? { ven: r.ven } : {}),
            ...(r.address.length > 0 ? { address: r.address } : {}),
          }),
        ),
    [rows],
  );

  const tooFew = trimmedRows.length < 2;

  return (
    <section
      className="bg-white border border-ink-200 rounded p-5 space-y-4"
      aria-labelledby="step2-heading"
    >
      <h2 id="step2-heading" className="text-lg font-medium text-ink-900">
        Step 2 &mdash; Upload plan or paste child CTs
      </h2>
      <p className="text-sm text-ink-600">
        Provide the strata plan PDF or a CSV with the child certificates of
        title, OR enter the child CTs manually below. At least two child CTs
        are required &mdash; a single-child parent is not strata.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-accent-500 bg-accent-50"
            : "border-ink-300 hover:bg-ink-50"
        }`}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload strata plan or child-CT CSV"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <Upload className="w-7 h-7 mx-auto text-ink-400 mb-2" aria-hidden="true" />
        <div className="text-sm text-ink-700">
          {file ? (
            <span>
              <FileText className="inline w-3 h-3 mr-1" aria-hidden="true" />
              {file.name}
              <span className="text-ink-500 ml-1">
                ({(file.size / 1024).toFixed(0)} KB)
              </span>
            </span>
          ) : (
            <span>
              Drag-and-drop the strata plan PDF or child-CT CSV here, or{" "}
              <u>browse</u>.
            </span>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          className="hidden"
          aria-label="Strata plan or child-CT CSV file picker"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f) {
              void parseFileIntoRows(f).then((parsed) => {
                if (parsed && parsed.length > 0) setRows(parsed);
              });
            }
          }}
        />
      </div>

      <ChildCtTable rows={rows} setRows={setRows} />

      {localError && (
        <div
          role="alert"
          className="text-sm text-critical-700 bg-critical-50 border border-critical-200 rounded p-3"
        >
          {localError}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-ink-500" aria-live="polite">
          {trimmedRows.length} valid row{trimmedRows.length === 1 ? "" : "s"}
          {tooFew && " — minimum 2 child CTs required."}
        </div>
        <button
          type="button"
          onClick={async () => {
            setLocalError(null);
            if (tooFew) {
              setLocalError(
                "At least 2 child CTs are required. A single-child parent is not strata.",
              );
              return;
            }
            try {
              await onSubmit(trimmedRows);
            } catch (e) {
              setLocalError(e instanceof Error ? e.message : String(e));
            }
          }}
          disabled={submitting === true || tooFew}
          data-testid="strata-submit-child-cts"
          className="btn bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {submitting === true ? "Working..." : "Continue to preview"}
          <ArrowRight className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function ChildCtTable({
  rows,
  setRows,
}: {
  rows: ChildCt[];
  setRows: React.Dispatch<React.SetStateAction<ChildCt[]>>;
}): JSX.Element {
  const updateRow = (idx: number, patch: Partial<ChildCt>): void => {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch };
      return next;
    });
  };
  const addRow = (): void =>
    setRows((prev) => [...prev, { volume: "", folio: "", ven: "", address: "" }]);
  const removeRow = (idx: number): void => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-ink-200 rounded">
        <caption className="sr-only">Child certificate-of-title entry table</caption>
        <thead className="bg-ink-50 text-left">
          <tr>
            <th scope="col" className="px-2 py-1 text-xs font-medium text-ink-600">
              Volume
            </th>
            <th scope="col" className="px-2 py-1 text-xs font-medium text-ink-600">
              Folio
            </th>
            <th scope="col" className="px-2 py-1 text-xs font-medium text-ink-600">
              VEN (optional)
            </th>
            <th scope="col" className="px-2 py-1 text-xs font-medium text-ink-600">
              Address (optional)
            </th>
            <th scope="col" className="px-2 py-1 text-xs font-medium text-ink-600 w-8">
              <span className="sr-only">Remove row</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} data-testid="strata-child-row">
              <td className="px-2 py-1">
                <input
                  type="text"
                  value={r.volume ?? ""}
                  onChange={(e) => updateRow(i, { volume: e.target.value })}
                  aria-label={`Child CT ${i + 1} volume`}
                  className="w-full text-sm border border-ink-200 rounded px-2 py-1"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  type="text"
                  value={r.folio ?? ""}
                  onChange={(e) => updateRow(i, { folio: e.target.value })}
                  aria-label={`Child CT ${i + 1} folio`}
                  className="w-full text-sm border border-ink-200 rounded px-2 py-1"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  type="text"
                  value={r.ven ?? ""}
                  onChange={(e) => updateRow(i, { ven: e.target.value })}
                  aria-label={`Child CT ${i + 1} VEN`}
                  className="w-full text-sm border border-ink-200 rounded px-2 py-1"
                />
              </td>
              <td className="px-2 py-1">
                <input
                  type="text"
                  value={r.address ?? ""}
                  onChange={(e) => updateRow(i, { address: e.target.value })}
                  aria-label={`Child CT ${i + 1} address`}
                  className="w-full text-sm border border-ink-200 rounded px-2 py-1"
                />
              </td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label={`Remove child CT ${i + 1}`}
                  className="text-ink-500 hover:text-critical-600"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={addRow}
        data-testid="strata-add-row"
        className="mt-2 btn bg-white border border-ink-200 text-ink-700 hover:bg-ink-100 text-xs"
      >
        <Plus className="w-3 h-3" aria-hidden="true" />
        Add child CT
      </button>
    </div>
  );
}

function Step3Preview({
  preview,
  parentAssessment,
  submitting,
  onConfirm,
}: {
  preview?: {
    readonly commitToken: string;
    readonly childCts: readonly ChildCt[];
  };
  parentAssessment: string;
  submitting?: boolean;
  onConfirm: (
    childCts: readonly ChildCt[],
    commitToken: string,
  ) => Promise<void>;
}): JSX.Element {
  const [localError, setLocalError] = useState<string | null>(null);
  return (
    <section
      className="bg-white border border-ink-200 rounded p-5 space-y-4"
      aria-labelledby="step3-heading"
    >
      <h2 id="step3-heading" className="text-lg font-medium text-ink-900">
        Step 3 &mdash; Preview proposed children
      </h2>
      <p className="text-sm text-ink-600">
        The engine will materialise the following child Property records under
        parent <code className="font-mono text-xs">{parentAssessment}</code>.
        Ownership is pulled from the parent and marked <em>TBC after import</em>{" "}
        — adjust on each child after the conversion completes.
      </p>

      {preview === undefined ? (
        <div className="text-sm text-ink-500 italic">
          Preview not loaded. Return to Step 2 and submit child CTs first.
        </div>
      ) : (
        <table className="w-full text-sm border border-ink-200 rounded">
          <caption className="sr-only">Proposed child property previews</caption>
          <thead className="bg-ink-50 text-left">
            <tr>
              <th scope="col" className="px-2 py-1 text-xs font-medium text-ink-600">
                Child CT (Vol/Folio)
              </th>
              <th scope="col" className="px-2 py-1 text-xs font-medium text-ink-600">
                Address
              </th>
              <th scope="col" className="px-2 py-1 text-xs font-medium text-ink-600">
                VEN
              </th>
              <th scope="col" className="px-2 py-1 text-xs font-medium text-ink-600">
                Ownership
              </th>
            </tr>
          </thead>
          <tbody>
            {preview.childCts.map((c, i) => (
              <tr key={`${c.volume}/${c.folio}/${i}`}>
                <td className="px-2 py-1 font-mono text-xs">
                  {c.volume}/{c.folio}
                </td>
                <td className="px-2 py-1 text-ink-700">
                  {c.address ?? <span className="italic text-ink-400">(unspecified)</span>}
                </td>
                <td className="px-2 py-1 font-mono text-xs">
                  {c.ven ?? <span className="italic text-ink-400">(none)</span>}
                </td>
                <td className="px-2 py-1 italic text-ink-500">TBC after import</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {localError && (
        <div
          role="alert"
          className="text-sm text-critical-700 bg-critical-50 border border-critical-200 rounded p-3"
        >
          {localError}
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={async () => {
            setLocalError(null);
            if (preview === undefined) {
              setLocalError("No preview available; return to Step 2.");
              return;
            }
            try {
              await onConfirm(preview.childCts, preview.commitToken);
            } catch (e) {
              setLocalError(e instanceof Error ? e.message : String(e));
            }
          }}
          disabled={submitting === true || preview === undefined}
          data-testid="strata-confirm-import"
          className="btn bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {submitting === true ? "Importing..." : "Confirm and import"}
          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function Step4Done({
  parentAssessment,
  previewChildCount,
}: {
  parentAssessment: string;
  previewChildCount: number;
}): JSX.Element {
  return (
    <section
      className="bg-white border border-ink-200 rounded p-5 space-y-4"
      aria-labelledby="step4-heading"
    >
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-6 h-6 text-success-600 shrink-0" aria-hidden="true" />
        <div>
          <h2 id="step4-heading" className="text-lg font-medium text-ink-900">
            Child properties imported
          </h2>
          <p className="text-sm text-ink-600 mt-1">
            {previewChildCount > 0
              ? `${previewChildCount} child propert${previewChildCount === 1 ? "y" : "ies"} created.`
              : "Child properties created."}{" "}
            Parent assessment{" "}
            <code className="font-mono text-xs">{parentAssessment}</code> is
            now flagged as a strata parent. Mark it superseded once the
            council&apos;s rating roll is reconciled, or return to the recovery
            audit to flow the children into the next sweep.
          </p>
        </div>
      </div>
    </section>
  );
}

function Step5Superseded({
  parentAssessment,
}: {
  parentAssessment: string;
}): JSX.Element {
  return (
    <section
      className="bg-white border border-ink-200 rounded p-5"
      aria-labelledby="step5-heading"
    >
      <h2 id="step5-heading" className="text-lg font-medium text-ink-900 flex items-center gap-2">
        <Scale className="w-5 h-5 text-success-600" aria-hidden="true" />
        Parent record superseded
      </h2>
      <p className="text-sm text-ink-600 mt-2">
        Parent assessment{" "}
        <code className="font-mono text-xs">{parentAssessment}</code> is closed
        and cross-referenced to its child records. No further action required.
      </p>
    </section>
  );
}

function WithdrawnNotice({
  parentAssessment,
}: {
  parentAssessment: string;
}): JSX.Element {
  return (
    <section
      role="status"
      className="bg-critical-50 border border-critical-200 rounded p-5"
    >
      <h2 className="text-lg font-medium text-critical-800 flex items-center gap-2">
        <XCircle className="w-5 h-5 text-critical-600" aria-hidden="true" />
        Conversion withdrawn
      </h2>
      <p className="text-sm text-critical-700 mt-2">
        The strata conversion for parent assessment{" "}
        <code className="font-mono text-xs">{parentAssessment}</code> has been
        withdrawn. The parent remains on the rating roll until the conversion
        is re-initiated.
      </p>
    </section>
  );
}

function WithdrawCard({
  submitting,
  onWithdraw,
}: {
  submitting?: boolean;
  onWithdraw: (reason: string) => Promise<void>;
}): JSX.Element {
  const [reason, setReason] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const reasonId = useId();
  return (
    <section
      className="bg-ink-50 border border-ink-200 rounded p-4 space-y-3"
      aria-label="Withdraw conversion"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-ink-700 flex items-center gap-2">
          <AlertTriangle
            className="w-4 h-4 text-warn-600 shrink-0"
            aria-hidden="true"
          />
          Withdraw if you want to abandon the conversion (e.g. the strata plan
          turned out to be a re-titling, not a subdivision).
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            data-testid="strata-withdraw-open"
            className="btn bg-white border border-critical-300 text-critical-700 hover:bg-critical-50 text-xs"
          >
            Withdraw conversion
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2">
          <label
            htmlFor={reasonId}
            className="block text-xs uppercase tracking-widest text-ink-500"
          >
            Reason (required)
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            data-testid="strata-withdraw-reason"
            className="w-full text-sm border border-ink-200 rounded p-2"
            placeholder="e.g. Landgate clarified this is a re-titling, not a subdivision."
          />
          {localError && (
            <div
              role="alert"
              className="text-xs text-critical-700 bg-critical-50 border border-critical-200 rounded p-2"
            >
              {localError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setLocalError(null);
              }}
              className="btn bg-white border border-ink-200 text-ink-700 hover:bg-ink-100 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                setLocalError(null);
                const trimmed = reason.trim();
                if (trimmed.length === 0) {
                  setLocalError("Reason is required to withdraw a conversion.");
                  return;
                }
                try {
                  await onWithdraw(trimmed);
                } catch (e) {
                  setLocalError(e instanceof Error ? e.message : String(e));
                }
              }}
              disabled={submitting === true || reason.trim().length === 0}
              data-testid="strata-withdraw-submit"
              className="btn bg-critical-600 text-white hover:bg-critical-700 text-xs disabled:opacity-50"
            >
              {submitting === true ? "Withdrawing..." : "Confirm withdraw"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------
// CSV parsing helper — quick best-effort parse for the drag-and-drop input.
// PDFs are accepted at upload time but parsed server-side; locally we just
// surface the file name and let the manual table be the source of truth.
// ----------------------------------------------------------------------------

async function parseFileIntoRows(file: File): Promise<ChildCt[] | null> {
  if (!file.name.toLowerCase().endsWith(".csv")) return null;
  try {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;
    const header = lines[0]!.toLowerCase();
    const startIdx =
      header.includes("volume") || header.includes("folio") ? 1 : 0;
    const out: ChildCt[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      const parts = lines[i]!.split(",").map((p) => p.trim());
      const [volume, folio, ven, address] = parts;
      if (!volume || !folio) continue;
      out.push({
        volume,
        folio,
        ...(ven ? { ven } : {}),
        ...(address ? { address } : {}),
      });
    }
    return out;
  } catch {
    return null;
  }
}

export default StrataConversionWizard;
