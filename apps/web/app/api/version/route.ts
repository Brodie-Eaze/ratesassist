/**
 * Version probe.
 *
 * Returns service identity + build metadata so an operator can confirm
 * which commit is live without shelling into the container.
 *
 * gitSha resolution order:
 *   1. VERCEL_GIT_COMMIT_SHA (Vercel injects at build time)
 *   2. GIT_SHA / COMMIT_SHA (manual override)
 *   3. `git rev-parse HEAD` at request time, with try/catch fallback
 *      to "unknown" so the route NEVER throws.
 */

import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VersionPayload = {
  name: string;
  version: string;
  gitSha: string;
  builtAt: string;
};

let cached: VersionPayload | null = null;

function readVersion(): string {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readGitSha(): string {
  const fromEnv =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_SHA ??
    process.env.COMMIT_SHA;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // F-009 mitigation (pen-test): refuse to fork `git rev-parse HEAD`
  // in production. In Vercel/Railway containers there is no .git
  // directory anyway, so the call would always throw — and an
  // adversary probing /api/version would get cheap CPU fork-DoS.
  if (process.env.NODE_ENV === "production") return "unknown";
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

function build(): VersionPayload {
  if (cached) return cached;
  cached = {
    name: "ratesassist-web",
    version: readVersion(),
    gitSha: readGitSha(),
    builtAt: process.env.BUILT_AT ?? new Date().toISOString(),
  };
  return cached;
}

// Resolve the version payload eagerly at module-load so the first
// request doesn't pay the `git rev-parse` / fs-read cost, and so
// container cold-start instrumentation can see a stable `gitSha`.
const eagerPayload: VersionPayload = build();

export function GET(): NextResponse {
  return NextResponse.json(eagerPayload);
}
