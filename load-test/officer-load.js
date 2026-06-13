/**
 * RatesAssist — officer-scale load test (k6).
 *
 * Models the officer workflow shape: read-heavy (dashboard, properties,
 * recovery, signals, activity, reconciliation) with occasional expensive chat,
 * plus cheap unauthenticated liveness. Targets the officer-scale bar from the
 * goal: 5,000 concurrent sustained, 15,000 burst (3x headroom).
 *
 * RUN (do NOT run unattended — this generates real traffic + token spend; it is
 * the queued step Q-ra-loadtest, executed against a deployed ALB after apply):
 *   brew install k6
 *   BASE_URL=https://app.ratesassist.com.au PROFILE=smoke   k6 run load-test/officer-load.js   # sanity first
 *   BASE_URL=https://app.ratesassist.com.au PROFILE=steady  k6 run load-test/officer-load.js   # 5k sustained
 *   BASE_URL=https://app.ratesassist.com.au PROFILE=burst   k6 run load-test/officer-load.js   # 5k -> 15k spike
 *
 * 15k VUs is heavy for a single generator — use k6 Cloud (`k6 cloud`) or several
 * load generators for the burst profile. Start with PROFILE=smoke to validate
 * wiring + the SLO thresholds before the full run.
 *
 * AUTH (the load-test target must allow ONE of these):
 *   AUTH_MODE=login     (default) POST /api/auth/login {tenantId, role} -> cookie.
 *                       Works on a non-prod perf env (the dev stub login refuses
 *                       in NODE_ENV=production).
 *   AUTH_MODE=autologin target deployed with RA_DEMO_AUTOLOGIN=1; middleware
 *                       mints a session per request — no login needed.
 *   AUTH_MODE=cookie    use a pre-captured SESSION_COOKIE env value.
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Trend, Rate } from "k6/metrics";

// ---- config (all via env, with officer-scale defaults) ----------------------
const BASE_URL = (__ENV.BASE_URL || "").replace(/\/$/, "");
const PROFILE = __ENV.PROFILE || "steady";
const TARGET_VUS = Number(__ENV.TARGET_VUS || 5000);
const BURST_VUS = Number(__ENV.BURST_VUS || 15000);
const AUTH_MODE = __ENV.AUTH_MODE || "login";
const TENANT = __ENV.TENANT || "TPS";
const ROLE = __ENV.ROLE || "rates_officer";

if (!BASE_URL) {
  throw new Error("BASE_URL is required, e.g. BASE_URL=https://app.ratesassist.com.au");
}

// ---- custom metrics ---------------------------------------------------------
const readLatency = new Trend("read_latency", true);
const chatLatency = new Trend("chat_latency", true);
const bizErrors = new Rate("business_errors"); // non-2xx/3xx on a workflow call

// ---- load profiles ----------------------------------------------------------
const PROFILES = {
  smoke: [
    { duration: "30s", target: 20 },
    { duration: "1m", target: 20 },
    { duration: "10s", target: 0 },
  ],
  steady: [
    { duration: "3m", target: TARGET_VUS }, // ramp to 5k
    { duration: "10m", target: TARGET_VUS }, // hold
    { duration: "2m", target: 0 }, // ramp down
  ],
  burst: [
    { duration: "2m", target: TARGET_VUS }, // warm to 5k
    { duration: "3m", target: TARGET_VUS }, // hold 5k
    { duration: "1m", target: BURST_VUS }, // SPIKE to 15k
    { duration: "2m", target: BURST_VUS }, // hold the spike
    { duration: "2m", target: TARGET_VUS }, // recover to 5k
    { duration: "2m", target: 0 }, // drain
  ],
};

export const options = {
  scenarios: {
    officers: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: PROFILES[PROFILE] || PROFILES.steady,
      gracefulRampDown: "30s",
    },
  },
  // SLOs — the load test PASSES only if all thresholds hold.
  thresholds: {
    // Officer reads must stay snappy with 3x headroom.
    "http_req_duration{kind:read}": ["p(95)<800", "p(99)<1500"],
    // Chat is LLM-backed — a looser, explicit bound.
    "http_req_duration{kind:chat}": ["p(95)<6000", "p(99)<10000"],
    // 1% error budget across all workflow calls + graceful backpressure (429s
    // are EXPECTED under overload and counted as handled, not failures).
    http_req_failed: ["rate<0.01"],
    business_errors: ["rate<0.02"],
    checks: ["rate>0.99"],
  },
};

// ---- auth -------------------------------------------------------------------
export function setup() {
  if (AUTH_MODE === "autologin") return { cookie: null };
  if (AUTH_MODE === "cookie") return { cookie: __ENV.SESSION_COOKIE || null };

  // AUTH_MODE=login (default)
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ tenantId: TENANT, role: ROLE }),
    { headers: { "Content-Type": "application/json", Origin: BASE_URL } },
  );
  const setCookie = res.headers["Set-Cookie"] || "";
  // Pass the raw Set-Cookie back; the cookie name/value is taken verbatim.
  const cookie = setCookie ? setCookie.split(";")[0] : null;
  check(res, { "login ok": (r) => r.status === 200 && !!cookie });
  return { cookie };
}

function authParams(data, kind) {
  const headers = { Origin: BASE_URL };
  if (data && data.cookie) headers.Cookie = data.cookie;
  return { headers, tags: { kind } };
}

// ---- workflow ---------------------------------------------------------------
// Weighted officer activity: cheap liveness + read-heavy dashboard usage, with
// an occasional expensive chat. Weights approximate real officer behaviour.
function readGet(data, path) {
  const res = http.get(`${BASE_URL}${path}`, authParams(data, "read"));
  readLatency.add(res.timings.duration);
  const ok = check(res, { [`GET ${path} <500`]: (r) => r.status < 500 });
  bizErrors.add(!ok);
  return res;
}

export default function (data) {
  const roll = Math.random();

  if (roll < 0.1) {
    // 10% — liveness / health probes (cheap, unauthenticated).
    group("liveness", () => {
      http.get(`${BASE_URL}/api/health`, { tags: { kind: "read" } });
      http.get(`${BASE_URL}/api/ready`, { tags: { kind: "read" } });
    });
  } else if (roll < 0.95) {
    // 85% — the read-heavy officer dashboard loop.
    group("officer-reads", () => {
      readGet(data, "/api/me");
      readGet(data, "/api/data");
      readGet(data, "/api/recovery");
      readGet(data, "/api/properties");
      readGet(data, "/api/signals");
      readGet(data, "/api/activity");
    });
  } else {
    // 5% — expensive chat (LLM-backed).
    group("chat", () => {
      const res = http.post(
        `${BASE_URL}/api/chat`,
        JSON.stringify({ history: [], message: "give me today's briefing" }),
        {
          headers: {
            "Content-Type": "application/json",
            Origin: BASE_URL,
            ...(data && data.cookie ? { Cookie: data.cookie } : {}),
          },
          tags: { kind: "chat" },
        },
      );
      chatLatency.add(res.timings.duration);
      const ok = check(res, { "chat <500": (r) => r.status < 500 });
      bizErrors.add(!ok);
    });
  }

  // Think-time between officer actions (1-4s) so VUs model humans, not a flood.
  sleep(1 + Math.random() * 3);
}
