/**
 * RatesAssist E2E smoke test.
 *
 * Spawns `next dev`, hits every page + API route, exercises rate limits,
 * verifies basic shapes and HTTP statuses, then tears the server down.
 *
 * Usage:  npm run smoke
 * Env:    RA_SMOKE_PORT (default 3000), ANTHROPIC_API_KEY (optional)
 *
 * Constraint: under 90s wall time. No Playwright. Plain fetch + retry.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

type Result = { name: string; status: "PASS" | "FAIL" | "SKIP"; detail?: string };
const results: Result[] = [];

let PORT = Number(process.env.RA_SMOKE_PORT ?? 0);
let BASE = ``;
const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

function pass(name: string) { results.push({ name, status: "PASS" }); console.log(`  PASS  ${name}`); }
function fail(name: string, detail: string) { results.push({ name, status: "FAIL", detail }); console.log(`  FAIL  ${name} — ${detail}`); }
function skip(name: string, detail: string) { results.push({ name, status: "SKIP", detail }); console.log(`  SKIP  ${name} — ${detail}`); }

async function pickFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, () => {
      const a = s.address();
      if (a && typeof a === "object") {
        const p = a.port;
        s.close(() => resolve(p));
      } else reject(new Error("no addr"));
    });
  });
}

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) return;
    } catch { /* ECONNREFUSED while warming */ }
    await sleep(500);
  }
  throw new Error(`dev server not ready after ${timeoutMs}ms`);
}

async function check(
  name: string,
  fn: () => Promise<void> | void,
): Promise<void> {
  try { await fn(); pass(name); }
  catch (e) { fail(name, (e as Error).message); }
}

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function getJson(path: string, init?: RequestInit): Promise<{ status: number; body: unknown; raw: string }> {
  // Inject a same-origin `Origin` header on mutating verbs to satisfy the
  // SEC-014 CSRF middleware. The smoke harness drives the local dev server
  // as a first-party caller, so this is the honest representation.
  const method = (init?.method ?? "GET").toUpperCase();
  const needsOrigin = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const headers = new Headers(init?.headers);
  if (needsOrigin && !headers.has("origin")) headers.set("origin", BASE);
  const merged: RequestInit = { ...init, headers };
  const r = await fetch(`${BASE}${path}`, merged);
  const raw = await r.text();
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { body = raw; }
  return { status: r.status, body, raw };
}

const PAGE_ROUTES = [
  "/",
  "/intel", "/reconciliation", "/activity", "/recovery", "/signals",
  "/discovery", "/certificates", "/citizen", "/tenants", "/connections",
  "/map", "/aerial", "/properties",
];

