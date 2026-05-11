"use client";

/**
 * AddCouncilDialog — two-phase "Add Council" flow.
 *
 * Mounted on /tenants (and the /intel council-list section) for users with
 * the `write.user_management` permission. The dialog opens to a form;
 * submitting drives the `add_council` tool through POST /api/tenants in
 * preview mode (`confirm: false`) to get a commitToken; a second POST with
 * `confirm: true` + the token persists the council to the in-memory
 * DataStore and writes an audit row.
 *
 * Validation: client-side via the contract's Zod schema so users never
 * round-trip a malformed body. Australian English copy throughout.
 *
 * Persistence honesty: the DataStore is in-memory only; the success state
 * spells this out so operators don't assume rows survive a restart.
 */

import { useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { schemas } from "@ratesassist/contract";

type AustralianState =
  | "WA"
  | "NSW"
  | "QLD"
  | "VIC"
  | "SA"
  | "TAS"
  | "ACT"
  | "NT";

const STATES: readonly AustralianState[] = [
  "WA",
  "NSW",
  "QLD",
  "VIC",
  "SA",
  "TAS",
  "ACT",
  "NT",
] as const;

type FormState = {
  code: string;
  name: string;
  state: AustralianState;
  centerLat: string;
  centerLng: string;
  population: string;
  rateableProperties: string;
  rateRevenue: string;
};

const EMPTY: FormState = {
  code: "",
  name: "",
  state: "WA",
  centerLat: "",
  centerLng: "",
  population: "",
  rateableProperties: "",
  rateRevenue: "",
};

type Phase =
  | { kind: "form"; errors: Readonly<Record<string, string>> }
  | {
      kind: "preview";
      commitToken: string;
      summary: string;
    }
  | { kind: "submitting" }
  | { kind: "success"; output: string }
  | { kind: "error"; message: string };

function parseNumber(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export function AddCouncilDialog({
  variant = "primary",
  onAdded,
}: {
  variant?: "primary" | "compact";
  onAdded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [phase, setPhase] = useState<Phase>({ kind: "form", errors: {} });

  function reset() {
    setForm(EMPTY);
    setPhase({ kind: "form", errors: {} });
  }

  function closeDialog() {
    setOpen(false);
    // Defer reset to next tick so the closing animation doesn't flash the
    // empty form.
    setTimeout(reset, 200);
  }

  async function submitPreview() {
    const candidate = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      state: form.state,
      centerLat: parseNumber(form.centerLat),
      centerLng: parseNumber(form.centerLng),
      population: Math.floor(parseNumber(form.population)),
      rateableProperties: Math.floor(parseNumber(form.rateableProperties)),
      rateRevenue: parseNumber(form.rateRevenue),
      confirm: false,
    };
    const parsed = schemas.inputs.add_council.safeParse(candidate);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.errors) {
        const k = issue.path[0];
        if (typeof k === "string" && errors[k] === undefined) {
          errors[k] = issue.message;
        }
      }
      setPhase({ kind: "form", errors });
      return;
    }

    setPhase({ kind: "submitting" });
    try {
      const r = await fetch("/api/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await r.json()) as {
        ok: boolean;
        message?: string;
        output?: string;
        commitToken?: string;
      };
      if (!r.ok || !body.ok) {
        setPhase({
          kind: "error",
          message:
            body.message ??
            `Preview rejected (HTTP ${r.status}). Check the council code is unique.`,
        });
        return;
      }
      if (!body.commitToken) {
        setPhase({
          kind: "error",
          message:
            "Server returned no commitToken. Refusing to proceed without two-phase confirmation.",
        });
        return;
      }
      setPhase({
        kind: "preview",
        commitToken: body.commitToken,
        summary: body.output ?? `Will add council ${parsed.data.code}.`,
      });
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function submitConfirm(commitToken: string) {
    setPhase({ kind: "submitting" });
    const candidate = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      state: form.state,
      centerLat: parseNumber(form.centerLat),
      centerLng: parseNumber(form.centerLng),
      population: Math.floor(parseNumber(form.population)),
      rateableProperties: Math.floor(parseNumber(form.rateableProperties)),
      rateRevenue: parseNumber(form.rateRevenue),
      confirm: true,
      commitToken,
    };
    try {
      const r = await fetch("/api/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(candidate),
      });
      const body = (await r.json()) as {
        ok: boolean;
        message?: string;
        output?: string;
      };
      if (!r.ok || !body.ok) {
        setPhase({
          kind: "error",
          message: body.message ?? `Commit failed (HTTP ${r.status}).`,
        });
        return;
      }
      setPhase({
        kind: "success",
        output: body.output ?? `Council ${candidate.code} added.`,
      });
      onAdded?.();
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const triggerCls =
    variant === "compact"
      ? "btn bg-white border border-accent-300 text-accent-700 hover:bg-accent-50 text-xs"
      : "btn bg-accent-600 text-white hover:bg-accent-700";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className={triggerCls} aria-label="Add council">
          <Plus className="w-3 h-3" />
          Add council
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink-900/40 z-40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(560px,92vw)] max-h-[90vh] overflow-y-auto bg-white rounded-lg shadow-xl border border-ink-200"
          style={{ fontFamily: "Arial, sans-serif" }}
        >
          <div className="px-5 py-4 border-b border-ink-200 flex items-center justify-between">
            <Dialog.Title className="font-medium text-ink-900">
              Add council
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="text-ink-500 hover:text-ink-900"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-5 space-y-4">
            {phase.kind === "form" && (
              <FormFields
                form={form}
                setForm={setForm}
                errors={phase.errors}
              />
            )}

            {phase.kind === "submitting" && (
              <div className="text-sm text-ink-600 py-6 text-center">
                Working…
              </div>
            )}

            {phase.kind === "preview" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-3 rounded bg-warn-50 border border-warn-200">
                  <AlertTriangle className="w-4 h-4 text-warn-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-ink-700">
                    <div className="font-medium mb-1">
                      Preview — not yet committed
                    </div>
                    <pre className="text-xs whitespace-pre-wrap font-mono text-ink-700">
                      {phase.summary}
                    </pre>
                  </div>
                </div>
                <div className="text-xs text-ink-500">
                  Persistence is in-memory only for this session. A Postgres
                  rollout (Phase 2) is required for durable storage.
                </div>
              </div>
            )}

            {phase.kind === "error" && (
              <div className="text-sm text-critical-700 bg-critical-50 border border-critical-200 rounded p-3">
                {phase.message}
              </div>
            )}

            {phase.kind === "success" && (
              <div className="space-y-2">
                <div className="flex items-start gap-2 p-3 rounded bg-success-50 border border-success-200 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-success-600 mt-0.5 shrink-0" />
                  <div className="text-ink-800">
                    <div className="font-medium mb-1">Council added</div>
                    <div className="text-xs">{phase.output}</div>
                    <div className="text-xs text-ink-500 mt-2">
                      New council added to this session. Persistence requires
                      Phase 2 Postgres rollout.
                    </div>
                  </div>
                </div>
                <Link
                  href={`/onboarding/${form.code.trim().toUpperCase()}`}
                  onClick={closeDialog}
                  className="flex items-center justify-between p-3 rounded bg-accent-50 border border-accent-200 text-sm hover:bg-accent-100 transition-colors"
                >
                  <span className="text-accent-700 font-medium">
                    Continue to import rating roll
                  </span>
                  <ArrowRight className="w-4 h-4 text-accent-700" />
                </Link>
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-ink-200 flex items-center justify-end gap-2 bg-ink-50/60">
            {phase.kind === "form" && (
              <>
                <button
                  type="button"
                  onClick={closeDialog}
                  className="btn bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitPreview}
                  className="btn bg-accent-600 text-white hover:bg-accent-700"
                >
                  Preview
                </button>
              </>
            )}
            {phase.kind === "preview" && (
              <>
                <button
                  type="button"
                  onClick={() => setPhase({ kind: "form", errors: {} })}
                  className="btn bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => submitConfirm(phase.commitToken)}
                  className="btn bg-accent-600 text-white hover:bg-accent-700"
                >
                  Confirm and create
                </button>
              </>
            )}
            {phase.kind === "error" && (
              <>
                <button
                  type="button"
                  onClick={closeDialog}
                  className="btn bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => setPhase({ kind: "form", errors: {} })}
                  className="btn bg-accent-600 text-white hover:bg-accent-700"
                >
                  Back to form
                </button>
              </>
            )}
            {phase.kind === "success" && (
              <button
                type="button"
                onClick={closeDialog}
                className="btn bg-accent-600 text-white hover:bg-accent-700"
              >
                Done
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FormFields({
  form,
  setForm,
  errors,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  errors: Readonly<Record<string, string>>;
}) {
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm({ ...form, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <Field
        label="Code"
        hint="2-5 uppercase letters"
        error={errors["code"]}
      >
        <input
          value={form.code}
          onChange={(e) => set("code", e.target.value.toUpperCase())}
          placeholder="e.g. CRG"
          maxLength={5}
          className="input"
        />
      </Field>
      <Field label="State" error={errors["state"]}>
        <select
          value={form.state}
          onChange={(e) => set("state", e.target.value as AustralianState)}
          className="input"
        >
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Council name"
        className="col-span-2"
        error={errors["name"]}
      >
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Shire of Coorong"
          className="input"
        />
      </Field>
      <Field
        label="Centroid latitude"
        hint="Decimal degrees, e.g. -31.95"
        error={errors["centerLat"]}
      >
        <input
          value={form.centerLat}
          onChange={(e) => set("centerLat", e.target.value)}
          inputMode="decimal"
          placeholder="-31.95"
          className="input"
        />
      </Field>
      <Field
        label="Centroid longitude"
        hint="Decimal degrees, e.g. 141.47"
        error={errors["centerLng"]}
      >
        <input
          value={form.centerLng}
          onChange={(e) => set("centerLng", e.target.value)}
          inputMode="decimal"
          placeholder="141.47"
          className="input"
        />
      </Field>
      <Field label="Population" error={errors["population"]}>
        <input
          value={form.population}
          onChange={(e) => set("population", e.target.value)}
          inputMode="numeric"
          placeholder="17500"
          className="input"
        />
      </Field>
      <Field
        label="Rateable properties"
        error={errors["rateableProperties"]}
      >
        <input
          value={form.rateableProperties}
          onChange={(e) => set("rateableProperties", e.target.value)}
          inputMode="numeric"
          placeholder="9400"
          className="input"
        />
      </Field>
      <Field
        label="Rate revenue (AUD)"
        hint="Annual"
        className="col-span-2"
        error={errors["rateRevenue"]}
      >
        <input
          value={form.rateRevenue}
          onChange={(e) => set("rateRevenue", e.target.value)}
          inputMode="decimal"
          placeholder="22100000"
          className="input"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs text-ink-700 font-medium">{label}</span>
      {children}
      {hint && !error && (
        <span className="text-[11px] text-ink-500">{hint}</span>
      )}
      {error && (
        <span className="text-[11px] text-critical-700">{error}</span>
      )}
    </label>
  );
}
