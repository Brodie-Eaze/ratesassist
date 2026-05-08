"use client";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";

export type FetchState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ok"; data: T; error: null }
  | { status: "error"; data: null; error: string };

export function useFetch<T = unknown>(url: string): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    status: "loading",
    data: null,
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setState({ status: "loading", data: null, error: null });
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return (await r.json()) as T;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ok", data, error: null });
      })
      .catch((e) => {
        if (cancelled || ctrl.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ status: "error", data: null, error: msg });
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [url]);
  return state;
}

export function LoadingState() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center text-ink-500">
        Loading…
      </main>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center">
        <div className="card p-6 max-w-md text-center">
          <div className="text-critical-700 font-medium mb-1">
            Failed to load
          </div>
          <div className="text-sm text-ink-600">{message}</div>
        </div>
      </main>
    </div>
  );
}
