"use client";

/**
 * Login page.
 *
 * Dev mode: a tenant + role picker that POSTs to /api/auth/login. Australian
 * English copy throughout. Production mode: a single "Continue with
 * Microsoft Entra" button that navigates to /api/auth/sso/start, which
 * begins the WorkOS OAuth dance.
 *
 * The page itself is in the PUBLIC_HTML_PATHS allowlist in middleware.ts,
 * so it renders even without a session.
 *
 * Error display: /api/auth/callback redirects here with ?error=callback_failed
 * (token exchange or state-mismatch) or ?error=sso_not_configured (the env
 * vars haven't been wired). We surface both to the user with a sensible
 * fallback message.
 */

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ALL_ROLES, type Role } from "@ratesassist/contract";

const TENANTS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "TPS", label: "Shire of Tom Price (TPS) — demo" },
  { id: "ASH", label: "Shire of Ashburton (ASH)" },
  { id: "ESH", label: "Shire of East Pilbara (ESH)" },
  { id: "KAL", label: "City of Kalgoorlie-Boulder (KAL)" },
];

function isProdBuild(): boolean {
  // NEXT_PUBLIC_NODE_ENV would be ideal but isn't set; fall back to
  // process.env.NODE_ENV which Next inlines at build time.
  return process.env.NODE_ENV === "production";
}

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  callback_failed:
    "We couldn't complete sign-in. Please try again. If the issue continues, contact your council's IT helpdesk.",
  sso_not_configured:
    "Single sign-on isn't configured for this environment yet. Contact the RatesAssist operator.",
};

function LoginForm(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get("next") ?? "/";
  const errorCode = params?.get("error") ?? null;

  const [tenantId, setTenantId] = useState<string>("TPS");
  const [role, setRole] = useState<Role>("rates_officer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    errorCode ? (ERROR_MESSAGES[errorCode] ?? `Sign-in error: ${errorCode}`) : null,
  );

  useEffect(() => {
    // Clear inline form-error state when the user changes their picker
    // selection in dev. The query-string error banner persists.
    if (!errorCode) setError(null);
  }, [tenantId, role, errorCode]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId, role }),
        credentials: "include",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? `Sign-in failed (${r.status}).`);
        setSubmitting(false);
        return;
      }
      router.replace(next);
    } catch (err) {
      setError(`Network error: ${(err as Error).message}`);
      setSubmitting(false);
    }
  }

  if (isProdBuild()) {
    // The href is a real navigation (not router.push) so the browser
    // sends the cookie when WorkOS bounces back to /api/auth/callback.
    const ssoHref =
      next && next !== "/"
        ? `/api/auth/sso/start?next=${encodeURIComponent(next)}`
        : "/api/auth/sso/start";
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          RatesAssist uses your council&apos;s single sign-on. Continue with
          your work account to sign in.
        </p>
        {error && (
          <div
            role="alert"
            className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </div>
        )}
        <a
          href={ssoHref}
          className="inline-flex items-center justify-center w-full rounded-md bg-blue-700 px-4 py-2 text-white font-medium hover:bg-blue-800"
        >
          Continue with Microsoft Entra
        </a>
        <p className="text-xs text-gray-500">
          Trouble signing in? Contact your council&apos;s IT helpdesk.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-gray-700">
        Development sign-in. Pick a tenant and a role to issue a stub
        session. In production this screen is replaced by the council&apos;s
        SSO (WorkOS &rarr; Microsoft Entra).
      </p>

      <label className="block text-sm">
        <span className="block text-gray-700 mb-1">Council (tenant)</span>
        <select
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {TENANTS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="block text-gray-700 mb-1">Role</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-blue-700 px-4 py-2 text-white font-medium hover:bg-blue-800 disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in (dev)"}
      </button>
    </form>
  );
}

export default function LoginPage(): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow p-6">
        <h1 className="text-xl font-semibold mb-1">RatesAssist</h1>
        <p className="text-sm text-gray-500 mb-4">Sign in to continue.</p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