async function main(): Promise<number> {
  if (!PORT) PORT = await pickFreePort();
  BASE = `http://127.0.0.1:${PORT}`;
  console.log(`[smoke] starting next dev on port ${PORT}`);
  // Run `next dev` directly from the workspace's local bin to avoid the
  // hard-coded `-p 3000` in apps/web/package.json's dev script.
  // Run `next dev` directly via the hoisted root bin to avoid the hard-coded
  // `-p 3000` in apps/web/package.json's dev script. cwd is apps/web so Next
  // finds the right project.
  // Try workspace-local then root-hoisted bin (npm sometimes hoists, sometimes
  // installs into the workspace).
  const fs = await import("node:fs");
  const candidates = [
    `${process.cwd()}/apps/web/node_modules/.bin/next`,
    `${process.cwd()}/node_modules/.bin/next`,
  ];
  const nextBin = candidates.find((p) => fs.existsSync(p)) ?? candidates[0]!;
  const child: ChildProcessWithoutNullStreams = spawn(
    nextBin,
    ["dev", "-p", String(PORT)],
    {
      cwd: `${process.cwd()}/apps/web`,
      env: {
        ...process.env,
        PORT: String(PORT),
        // Round 4: every /api/* requires auth. Mint a stub session for the
        // duration of the smoke run so existing assertions keep working.
        // council_admin grants write.user_management so the smoke run can
        // exercise POST /api/tenants. The role-name shortcut is honoured by
        // parseDevAutologin (auth-stub.ts).
        RA_DEV_AUTOLOGIN_SESSION:
          process.env.RA_DEV_AUTOLOGIN_SESSION ?? "council_admin",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let serverErr = "";
  child.stdout.on("data", (b) => { const s = b.toString(); if (process.env.RA_SMOKE_VERBOSE) process.stdout.write(s); });
  child.stderr.on("data", (b) => { const s = b.toString(); serverErr += s; if (process.env.RA_SMOKE_VERBOSE) process.stderr.write(s); });

  try {
    await waitForReady(60_000);
    console.log(`[smoke] server ready, running assertions`);
  } catch (e) {
    fail("dev server start", `${(e as Error).message}\n${serverErr.slice(-500)}`);
    child.kill("SIGTERM");
    return 1;
  }

  // --- Page routes ---
  for (const route of PAGE_ROUTES) {
    await check(`GET ${route} (page)`, async () => {
      const r = await fetch(`${BASE}${route}`);
      expect(r.status === 200, `status ${r.status}`);
      const text = await r.text();
      expect(text.length > 1000, `content length ${text.length} <= 1000`);
    });
  }

  // --- API: GET /api/data (right-sized; opt-in to legacy properties array) ---
  await check("GET /api/data", async () => {
    const { status, body } = await getJson("/api/data?include=properties");
    expect(status === 200, `status ${status}`);
    const b = body as { properties?: unknown[] };
    expect(Array.isArray(b.properties) && b.properties.length > 0, `properties not a non-empty array`);
  });

  // --- API: GET /api/signals ---
  await check("GET /api/signals", async () => {
    const { status, body } = await getJson("/api/signals");
    expect(status === 200, `status ${status}`);
    // signals route returns { catalogue: [...], contributionByCandidate }
    const ok = Array.isArray(body) ||
      (typeof body === "object" && body !== null && (
        Array.isArray((body as { signals?: unknown }).signals) ||
        Array.isArray((body as { catalogue?: unknown }).catalogue)
      ));
    expect(ok, `expected array, {signals:[]} or {catalogue:[]}, got ${JSON.stringify(body).slice(0, 120)}`);
  });

  // --- API: GET /api/grants ---
  await check("GET /api/grants?sinceDays=30", async () => {
    const { status, body } = await getJson("/api/grants?sinceDays=30");
    expect(status === 200, `status ${status}`);
    const b = body as { ok?: boolean; data?: { grants?: unknown[]; source?: string } };
    expect(b.ok === true, `ok != true`);
    expect(Array.isArray(b.data?.grants), `grants not an array`);
  });

  // --- API: GET /api/grants/[tenementId] (per-grant briefing) ---
  // Note: the seeded fixture id `M  4701569` is in the offline fallback set;
  // when SLIP is live and returns its own corpus this id may legitimately
  // not be found. Tolerate either ok+payload (seeded/cached path) or a
  // structured 404 (live path doesn't carry the id) — both are correct.
  await check("GET /api/grants/M%20%204701569 (detail)", async () => {
    const { status, body } = await getJson(
      "/api/grants/M%20%204701569?sinceDays=365",
    );
    if (status === 404) return; // Live SLIP doesn't carry the seeded id; acceptable.
    expect(status === 200, `status ${status}`);
    const b = body as {
      ok?: boolean;
      data?: {
        grant?: { tenementId?: string };
        intersectingParcels?: unknown[];
        cadastreSource?: string;
      };
    };
    expect(b.ok === true, `ok != true`);
    expect(typeof b.data?.grant?.tenementId === "string", `missing tenementId`);
    expect(Array.isArray(b.data?.intersectingParcels), `parcels not array`);
    expect(typeof b.data?.cadastreSource === "string", `missing cadastreSource`);
  });

  // --- /alerts is a legacy redirect into Recovery with the recently_granted filter ---
  await check("GET /alerts redirects to /recovery?signal=recently_granted", async () => {
    const r = await fetch(`${BASE}/alerts`, { redirect: "manual" });
    expect(
      r.status === 307 || r.status === 308 || r.status === 302,
      `expected redirect status, got ${r.status}`,
    );
    const loc = r.headers.get("location") ?? "";
    expect(
      loc.includes("/recovery") && loc.includes("signal=recently_granted"),
      `expected redirect to /recovery?signal=recently_granted, got ${loc}`,
    );
  });

  // --- Page: /alerts/[tenementId] (server renders HTML) ---
  await check("GET /alerts/M%20%204701569 (page)", async () => {
    const r = await fetch(`${BASE}/alerts/M%20%204701569`);
    expect(r.status === 200, `status ${r.status}`);
    const html = await r.text();
    expect(html.length > 100, `empty page body`);
  });

  // --- API: GET /api/discovery ---
  await check("GET /api/discovery", async () => {
    const { status, body } = await getJson("/api/discovery");
    expect(status === 200, `status ${status}`);
    const ok = Array.isArray(body) ||
      (typeof body === "object" && body !== null);
    expect(ok, `expected array or object, got ${typeof body}`);
  });

  // --- API: POST /api/tools/search_property ---
  await check("POST /api/tools/search_property (Whim)", async () => {
    const { status, body } = await getJson("/api/tools/search_property", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { query: "Whim" } }),
    });
    expect(status === 200, `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    const b = body as { ok?: boolean };
    expect(b.ok === true, `ok != true: ${JSON.stringify(body).slice(0, 200)}`);
  });

  // --- API: POST /api/tools/find_mining_mismatches ---
  await check("POST /api/tools/find_mining_mismatches", async () => {
    const { status, body } = await getJson("/api/tools/find_mining_mismatches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });
    expect(status === 200, `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    const b = body as { ok?: boolean; data?: unknown; output?: string };
    expect(b.ok === true, `ok != true: ${JSON.stringify(body).slice(0, 300)}`);
    // candidates may be in data.candidates or rendered in output text
    const dataObj = b.data as { candidates?: unknown[] } | undefined;
    const candidates = dataObj?.candidates;
    const hasCandidates = Array.isArray(candidates) ? candidates.length > 0 :
      typeof b.output === "string" && b.output.length > 0;
    expect(hasCandidates, `no candidates in response`);
  });

  // --- API: POST /api/tools/generate_evidence_pack ---
  await check("POST /api/tools/generate_evidence_pack", async () => {
    const { status, body } = await getJson("/api/tools/generate_evidence_pack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { assessmentNumber: "TPS-1102-44" } }),
    });
    expect(status === 200, `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    const b = body as { ok?: boolean; output?: string; data?: unknown };
    expect(b.ok === true, `ok != true: ${JSON.stringify(body).slice(0, 300)}`);
    const md = (b.output ?? "") + JSON.stringify(b.data ?? "");
    expect(md.length > 50, `evidence content too short`);
  });

  // --- API: POST /api/tools/<unknown> ---
  await check("POST /api/tools/totally_fake_tool (unknown)", async () => {
    const { status, body } = await getJson("/api/tools/totally_fake_tool", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });
    expect(status === 404 || status === 400, `expected 404/400, got ${status}`);
    const b = body as { ok?: boolean; code?: string };
    expect(b.ok === false, `ok should be false`);
    expect(b.code === "not_found" || b.code === "invalid_input", `code=${b.code}`);
  });

  // --- API: malformed input ---
  await check("POST /api/tools/search_property (malformed)", async () => {
    const { status, body } = await getJson("/api/tools/search_property", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { query: 12345 } }), // wrong type
    });
    expect(status === 400, `expected 400, got ${status}`);
    const b = body as { ok?: boolean; code?: string };
    expect(b.code === "invalid_input", `code=${b.code}`);
  });

  // --- API: spatial layer (GET, not POST per real impl) ---
  await check("GET /api/spatial/miningTenements (bbox)", async () => {
    const bbox = "117.7,-22.8,117.9,-22.6"; // around Tom Price
    const { status, body } = await getJson(`/api/spatial/miningTenements?bbox=${bbox}&limit=10`);
    // Either live (200) or upstream failed (502). Both acceptable since offline env may block ArcGIS.
    expect(status === 200 || status === 502, `status ${status}`);
    const b = body as { ok?: boolean; source?: string };
    if (status === 200) {
      expect(b.ok === true, `ok != true on 200`);
    } else {
      // 502 is the documented fall-through when SLIP unreachable
      expect(b.ok === false, `502 should have ok:false`);
    }
  });

  // --- API: chat without key (mock mode) ---
  if (HAS_KEY) {
    skip("POST /api/chat (mock-mode no_key)", "ANTHROPIC_API_KEY is set; live mode active");
  } else {
    await check("POST /api/chat (mock-mode no_key)", async () => {
      const { status, body } = await getJson("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ history: [], message: "Hello" }),
      });
      expect(status === 200, `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
      const b = body as { modelUsed?: { kind?: string; reason?: string }; content?: string };
      expect(b.modelUsed?.kind === "mock", `modelUsed.kind=${b.modelUsed?.kind}`);
      expect(b.modelUsed?.reason === "no_key", `modelUsed.reason=${b.modelUsed?.reason}`);
      expect(typeof b.content === "string" && b.content.length > 0, `empty content`);
    });
  }

  // --- Round 4B: REST entity routes ---
  await check("GET /api/properties/<sample> (Round 4B)", async () => {
    const seed = await getJson(`/api/data`);
    const seedBody = seed.body as { mismatches?: { property?: { assessmentNumber?: string } }[] };
    const an =
      seedBody.mismatches?.find((m) => m.property?.assessmentNumber)?.property
        ?.assessmentNumber ?? null;
    if (an === null) return;
    const { status, body } = await getJson(
      `/api/properties/${encodeURIComponent(an)}`,
    );
    expect(status === 200, `status ${status}`);
    const b = body as { ok?: boolean; data?: { property?: { assessmentNumber?: string } } };
    expect(b.ok === true, `ok != true`);
    expect(b.data?.property?.assessmentNumber === an, `assessment mismatch`);
  });

  await check("GET /api/owners/owner-not-real -> 404 (Round 4B)", async () => {
    const { status, body } = await getJson(`/api/owners/owner-not-real`);
    expect(status === 404, `status ${status}`);
    const b = body as { code?: string };
    expect(b.code === "not_found", `code=${b.code}`);
  });

  await check("GET /api/tenements/M%20%204701569 (Round 4B)", async () => {
    const { status, body } = await getJson(
      `/api/tenements/M%20%204701569?sinceDays=365`,
    );
    expect(status === 200 || status === 404 || status === 502, `status ${status}`);
    const b = body as { ok?: boolean };
    if (status === 200) expect(b.ok === true, `ok != true`);
  });

  await check("GET /api/recovery/candidates (Round 4B)", async () => {
    const { status, body } = await getJson(`/api/recovery/candidates?limit=5`);
    expect(status === 200, `status ${status}`);
    const b = body as {
      ok?: boolean;
      data?: { candidates?: unknown[] };
      pagination?: { limit?: number };
    };
    expect(b.ok === true, `ok != true`);
    expect(Array.isArray(b.data?.candidates), `candidates not array`);
    expect(b.pagination?.limit === 5, `limit not echoed`);
  });

  await check("GET /api/recovery/candidates/NOT-REAL -> 404 (Round 4B)", async () => {
    const { status } = await getJson(`/api/recovery/candidates/NOT-REAL-XYZ`);
    expect(status === 404, `status ${status}`);
  });

  await check("POST /api/exports/csv?type=candidates (Round 4B)", async () => {
    const r = await fetch(`${BASE}/api/exports/csv?type=candidates`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: "{}",
    });
    expect(r.status === 200, `status ${r.status}`);
    expect(
      (r.headers.get("content-type") ?? "").includes("text/csv"),
      `content-type=${r.headers.get("content-type")}`,
    );
  });

  await check("GET /api/openapi.json (Round 4B)", async () => {
    const { status, body } = await getJson(`/api/openapi.json`);
    expect(status === 200, `status ${status}`);
    const b = body as { openapi?: string; paths?: Record<string, unknown> };
    expect(b.openapi === "3.1.0", `openapi=${b.openapi}`);
    expect(
      Object.keys(b.paths ?? {}).includes("/api/properties/{assessmentNumber}"),
      `missing property path`,
    );
  });

  // --- POST /api/tenants two-phase add_council ---
  await check("POST /api/tenants add_council (two-phase)", async () => {
    const body = {
      code: "SMK",
      name: "Shire of Smoke Test",
      state: "WA" as const,
      centerLat: -31.5,
      centerLng: 117.0,
      population: 1234,
      rateableProperties: 567,
      rateRevenue: 1_234_567,
      confirm: false,
    };
    const preview = await getJson("/api/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(preview.status === 200, `preview status ${preview.status}: ${preview.raw.slice(0, 200)}`);
    const previewBody = preview.body as { ok?: boolean; commitToken?: string };
    expect(previewBody.ok === true, `preview ok != true`);
    expect(typeof previewBody.commitToken === "string", `no commitToken`);
    const confirm = await getJson("/api/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...body,
        confirm: true,
        commitToken: previewBody.commitToken,
      }),
    });
    expect(confirm.status === 200, `confirm status ${confirm.status}: ${confirm.raw.slice(0, 200)}`);
    const confirmBody = confirm.body as { ok?: boolean; mutated?: boolean };
    expect(confirmBody.ok === true, `confirm ok != true`);
    expect(confirmBody.mutated === true, `confirm mutated != true`);
  });

  // --- Rate limit: hammer 70x within the 60s window ---
  await check("rate-limit /api/tools/search_property (>=1 of 70 → 429)", async () => {
    const N = 70;
    const reqs: Promise<Response>[] = [];
    for (let i = 0; i < N; i++) {
      reqs.push(fetch(`${BASE}/api/tools/search_property`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ input: { query: "x" } }),
      }));
    }
    const responses = await Promise.all(reqs);
    const codes = responses.map(r => r.status);
    const got429 = codes.filter(c => c === 429).length;
    expect(got429 >= 1, `no 429 in ${N} reqs; codes=${JSON.stringify(codes.slice(0, 10))}…`);
  });

  // --- Teardown ---
  console.log(`[smoke] killing dev server`);
  child.kill("SIGTERM");
  await sleep(500);
  if (!child.killed) child.kill("SIGKILL");

  // --- Summary ---
  const passes = results.filter(r => r.status === "PASS").length;
  const fails = results.filter(r => r.status === "FAIL").length;
  const skips = results.filter(r => r.status === "SKIP").length;
  console.log(`\n=== SMOKE SUMMARY ===`);
  console.log(`  PASS:  ${passes}`);
  console.log(`  FAIL:  ${fails}`);
  console.log(`  SKIP:  ${skips}`);
  if (fails > 0) {
    console.log(`\nFailures:`);
    for (const r of results.filter(r => r.status === "FAIL")) {
      console.log(`  - ${r.name}\n      ${r.detail}`);
    }
  }
  return fails === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => { console.error("[smoke] fatal:", e); process.exit(1); },
);
