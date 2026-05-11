"use client";

/**
 * /onboarding/[code] — multi-step wizard for council ingestion.
 *
 *  Step 1: confirm council details (read-only)
 *  Step 2: import rating roll (drag-and-drop CSV → preview)
 *  Step 3: confirm import (choose merge strategy → commit)
 *  Step 4: recovery sweep ready (link into /recovery)
 *
 * The pipeline is the same two-phase commit contract the rest of the platform
 * uses — preview returns a commit token; confirm applies. All mutations land
 * in the in-memory DataStore via /api/councils/[code]/import.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Download,
} from "lucide-react";

type Council = {
  code: string;
  name: string;
  state: string;
  population: number;
  rateableProperties: number;
  rateRevenue: number;
  centerLat: number;
  centerLng: number;
};

type SampleRow = {
  assessmentNumber: string;
  address: string;
  suburb: string;
  landUse: string;
  valuation: number;
  annualRates: number;
  ownerName: string;
};

type ErrorRow = { row: number; assessmentNumber?: string; message: string };

type PreviewData = {
  councilCode: string;
  mergeStrategy: "replace" | "upsert";
  validCount: number;
  errorCount: number;
  sampleRows: SampleRow[];
  errorPreview: ErrorRow[];
  commitToken: string;
};

type CommitData = {
  councilCode: string;
  mergeStrategy: "replace" | "upsert";
  inserted: number;
  updated: number;
  removed: number;
  ownersInserted: number;
  beforePropertyCount: number;
  afterPropertyCount: number;
};

type Step = 1 | 2 | 3 | 4;

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const SOFT_WARN_BYTES = 5 * 1024 * 1024;

export default function OnboardingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [council, setCouncil] = useState<Council | null>(null);
  const [councilError, setCouncilError] = useState<string | null>(null);

  // Step 2 state
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 3 state
  const [mergeStrategy, setMergeStrategy] = useState<"replace" | "upsert">(
    "upsert",
  );

  // Step 4 state
  const [commitData, setCommitData] = useState<CommitData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/tenants");
        if (!r.ok) {
          setCouncilError(`HTTP ${r.status} loading tenants`);
          return;
        }
        const body = (await r.json()) as { tenants: Council[] };
        const found = body.tenants.find((t) => t.code === code);
        if (cancelled) return;
        if (!found) {
          setCouncilError(`Council "${code}" not found.`);
          return;
        }
        setCouncil(found);
      } catch (e) {
        if (cancelled) return;
        setCouncilError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const sampleHref = "/api/sample/rating-roll.csv";

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <div className="text-[10px] uppercase tracking-widest text-ink-400">
          Onboarding
        </div>
        <h1 className="text-2xl font-medium text-ink-900">
          {council?.name ?? code}
        </h1>
        <p className="text-sm text-ink-600 mt-1">
          Bring your council&rsquo;s rating roll into RatesAssist. Once the
          import succeeds, the recovery engine sweeps your live property set.
        </p>
      </header>

      <StepBar step={step} />

      {councilError && (
        <div className="text-sm text-critical-700 bg-critical-50 border border-critical-200 rounded p-3">
          {councilError}
        </div>
      )}

      {step === 1 && council && (
        <Step1ConfirmCouncil council={council} onNext={() => setStep(2)} />
      )}

      {step === 2 && council && (
        <Step2Import
          code={code}
          file={file}
          setFile={setFile}
          submitting={submitting}
          preview={preview}
          previewError={previewError}
          sampleHref={sampleHref}
          onPreview={async () => {
            if (!file) return;
            setSubmitting(true);
            setPreviewError(null);
            try {
              const form = new FormData();
              form.set("file", file);
              form.set("mergeStrategy", mergeStrategy);
              form.set("confirm", "false");
              const r = await fetch(`/api/councils/${code}/import`, {
                method: "POST",
                body: form,
              });
              const body = (await r.json()) as {
                ok: boolean;
                data?: PreviewData;
                message?: string;
              };
              if (!r.ok || !body.ok || !body.data) {
                setPreviewError(
                  body.message ?? `Preview rejected (HTTP ${r.status}).`,
                );
                return;
              }
              setPreview(body.data);
            } catch (e) {
              setPreviewError(e instanceof Error ? e.message : String(e));
            } finally {
              setSubmitting(false);
            }
          }}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && preview && (
        <Step3Confirm
          code={code}
          preview={preview}
          mergeStrategy={mergeStrategy}
          setMergeStrategy={setMergeStrategy}
          submitting={submitting}
          onCommit={async () => {
            setSubmitting(true);
            setPreviewError(null);
            try {
              const r = await fetch(`/api/councils/${code}/import`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  csvText: await readBackFile(file),
                  mergeStrategy,
                  confirm: true,
                  commitToken: preview.commitToken,
                }),
              });
              const body = (await r.json()) as {
                ok: boolean;
                data?: CommitData;
                message?: string;
              };
              if (!r.ok || !body.ok || !body.data) {
                setPreviewError(
                  body.message ?? `Commit failed (HTTP ${r.status}).`,
                );
                return;
              }
              setCommitData(body.data);
              setStep(4);
            } catch (e) {
              setPreviewError(e instanceof Error ? e.message : String(e));
            } finally {
              setSubmitting(false);
            }
          }}
          error={previewError}
        />
      )}

      {step === 4 && commitData && (
        <Step4Ready
          code={code}
          commitData={commitData}
          onGo={() => router.push(`/recovery?council=${code}`)}
        />
      )}
    </div>
  );
}

async function readBackFile(file: File | null): Promise<string> {
  if (!file) throw new Error("no file selected");
  return await file.text();
}

function StepBar({ step }: { step: Step }) {
  const items = [
    { n: 1, label: "Council details" },
    { n: 2, label: "Import rating roll" },
    { n: 3, label: "Confirm import" },
    { n: 4, label: "Recovery ready" },
  ];
  return (
    <ol className="flex items-center gap-2 text-xs">
      {items.map((it, i) => {
        const active = it.n === step;
        const done = it.n < step;
        return (
          <li key={it.n} className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium ${
                done
                  ? "bg-success-600 text-white"
                  : active
                    ? "bg-accent-600 text-white"
                    : "bg-ink-100 text-ink-500"
              }`}
            >
              {done ? "✓" : it.n}
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
              {it.label}
            </span>
            {i < items.length - 1 && (
              <span className="text-ink-300 mx-1">·</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Step1ConfirmCouncil({
  council,
  onNext,
}: {
  council: Council;
  onNext: () => void;
}) {
  return (
    <section className="bg-white border border-ink-200 rounded p-5 space-y-4">
      <h2 className="text-lg font-medium text-ink-900">Confirm council details</h2>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-ink-500">Code</dt>
        <dd className="text-ink-900 font-mono">{council.code}</dd>
        <dt className="text-ink-500">Name</dt>
        <dd className="text-ink-900">{council.name}</dd>
        <dt className="text-ink-500">State</dt>
        <dd className="text-ink-900">{council.state}</dd>
        <dt className="text-ink-500">Population</dt>
        <dd className="text-ink-900">{council.population.toLocaleString()}</dd>
        <dt className="text-ink-500">Rateable properties</dt>
        <dd className="text-ink-900">
          {council.rateableProperties.toLocaleString()}
        </dd>
        <dt className="text-ink-500">Annual rate revenue</dt>
        <dd className="text-ink-900">${council.rateRevenue.toLocaleString()}</dd>
      </dl>
      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="btn bg-accent-600 text-white hover:bg-accent-700"
        >
          Continue <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </section>
  );
}

function Step2Import({
  code: _code,
  file,
  setFile,
  submitting,
  preview,
  previewError,
  sampleHref,
  onPreview,
  onNext,
}: {
  code: string;
  file: File | null;
  setFile: (f: File | null) => void;
  submitting: boolean;
  preview: PreviewData | null;
  previewError: string | null;
  sampleHref: string;
  onPreview: () => void;
  onNext: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) setFile(dropped);
    },
    [setFile],
  );

  const sizeWarn = useMemo(() => {
    if (!file) return null;
    if (file.size > MAX_CSV_BYTES)
      return { kind: "error" as const, message: `File exceeds 10MB cap.` };
    if (file.size > SOFT_WARN_BYTES)
      return {
        kind: "warn" as const,
        message: `File is over 5MB; preview may take a moment.`,
      };
    return null;
  }, [file]);

  const blockProceed =
    preview === null ||
    preview.validCount === 0 ||
    preview.errorCount > preview.validCount;

  return (
    <section className="bg-white border border-ink-200 rounded p-5 space-y-4">
      <h2 className="text-lg font-medium text-ink-900">Import rating roll (CSV)</h2>
      <p className="text-sm text-ink-600">
        Required columns:{" "}
        <code className="text-xs">
          assessment_number, address, suburb, postcode, state, landuse,
          valuation, annual_rates, owner_name
        </code>
        . Optional: <code className="text-xs">balance, owner_abn, lot_plan, lat, lng</code>.{" "}
        <Link href={sampleHref} className="text-accent-700 underline">
          Download sample
        </Link>
        .
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-accent-500 bg-accent-50"
            : "border-ink-300 hover:bg-ink-50"
        }`}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="w-8 h-8 mx-auto text-ink-400 mb-2" />
        <div className="text-sm text-ink-700">
          {file ? (
            <span>
              <FileText className="inline w-3 h-3 mr-1" />
              {file.name}{" "}
              <span className="text-ink-500">
                ({(file.size / 1024).toFixed(0)} KB)
              </span>
            </span>
          ) : (
            <span>
              Drag and drop your rating-roll CSV here, or <u>browse</u>.
            </span>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
          }}
        />
      </div>

      {sizeWarn && (
        <div
          className={`text-xs flex items-start gap-2 p-2 rounded ${
            sizeWarn.kind === "error"
              ? "bg-critical-50 border border-critical-200 text-critical-700"
              : "bg-warn-50 border border-warn-200 text-ink-700"
          }`}
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          {sizeWarn.message}
        </div>
      )}

      {previewError && (
        <div className="text-sm text-critical-700 bg-critical-50 border border-critical-200 rounded p-3">
          {previewError}
        </div>
      )}

      {preview && (
        <div className="bg-ink-50 border border-ink-200 rounded p-3 text-sm space-y-2">
          <div className="text-ink-900">
            <strong>{preview.validCount}</strong> valid rows,{" "}
            <strong>{preview.errorCount}</strong> errors.
          </div>
          {preview.errorCount > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-700">
                Show error preview
              </summary>
              <ul className="mt-1 space-y-1 text-ink-600">
                {preview.errorPreview.map((e, i) => (
                  <li key={i}>
                    Row {e.row}
                    {e.assessmentNumber !== undefined
                      ? ` (${e.assessmentNumber})`
                      : ""}
                    : {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.sampleRows.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-700">
                Show sample rows
              </summary>
              <ul className="mt-1 space-y-1 text-ink-600">
                {preview.sampleRows.map((r, i) => (
                  <li key={i}>
                    {r.assessmentNumber} — {r.address}, {r.suburb} ({r.landUse}
                    , ${r.annualRates.toFixed(0)})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onPreview}
          disabled={!file || submitting || sizeWarn?.kind === "error"}
          className="btn bg-white border border-ink-200 text-ink-700 hover:bg-ink-100 disabled:opacity-50"
        >
          {submitting ? "Working…" : preview ? "Re-preview" : "Preview"}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={blockProceed}
          className="btn bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50"
        >
          Continue <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </section>
  );
}

function Step3Confirm({
  code: _code,
  preview,
  mergeStrategy,
  setMergeStrategy,
  submitting,
  onCommit,
  error,
}: {
  code: string;
  preview: PreviewData;
  mergeStrategy: "replace" | "upsert";
  setMergeStrategy: (m: "replace" | "upsert") => void;
  submitting: boolean;
  onCommit: () => void;
  error: string | null;
}) {
  return (
    <section className="bg-white border border-ink-200 rounded p-5 space-y-4">
      <h2 className="text-lg font-medium text-ink-900">Confirm import</h2>
      <div className="text-sm text-ink-700">
        Ready to import <strong>{preview.validCount}</strong> validated rows.
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-widest text-ink-500">
          Merge strategy
        </legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            checked={mergeStrategy === "upsert"}
            onChange={() => setMergeStrategy("upsert")}
            className="mt-0.5"
          />
          <span>
            <strong>Upsert</strong> — match by assessment number; update
            existing, insert new. Safe default.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            checked={mergeStrategy === "replace"}
            onChange={() => setMergeStrategy("replace")}
            className="mt-0.5"
          />
          <span>
            <strong>Replace</strong> — wipe every existing property for this
            council, then insert. Use for a fresh annual roll.
          </span>
        </label>
      </fieldset>

      {error && (
        <div className="text-sm text-critical-700 bg-critical-50 border border-critical-200 rounded p-3">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCommit}
          disabled={submitting}
          className="btn bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {submitting ? "Importing…" : "Confirm and import"}
        </button>
      </div>
    </section>
  );
}

function Step4Ready({
  code,
  commitData,
  onGo,
}: {
  code: string;
  commitData: CommitData;
  onGo: () => void;
}) {
  return (
    <section className="bg-white border border-ink-200 rounded p-5 space-y-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-6 h-6 text-success-600 shrink-0" />
        <div>
          <h2 className="text-lg font-medium text-ink-900">
            Recovery sweep ready
          </h2>
          <p className="text-sm text-ink-600 mt-1">
            Imported {commitData.inserted + commitData.updated} properties
            ({commitData.inserted} new, {commitData.updated} updated
            {commitData.removed > 0 ? `, ${commitData.removed} replaced` : ""}).{" "}
            {commitData.ownersInserted} owners materialised.
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <Tile label="Properties (before)" value={commitData.beforePropertyCount} />
        <Tile label="Properties (after)" value={commitData.afterPropertyCount} />
        <Tile label="Owners materialised" value={commitData.ownersInserted} />
      </dl>
      <div className="flex justify-end gap-2">
        <Link
          href={`/properties?council=${code}`}
          className="btn bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
        >
          Browse properties
        </Link>
        <button
          type="button"
          onClick={onGo}
          className="btn bg-accent-600 text-white hover:bg-accent-700"
        >
          Run recovery audit <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </section>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-ink-50 border border-ink-200 rounded p-2">
      <div className="text-[10px] uppercase tracking-widest text-ink-500">
        {label}
      </div>
      <div className="text-lg font-medium text-ink-900">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
