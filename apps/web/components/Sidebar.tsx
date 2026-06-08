"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquare,
  Search,
  BarChart3,
  Users,
  FileText,
  Settings,
  LogOut,
  MapPin,
  Activity,
  Wallet,
  History,
  FileBadge,
  Eye,
  Sparkles,
  Cpu,
  Building,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Wordmark } from "./Brand";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: typeof MessageSquare;
  product: "Assist" | "Recovery" | "Intel" | "Chat" | null;
  group?: string;
};

const NAV: NavItem[] = [
  { href: "/",                label: "Officer Chat",   icon: MessageSquare, product: "Assist",   group: "Workspace" },
  { href: "/properties",      label: "Properties",     icon: Search,        product: "Assist",   group: "Workspace" },
  { href: "/map",             label: "Portfolio Map",  icon: MapPin,        product: "Assist",   group: "Workspace" },
  { href: "/recovery",        label: "Recovery Audit", icon: FileText,      product: "Recovery", group: "Recovery" },
  { href: "/discovery",       label: "Discovery Engine",icon: Cpu,          product: "Recovery", group: "Recovery" },
  { href: "/signals",         label: "Signal Catalogue",icon: Sparkles,     product: "Recovery", group: "Recovery" },
  { href: "/aerial",          label: "Aerial Evidence",icon: Eye,           product: "Recovery", group: "Recovery" },
  { href: "/intel",           label: "Dashboards",     icon: BarChart3,     product: "Intel",    group: "Intel" },
  { href: "/reconciliation",  label: "Reconciliation", icon: Wallet,        product: "Assist",   group: "Operations" },
  { href: "/certificates",    label: "Certificates",   icon: FileBadge,     product: "Assist",   group: "Operations" },
  { href: "/activity",        label: "Activity Log",   icon: History,       product: null,       group: "Operations" },
  { href: "/tenants",         label: "Tenants",        icon: Building,      product: null,       group: "Admin" },
  { href: "/connections",     label: "Connections",    icon: Activity,      product: null,       group: "Admin" },
  { href: "/citizen",         label: "Citizen Chat",   icon: Users,         product: "Chat",     group: "Public" },
];

const GROUPS = ["Workspace", "Recovery", "Intel", "Operations", "Admin", "Public"];

/**
 * Fetch the active tenant's onboarding state — true when no rating roll has
 * been imported yet (property count = 0 for the active tenant). Best-effort:
 * a fetch failure simply hides the onboarding link.
 */
function useOnboardingNeeded(): { code: string | null; needed: boolean } {
  const [state, setState] = useState<{ code: string | null; needed: boolean }>({
    code: null,
    needed: false,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/me");
        if (!r.ok) return;
        const me = (await r.json()) as { tenantId?: string };
        const code = me.tenantId ?? null;
        if (!code) return;
        // Use the tools route to ask `list_properties` how many rows the
        // active council has. A 0-result response → onboarding is incomplete.
        const p = await fetch(`/api/tools/list_properties`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: { council: code, limit: 1 } }),
        });
        if (!p.ok) return;
        const body = (await p.json()) as {
          ok?: boolean;
          data?: { properties?: unknown[] };
        };
        if (cancelled) return;
        const properties = body.data?.properties;
        const count = Array.isArray(properties) ? properties.length : 0;
        setState({ code, needed: count === 0 });
      } catch {
        /* hide on error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

type MeSession = { displayName: string; email: string; roles: string[] };
function useMe(): MeSession | null {
  const [me, setMe] = useState<MeSession | null>(null);
  useEffect(() => {
    fetch("/api/me")
      .then(r => r.ok ? r.json() : null)
      .then((body: { ok?: boolean; session?: MeSession } | null) => {
        if (body?.ok && body.session) setMe(body.session);
      })
      .catch(() => {});
  }, []);
  return me;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const onboarding = useOnboardingNeeded();
  const me = useMe();

  return (
    <aside className="w-60 bg-white border-r border-ink-200 flex flex-col">
      <div className="px-5 py-5 border-b border-ink-200">
        <Wordmark size="md" />
        <div className="text-[10px] uppercase tracking-widest text-ink-400 mt-1">
          Officer console
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-3 overflow-y-auto">
        {onboarding.needed && onboarding.code && (
          <div>
            <div className="px-3 mb-1 text-[10px] uppercase tracking-widest text-accent-600 font-medium">
              Get started
            </div>
            <Link
              href={`/onboarding/${onboarding.code}`}
              className={cn(
                "flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors",
                pathname.startsWith("/onboarding")
                  ? "bg-accent-50 text-accent-700 font-medium"
                  : "text-accent-700 hover:bg-accent-50",
              )}
            >
              <Upload className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">Onboarding</span>
              <span className="text-[9px] uppercase tracking-widest text-accent-500">
                New
              </span>
            </Link>
          </div>
        )}
        {GROUPS.map((g) => {
          const items = NAV.filter((n) => n.group === g);
          if (!items.length) return null;
          return (
            <div key={g}>
              <div className="px-3 mb-1 text-[10px] uppercase tracking-widest text-ink-400 font-medium">
                {g}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active =
                    pathname === item.href ||
                    (item.href !== "/" && pathname.startsWith(item.href));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors",
                        active
                          ? "bg-accent-50 text-accent-700 font-medium"
                          : "text-ink-700 hover:bg-ink-100",
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.product && (
                        <span className="text-[9px] uppercase tracking-widest text-ink-400">
                          {item.product}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-ink-200 space-y-1">
        <button className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm text-ink-700 hover:bg-ink-100">
          <Settings className="w-4 h-4 shrink-0" />
          <span>Settings</span>
        </button>
        <button
          onClick={() => {
            fetch("/api/auth/logout", { method: "POST" })
              .then(() => router.push("/login"))
              .catch(() => router.push("/login"));
          }}
          className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm text-ink-700 hover:bg-ink-100"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Sign out</span>
        </button>
        <div className="px-3 pt-3 border-t border-ink-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center text-xs font-semibold">
              {me?.displayName?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="text-xs">
              <div className="font-medium text-ink-900">{me?.displayName ?? "Loading…"}</div>
              <div className="text-ink-500 truncate max-w-[120px]">{me?.email ?? ""}</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
