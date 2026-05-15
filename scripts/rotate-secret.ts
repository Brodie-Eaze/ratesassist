#!/usr/bin/env tsx
/**
 * scripts/rotate-secret.ts
 *
 * Generates a fresh 64-byte hex secret for RA_AUTH_SECRET. Prints it to
 * stdout. Does NOT write to any file — the operator copies the value into
 * the production environment (Vercel project settings, Render env vars,
 * AWS Secrets Manager, etc.).
 *
 * Usage:
 *   npm run rotate-secret
 *
 * Operational impact:
 *   - Replacing RA_AUTH_SECRET INVALIDATES every existing session cookie.
 *     Logged-in users will be redirected to /login on their next request.
 *   - Plan a short maintenance window (5-10 minutes) and announce in your
 *     status channel.
 *   - For a zero-downtime rotation, the codebase would need dual-secret
 *     support (verify against new + old simultaneously) — not implemented
 *     today. File a ticket if you need it.
 */

import { randomBytes } from "node:crypto";

const SECRET_BYTES = 64;

function main(): void {
  const secret = randomBytes(SECRET_BYTES).toString("hex");

  const sep = "=".repeat(72);
  console.log("");
  console.log(sep);
  console.log("  RA_AUTH_SECRET — fresh value");
  console.log(sep);
  console.log("");
  console.log(`  RA_AUTH_SECRET=${secret}`);
  console.log("");
  console.log(sep);
  console.log("  NEXT STEPS");
  console.log(sep);
  console.log("");
  console.log("  1. Copy the value above into your production environment:");
  console.log("");
  console.log("       Vercel:  Project → Settings → Environment Variables");
  console.log("                Update RA_AUTH_SECRET in all 3 environments");
  console.log("                (Production, Preview, Development), then");
  console.log("                redeploy.");
  console.log("");
  console.log("       Render:  Dashboard → Service → Environment → Edit.");
  console.log("                Render redeploys automatically.");
  console.log("");
  console.log("       Other:   set RA_AUTH_SECRET=<value> and restart all");
  console.log("                Node processes serving apps/web.");
  console.log("");
  console.log("  2. Existing sessions will be INVALIDATED. Logged-in users");
  console.log("     are redirected to /login on their next request. Plan a");
  console.log("     5-10 minute maintenance window and announce it.");
  console.log("");
  console.log("  3. Do NOT commit this value to git. Do NOT echo it into");
  console.log("     .env.local on a shared machine.");
  console.log("");
  console.log(sep);
  console.log("");
}

main();
