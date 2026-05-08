"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import type { ActivityEvent } from "@/lib/types";
import {
  Search,
  Pencil,
  MessageCircle,
  TrendingUp,
  Cog,
  LogIn,
  History,
} from "lucide-react";

type DataResponse = { activity: ActivityEvent[] };

const CATEGORY_META: Record<
  ActivityEvent["category"],
  { icon: typeof Search; cls: string; label: string }
> = {
  lookup: { icon: Search, cls: "text-accent-700 bg-accent-50", label: "Lookup" },
  write: { icon: Pencil, cls: "text-warn-700 bg-warn-50", label: "Write" },
  comms: { icon: MessageCircle, cls: "text-accent-700 bg-accent-50", label: "Comms" },
  recovery: { icon: TrendingUp, cls: "text-success-700 bg-success-50", label: "Recovery" },
  system: { icon: Cog, cls: "text-ink-700 bg-ink-100", label: "System" },
  auth: { icon: LogIn, cls: "text-ink-700 bg-ink-100", label: "Auth" },
};

export default function ActivityPage() {
  const [data, setData] = useState<DataResponse | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    fetch("/api/activity")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center text-ink-500">
          Loading…
        </main>
      </div>
    );
  }

  const filtered =
    filter === "all" ? data.activity : data.activity.filter((a) => a.category === filter);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <h1 className="text-xl font-semibold text-ink-900 flex items-center gap-2">
            <History className="w-5 h-5 text-accent-500" />
            Activity & Audit Log
          </h1>
          <div className="text-sm text-ink-500">
            Immutable, append-only · Retained 7 years (state records compliance)
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-ink-50">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFilter("all")}
              className={`btn ${
                filter === "all"
                  ? "bg-ink-900 text-white"
                  : "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
              }`}
            >
              All
            </button>
            {(Object.keys(CATEGORY_META) as ActivityEvent["category"][]).map((cat) => {
              const meta = CATEGORY_META[cat];
              const Icon = meta.icon;
              const count = data.activity.filter((a) => a.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`btn ${
                    filter === cat
                      ? "bg-ink-900 text-white"
                      : "bg-white border border-ink-200 text-ink-700 hover:bg-ink-100"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {meta.label}
                  <span className="text-[10px] opacity-70 ml-1">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ink-50">
                <tr className="text-xs uppercase tracking-wider text-ink-500">
                  <th className="text-left px-5 py-3 font-medium">Time</th>
                  <th className="text-left px-3 py-3 font-medium">User</th>
                  <th className="text-left px-3 py-3 font-medium">Council</th>
                  <th className="text-left px-3 py-3 font-medium">Action</th>
                  <th className="text-left px-3 py-3 font-medium">Detail</th>
                  <th className="text-left px-5 py-3 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const meta = CATEGORY_META[a.category];
                  const Icon = meta.icon;
                  return (
                    <tr
                      key={a.id}
                      className="border-t border-ink-100 hover:bg-ink-50/50"
                    >
                      <td className="px-5 py-3">
                        <div className="text-xs text-ink-500">{a.id}</div>
                        <div className="text-ink-900 text-xs font-mono">{a.ts}</div>
                      </td>
                      <td className="px-3 py-3 text-ink-700">{a.user}</td>
                      <td className="px-3 py-3 text-ink-700">{a.council}</td>
                      <td className="px-3 py-3">
                        <code className="text-accent-700 text-xs">{a.action}</code>
                        {a.target && (
                          <div className="text-xs text-ink-500 mt-0.5">→ {a.target}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-ink-700">{a.detail}</td>
                      <td className="px-5 py-3">
                        <span className={`badge ${meta.cls}`}>
                          <Icon className="w-3 h-3 mr-1 inline" />
                          {meta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card p-5 bg-accent-50/40 border-accent-200">
            <div className="text-sm text-ink-700">
              <strong>Tamper-evident audit log.</strong> Every read and write is
              captured with user, role, IP, timestamp, parameters, and result hash. The
              log is append-only and periodically anchored via a Merkle tree to detect
              tampering. Exportable per tenant on demand and on offboarding. Retained 7
              years to satisfy state records legislation.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
