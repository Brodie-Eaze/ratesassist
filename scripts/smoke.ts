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
  const r = await fetch(`${BASE}${path}`, init);
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
      env: { ...process.env, PORT: String(PORT) },
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

  // --- API: GET /api/data ---
  await check("GET /api/data", async () => {
    const { status, body } = await getJson("/api/data");
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

  // --- Rate limit: hammer 70x within the 60s window ---
  await check("rate-limit /api/tools/search_property (>=1 of 70 → 429)", async () => {
    const N = 70;
    const reqs: Promise<Response>[] = [];
    for (let i = 0; i < N; i++) {
      reqs.push(fetch(`${BASE}/api/tools/search_property`, {
        method: "POST",
        headers: { "content-type": "application/json" },
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
