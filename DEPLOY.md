# Deploying RatesAssist

This document covers every supported deploy path for the `apps/web` Next.js
app, the trade-offs between them, and the env-var matrix each one needs.

> Status: pre-auth. The current build has **zero authentication**. Treat
> every deploy below as a demo / private-preview surface only. Auth is a
> Phase 3 prerequisite (see `PRODUCTION-PLAN.md`) before any non-demo
> deploy that touches real council data.

---

## 1. Quick start (local dev)

```bash
git clone <repo> RatesAssist
cd RatesAssist
npm install
npm run build --workspace=@ratesassist/adapter-demo   # build the MCP adapter once
npm run dev:web                                       # http://localhost:3000
```

`npm run dev:web` uses the `mcp` transport by default — `mcp-client.ts`
spawns the adapter-demo MCP server as a stdio child process. To exercise
the in-process transport locally:

```bash
RA_TOOL_TRANSPORT=inproc npm run dev:web
```

Smoke + ship-check:

```bash
npm run ship-check    # full gate
npm run smoke         # end-to-end against a built web app, 25 cases
```

---

## 2. Deploy targets

| Target              | Transport | AU residency        | Spawn-friendly | Cost (entry) | Best for                          |
| ------------------- | --------- | ------------------- | -------------- | ------------ | --------------------------------- |
| Vercel              | `inproc`  | Sydney (`syd1`)     | No             | Free / Pro   | Demos, marketing, fast iteration  |
| Render web service  | `mcp`     | Singapore (no AU)*  | Yes            | $7/mo        | Faithful Phase 1B wire over MCP   |
| Railway             | `mcp`     | Singapore (no AU)*  | Yes            | ~$5/mo       | Same as Render, simpler UX        |
| Fly.io              | `mcp`     | Sydney (`syd`)      | Yes            | ~$3-5/mo     | AU residency + MCP wire           |
| Self-hosted (any)   | either    | Wherever you host   | Yes            | varies       | Council-facing pilots             |

\* Render and Railway lack a Sydney region today; data resides in Singapore
or US. For council pilots that require AU data residency, prefer Fly.io
(Sydney) or self-host on AU IaaS.

### Picking a transport

`apps/web/lib/mcp-client.ts` selects a transport at boot:

1. `RA_TOOL_TRANSPORT=mcp|inproc` — explicit override (highest priority).
2. `VERCEL=1` — auto-select `inproc`.
3. Fallback — `mcp`.

`mcp` spawns `packages/adapter-demo/dist/server.js` per Node process,
respawns up to 3× in any rolling 30s window if the child dies, and
enforces the same input/output validation the in-process path does.

`inproc` imports `@ratesassist/adapter-demo/inproc` and calls the
dispatcher directly. Same dispatcher, same handlers, same Zod validation
on the way in and out — only the transport changes. This is acceptable
for the demo adapter (synthetic, read-only data). Real platform adapters
(TechOne, Civica) MUST be wired over a real transport — they live in
separate processes for trust-boundary and dependency-isolation reasons.

---

## 3. Vercel (Option A — recommended for demo)

`vercel.json` at the repo root drives the build:

- `installCommand`: `npm install` (workspace-aware via root `package.json`)
- `buildCommand`: builds workspace deps, then adapter-demo, then apps/web
- `outputDirectory`: `apps/web/.next`
- `framework`: `nextjs`
- `env.RA_TOOL_TRANSPORT`: `inproc` (forces in-process at build + runtime)

### Steps

1. Push the repo to a Git host Vercel supports.
2. In Vercel: **Add New Project** → import the repo. Leave the framework
   preset as detected (Next.js); the root `vercel.json` overrides the
   build, install, and output paths.
3. Set environment variables (Project → Settings → Environment Variables):

   | Name                   | Required for         | Value                                      |
   | ---------------------- | -------------------- | ------------------------------------------ |
   | `ANTHROPIC_API_KEY`    | live chat            | your key (omit for mock mode)              |
   | `ABN_LOOKUP_GUID`      | real ABR queries     | your ATO-issued GUID (omit for mock)       |
   | `NODE_ENV`             | production lock      | `production`                               |
   | `RA_TOOL_TRANSPORT`    | already in vercel.json| `inproc` (do not override)                |

4. Set region to `syd1` (Project → Settings → Functions → Region).
5. Deploy.

### Local simulation

```bash
npx vercel build --debug   # if vercel CLI is installed
```

Skip if the CLI isn't installed; a clean `npm run build` from the repo
root is the closest local proxy.

---

## 4. Render (Option B — faithful MCP wire)

Render web services run a long-lived Node process and can spawn child
processes, so the default `mcp` transport works.

### Steps

1. **New** → **Web Service** → connect repo.
2. Build command: `npm install && npm run build`
3. Start command: `npm run start --workspace=apps/web`
4. Environment:
   - Runtime: Node 20+
   - Plan: Starter ($7/mo) is sufficient for a demo
   - Region: Singapore (closest to AU)
5. Env vars: same matrix as Vercel **except** leave `RA_TOOL_TRANSPORT`
   unset (defaults to `mcp`). Optionally set `RA_MCP_TOOL_TIMEOUT_MS`.
6. Deploy.

A `Dockerfile` is not required for Render's native Node buildpack, but
one will be needed for Fly. TBD when that path is greenlit.

---

## 5. Production checklist

Before pointing any non-demo traffic at a deploy:

- [ ] `NODE_ENV=production` — strict ABN client, no silent mock fallback
- [ ] Real `ANTHROPIC_API_KEY` provisioned and rate-limited at the edge
- [ ] Real `ABN_LOOKUP_GUID` (from ATO ABR registration)
- [ ] Auth (Entra/SSO) wired in front of every route — see Phase 3 plan
- [ ] Per-tenant scoping (Postgres RLS) — see Phase 2 plan
- [ ] Log shipping (Datadog/Logtail) for the structured `mcp-client` logs
- [ ] Uptime monitoring on `/api/health` (TODO: add this endpoint)
- [ ] Backup story for any persistent state (none today; the demo adapter
      is in-memory)

---

## 6. Demo deploy (no secrets)

The minimum viable deploy for a council CFO walkthrough:

1. Vercel, with the steps in §3.
2. **No** `ANTHROPIC_API_KEY` — the `/api/chat` route falls back to a
   deterministic mock that still exercises the MCP tool surface.
3. **No** `ABN_LOOKUP_GUID` — the ABN client returns honest mock results
   for the seeded test ABNs.
4. The synthetic dataset shipped in `packages/adapter-demo/src/data` is
   sufficient to walk through every flow in the demo script.

Total cost: $0. Lead time: ~5 minutes from a fresh Vercel account.
