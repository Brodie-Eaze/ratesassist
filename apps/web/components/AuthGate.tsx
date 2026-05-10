"use client";

/**
 * AuthGate — client-side wrapper that fetches /api/me and either renders
 * its children or redirects to /login. Provides the current session via
 * React context so descendants don't have to re-fetch.
 *
 * Render contract:
 *   - while loading: returns null (no flash of unauthenticated content)
 *   - 401: navigates to /login?next=<current path>
 *   - 200: renders children with the session in context
 *
 * Middleware already redirects unauthenticated HTML requests to /login,
 * but AuthGate covers the case where the session expires mid-session
 * (e.g. the user keeps a tab open past the 8h TTL).
 */

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

import type { Session, Permission } from "@ratesassist/contract";

type MeResponse = {
  ok: true;
  session: Session;
  permissions: ReadonlyArray<Permission>;
};

type AuthContextValue = {
  session: Session;
  permissions: ReadonlyArray<Permission>;
  hasPermission: (perm: Permission) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      "useAuth must be used inside <AuthGate>. Wrap the page or layout.",
    );
  }
  return ctx;
}

export type AuthGateProps = {
  children: React.ReactNode;
  /** Optional: render this while loading instead of null. */
  fallback?: React.ReactNode;
};

export function AuthGate({ children, fallback = null }: AuthGateProps): JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [state, setState] = useState<
    | { phase: "loading" }
    | { phase: "authed"; data: MeResponse }
    | { phase: "redirecting" }
  >({ phase: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/me", { credentials: "include" });
        if (!alive) return;
        if (r.status === 200) {
          const data = (await r.json()) as MeResponse;
          setState({ phase: "authed", data });
          return;
        }
      } catch {
        /* network error — fall through to redirect */
      }
      if (!alive) return;
      setState({ phase: "redirecting" });
      const next = encodeURIComponent(pathname);
      router.replace(`/login?next=${next}`);
    })();
    return () => {
      alive = false;
    };
  }, [pathname, router]);

  if (state.phase !== "authed") {
    return <>{fallback}</>;
  }

  const { session, permissions } = state.data;
  const value: AuthContextValue = {
    session,
    permissions,
    hasPermission: (p) => permissions.includes(p),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
