import { Sidebar } from "@/components/Sidebar";

/**
 * Route-level loading skeleton for the evidence pack page. The page is a
 * pure async Server Component whose data path can stall 1–5s on a cold
 * Postgres context build; without this file the App Router shows a blank
 * white screen for the whole wait. The skeleton mirrors the page's real
 * structure (header strip → stats card → map panel → signal accordions)
 * so the transition to content doesn't jump.
 */
export default function EvidencePackLoading() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-ink-200 bg-white">
          <div className="h-3 w-24 bg-ink-100 rounded animate-pulse mb-2" />
          <div className="h-6 w-40 bg-ink-100 rounded animate-pulse" />
        </div>
        <div className="flex-1 overflow-y-auto bg-ink-50 p-6">
          <div className="max-w-3xl mx-auto space-y-4">
            {/* Stats card */}
            <div className="card p-4">
              <div className="grid grid-cols-3 gap-4">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <div className="h-3 w-28 bg-ink-100 rounded animate-pulse mb-2" />
                    <div className="h-6 w-20 bg-ink-100 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
            {/* Map panel */}
            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-ink-200">
                <div className="h-3 w-28 bg-ink-100 rounded animate-pulse" />
              </div>
              <div className="h-[480px] bg-ink-100 animate-pulse flex items-center justify-center">
                <span className="text-sm text-ink-400">Loading visual evidence…</span>
              </div>
            </div>
            {/* Signal accordion rows */}
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card p-4">
                  <div className="h-4 w-3/4 bg-ink-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
