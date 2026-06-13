"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { PortfolioMap } from "@/components/PortfolioMap";
import type { Council, Owner, Property, Tenement } from "@/lib/types";
import { formatAud } from "@/lib/utils";
import { useFetch, LoadingState, ErrorState } from "@/lib/useFetch";
import { Search, MapPin, Building2 } from "lucide-react";

type DataResponse = {
  councils: Council[];
  properties: Property[];
  owners: Owner[];
  tenements: Tenement[];
};

export default function PropertiesPage() {
  const fetchState = useFetch<DataResponse>("/api/data?include=properties,owners,tenements,mismatches");
  const [query, setQuery] = useState("");
  const [council, setCouncil] = useState<string>("");
  const [selected, setSelected] = useState<Property | null>(null);

  if (fetchState.status === "loading") return <LoadingState />;
  if (fetchState.status === "error") return <ErrorState message={fetchState.error} />;
  const data = fetchState.data;

  const filtered = data.properties.filter((p) => {
    const q = query.toLowerCase();
    const matchQ =
      !q ||
      p.address.toLowerCase().includes(q) ||
      p.suburb.toLowerCase().includes(q) ||
      p.assessmentNumber.toLowerCase().includes(q);
    const matchC = !council || p.council === council;
    return matchQ && matchC;
  });

  const tenementsForSelected = selected
    ? data.tenements.filter((t) =>
        t.intersectsAssessmentNumbers.includes(selected.assessmentNumber),
      )
    : [];
  const ownersForSelected = selected
    ? data.owners.filter((o) => selected.ownerIds.includes(o.ownerId))
    : [];

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <h1 className="text-xl font-semibold text-ink-900">Properties</h1>
          <div className="text-sm text-ink-500">
            {data.properties.length} total · {data.councils.length} councils
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* List */}
          <div className="w-[420px] border-r border-ink-200 bg-white flex flex-col">
            <div className="p-3 space-y-2 border-b border-ink-200">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-ink-400" />
                <input
                  className="input pl-9"
                  placeholder="Search address, suburb, assessment…"
                  aria-label="Search properties by address, suburb, or assessment number"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                className="input"
                aria-label="Filter by council"
                value={council}
                onChange={(e) => setCouncil(e.target.value)}
              >
                <option value="">All councils</option>
                {data.councils.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center text-ink-500">
                  <div className="text-sm font-medium">No properties found</div>
                  <div className="text-xs mt-1">Try adjusting your search or filters</div>
                </div>
              )}
              {filtered.map((p) => {
                const isMining = data.tenements.some((t) =>
                  t.intersectsAssessmentNumbers.includes(p.assessmentNumber),
                );
                return (
                  <button
                    key={p.assessmentNumber}
                    onClick={() => setSelected(p)}
                    className={`w-full text-left px-4 py-3 border-b border-ink-100 hover:bg-ink-50 ${
                      selected?.assessmentNumber === p.assessmentNumber
                        ? "bg-accent-50"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm text-ink-900">
                        {p.address}
                      </div>
                      {isMining && (
                        <span className="badge badge-warn text-[10px]">Tenement</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">
                      {p.suburb}, {p.state} {p.postcode}
                    </div>
                    <div className="text-xs text-ink-500 mt-1 flex gap-3">
                      <span>
                        <code className="text-accent-700">{p.assessmentNumber}</code>
                      </span>
                      <span>{p.landUse}</span>
                      <span className={p.balance > 0 ? "text-warn-700" : ""}>
                        {p.balance !== 0 ? formatAud(p.balance) : "—"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail */}
          <div className="flex-1 overflow-y-auto bg-ink-50 p-6">
            {!selected ? (
              <div className="h-full flex items-center justify-center text-ink-400 text-sm">
                Select a property to view details
              </div>
            ) : (
              <PropertyDetail
                property={selected}
                owners={ownersForSelected}
                tenements={tenementsForSelected}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function PropertyDetail({
  property: p,
  owners,
  tenements,
}: {
  property: Property;
  owners: Owner[];
  tenements: Tenement[];
}) {
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="card p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4 text-ink-500" />
              <code className="text-sm text-accent-700 font-mono">
                {p.assessmentNumber}
              </code>
              <span className="badge badge-neutral">{p.landUse}</span>
              {p.balance > 0 && <span className="badge badge-warn">Overdue</span>}
              {p.paymentArrangement && (
                <span className="badge badge-success">Arrangement</span>
              )}
            </div>
            <div className="text-lg font-semibold text-ink-900">{p.address}</div>
            <div className="text-sm text-ink-500 flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {p.suburb}, {p.state} {p.postcode}
            </div>
          </div>
          <div className="text-right">
            <div className="label">Balance</div>
            <div
              className={`text-2xl font-semibold ${
                p.balance > 0 ? "text-warn-700" : "text-success-700"
              }`}
            >
              {formatAud(p.balance)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-ink-100">
          <div>
            <div className="label">Valuation</div>
            <div className="text-sm font-medium">{formatAud(p.valuation)}</div>
          </div>
          <div>
            <div className="label">Annual rates</div>
            <div className="text-sm font-medium">
              {p.annualRates ? formatAud(p.annualRates) : "—"}
            </div>
          </div>
          <div>
            <div className="label">Last payment</div>
            <div className="text-sm font-medium">
              {p.lastPaymentDate
                ? `${formatAud(p.lastPaymentAmount ?? 0)} on ${p.lastPaymentDate}`
                : "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="label mb-2">Owners</div>
        <div className="space-y-3">
          {owners.map((o) => (
            <div
              key={o.ownerId}
              className="border-l-2 border-accent-300 pl-3 text-sm"
            >
              <div className="font-medium text-ink-900">
                {o.name}
                {o.abn && <span className="text-ink-400 ml-2 font-normal">ABN {o.abn}</span>}
              </div>
              <div className="text-ink-600">{o.postalAddress}</div>
              <div className="text-ink-500 text-xs mt-0.5">
                {o.phone ?? "no phone"} · {o.email ?? "no email"} · since {o.ownerSince}
              </div>
            </div>
          ))}
        </div>
      </div>

      {tenements.length > 0 && (
        <div className="card p-5 border-warn-500/30 bg-warn-50/30">
          <div className="flex items-center justify-between mb-2">
            <div className="label text-warn-700">Mining tenement coverage</div>
            <span className="badge badge-warn">DMIRS register</span>
          </div>
          <div className="space-y-2">
            {tenements.map((t) => (
              <div
                key={t.tenementId}
                className="text-sm border-l-2 border-warn-500 pl-3"
              >
                <div className="flex items-center gap-2">
                  <code className="text-accent-700 font-mono font-medium">
                    {t.tenementId}
                  </code>
                  <span className="badge badge-neutral">{t.status}</span>
                  {t.isProducing && (
                    <span className="badge badge-success">Producing</span>
                  )}
                </div>
                <div className="text-ink-700 mt-0.5">
                  Holder: {t.holder}
                  {t.holderAbn && (
                    <span className="text-ink-400"> · ABN {t.holderAbn}</span>
                  )}
                </div>
                <div className="text-ink-500 text-xs">
                  {t.commodity.join(" · ")} · {t.areaHectares.toLocaleString()} ha · expires{" "}
                  {t.expiryDate}
                </div>
              </div>
            ))}
          </div>
          <a
            href={`/recovery/${p.assessmentNumber}`}
            className="btn-primary mt-4"
          >
            Generate evidence pack →
          </a>
        </div>
      )}

      {p.notes.length > 0 && (
        <div className="card p-5">
          <div className="label mb-2">Officer notes</div>
          <ul className="text-sm text-ink-700 space-y-1 list-disc ml-4">
            {p.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-ink-200 flex items-center justify-between">
          <div className="label">Location & coverage</div>
          <span className="text-xs text-ink-500">
            Cadastral · DMIRS tenement overlay
          </span>
        </div>
        <div className="h-[380px]">
          <PortfolioMap
            properties={[p]}
            tenements={tenements}
            centre={[p.lat, p.lng]}
            zoom={tenements.length ? 13 : 16}
            highlightAssessment={p.assessmentNumber}
            showAerial={tenements.length > 0}
          />
        </div>
      </div>
    </div>
  );
}
