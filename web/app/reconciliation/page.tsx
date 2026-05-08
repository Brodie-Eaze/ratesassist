"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { formatAud } from "@/lib/utils";
import { useFetch, LoadingState, ErrorState } from "@/lib/useFetch";
import type { BankDeposit } from "@/lib/types";
import {
  Wallet,
  CheckCircle2,
  HelpCircle,
  AlertCircle,
  ChevronRight,
} from "lucide-react";

type DataResponse = { deposits: BankDeposit[] };

export default function ReconciliationPage() {
  const fetchState = useFetch<DataResponse>("/api/reconciliation");
  const [filter, setFilter] = useState<"all" | "matched" | "suggested" | "unmatched">("all");

  if (fetchState.status === "loading") return <LoadingState />;
  if (fetchState.status === "error") return <ErrorState message={fetchState.error} />;
  const data = fetchState.data;

  const counts = {
    matched: data.deposits.filter((d) => d.status === "matched").length,
    suggested: data.deposits.filter((d) => d.status === "suggested").length,
    unmatched: data.deposits.filter((d) => d.status === "unmatched").length,
    total: data.deposits.length,
    totalAud: data.deposits.reduce((s, d) => s + d.amount, 0),
  };

  const filtered = filter === "all" ? data.deposits : data.deposits.filter((d) => d.status === filter);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-accent-500" />
            Reconciliation
          </h1>
          <div className="text-sm text-ink-500">
            {counts.total} bank deposits today · {formatAud(counts.totalAud)} ·{" "}
            {counts.matched} auto-matched · {counts.suggested} suggested · {counts.unmatched} unmatched
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-ink-50">
          <div className="grid grid-cols-3 gap-4">
            <Stat
              icon={<CheckCircle2 className="w-5 h-5 text-success-500" />}
              label="Auto-matched"
              value={counts.matched.toString()}
              sub={`${((counts.matched / counts.total) * 100).toFixed(0)}% of deposits`}
            />
            <Stat
              icon={<HelpCircle className="w-5 h-5 text-accent-500" />}
              label="Suggested"
              value={counts.suggested.toString()}
              sub="High-confidence — review and confirm"
            />
            <Stat
              icon={<AlertCircle className="w-5 h-5 text-warn-500" />}
              label="Unmatched"
              value={counts.unmatched.toString()}
              sub="Requires officer triage"
            />
          </div>

          {/* Filter */}
          <div className="flex gap-2">
            {(["all", "matched", "suggested", "unmatched"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`btn ${
                  filter === f
                    ? "bg-ink-900 text-white"
                    : "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Deposits */}
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ink-50">
                <tr className="text-xs uppercase tracking-wider text-ink-500">
                  <th className="text-left px-5 py-3 font-medium">Deposit</th>
                  <th className="text-left px-3 py-3 font-medium">Reference</th>
                  <th className="text-left px-3 py-3 font-medium">Source</th>
                  <th className="text-right px-3 py-3 font-medium">Amount</th>
                  <th className="text-left px-3 py-3 font-medium">Match</th>
                  <th className="text-right px-5 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr
                    key={d.id}
                    className="border-t border-ink-100 hover:bg-ink-50/50"
                  >
                    <td className="px-5 py-3">
                      <div className="text-xs text-ink-500">{d.id}</div>
                      <div className="text-ink-900">{d.date}</div>
                    </td>
                    <td className="px-3 py-3">
                      <code className="text-xs text-ink-600">{d.reference}</code>
                    </td>
                    <td className="px-3 py-3 text-ink-700">{d.source}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">
                      {formatAud(d.amount)}
                    </td>
                    <td className="px-3 py-3">
                      {d.status === "matched" && (
                        <div className="flex items-center gap-2">
                          <span className="badge badge-success">Matched</span>
                          {d.matchAssessment && (
                            <code className="text-xs text-accent-700">
                              {d.matchAssessment}
                            </code>
                          )}
                        </div>
                      )}
                      {d.status === "suggested" && (
                        <div className="flex items-center gap-2">
                          <span className="badge bg-accent-50 text-accent-700">
                            Suggested · {((d.matchConfidence ?? 0) * 100).toFixed(0)}%
                          </span>
                          {d.matchAssessment && (
                            <code className="text-xs text-accent-700">
                              {d.matchAssessment}
                            </code>
                          )}
                        </div>
                      )}
                      {d.status === "unmatched" && (
                        <span className="badge badge-warn">Unmatched</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {d.status === "matched" && (
                        <span className="text-xs text-ink-400">Posted</span>
                      )}
                      {d.status === "suggested" && (
                        <button className="btn-primary text-xs px-3 py-1">
                          Confirm
                        </button>
                      )}
                      {d.status === "unmatched" && (
                        <button className="btn-ghost text-xs px-3 py-1 border border-ink-200">
                          Triage <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-5 bg-accent-50/40 border-accent-200">
            <div className="text-sm text-ink-700">
              <strong>Auto-matching logic.</strong> Deposits are matched on (1) BPAY
              reference (assessment number embedded), (2) exact amount + owner-name fuzzy
              match, (3) bank-feed memo cross-reference. Suggested matches at ≥85%
              confidence are surfaced for officer confirmation; below that, deposits
              route to triage.
            </div>
          </div>
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="label">{label}</div>
        {icon}
      </div>
      <div className="text-2xl font-semibold text-ink-900 mt-1">{value}</div>
      <div className="text-xs text-ink-500 mt-1">{sub}</div>
    </div>
  );
}
