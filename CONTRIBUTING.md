# Contributing to RatesAssist

Short guide. Read it once, then read `PRODUCTION-PLAN.md` for the why.

## Workspace layout

This is an npm workspaces monorepo:

- `apps/web` — Next.js app (operator + citizen UIs)
- `packages/contract` — canonical MCP RatesAdapter contract (types, schemas, tools)
- `packages/identity` — ATO ABN Lookup integration
- `packages/spatial` — SLIP/DMIRS/Landgate ArcGIS REST integration
- `packages/recovery-engine` — multi-signal detection engine
- `packages/adapter-demo` — reference MCP adapter against synthetic data
- `scripts/` — `ship-check.sh`, `smoke.ts`

## Setup

Install from the **root**, not per-package:

```bash
nvm use            # Node 20+
npm install        # also installs husky pre-commit hook via "prepare"
```

`engine-strict=true` in `.npmrc` will refuse install on the wrong Node.

## Before committing

The pre-commit hook (`.husky/pre-commit`) runs typecheck + tests on every commit. Don't fight it — fix the failure or use `--no-verify` only when you have a real reason.

```bash
npm test           # run all workspace tests
```

## Before opening a PR

```bash
npm run ship-check
```

This is the full gate (typecheck + tests + Next build + smoke). It must exit 0.

## Conventions

- **Tag tests in commit messages.** Example: `feat(spatial): bbox validation [tests: spatial/bbox.test.ts]`.
- **Don't add comments** unless the *why* is non-obvious. The code says *what*; comments say *why*.
- **Don't add packages** without aligning with `PRODUCTION-PLAN.md`. Every new dependency is supply-chain surface area.
- **Do not touch generated files** (`dist/`, `.next/`, `*.tsbuildinfo`).

## Dependencies

Dependabot proposes weekly grouped patch+minor updates. Major version bumps (Next.js, React, Anthropic SDK) come as separate PRs and require manual review against the production plan.
