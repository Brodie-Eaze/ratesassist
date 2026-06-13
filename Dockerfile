# syntax=docker/dockerfile:1.7
# =============================================================================
# RatesAssist — multi-stage production image for the Next.js standalone server.
#
#   deps    : install the FULL monorepo dev+prod deps once (cached on lockfile)
#   builder : build workspace packages in dependency order, then apps/web,
#             emitting .next/standalone (output: 'standalone' in next.config.js)
#   runner  : minimal Node 20 alpine, NON-ROOT, only the standalone artifact
#
# Because next.config.js sets outputFileTracingRoot to the repo root, the
# standalone tree is rooted at the monorepo:
#   .next/standalone/
#     ├── node_modules/            (traced runtime deps incl. @ratesassist/*)
#     ├── package.json
#     └── apps/web/
#         ├── server.js            (entrypoint)
#         └── .next/
# Static assets + public are copied alongside per Next's standalone contract.
# =============================================================================

# Pin to a Node 20 alpine digest in CI for full reproducibility. Tag kept here
# so the file is portable; replace with @sha256:... before going to prod.
ARG NODE_IMAGE=node:20.18-alpine3.20

# -----------------------------------------------------------------------------
# Stage 1 — deps: install all workspace dependencies (cached on manifests).
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# libc6-compat: some prebuilt native modules (e.g. pg, sharp-likes) expect glibc
# symbols on alpine/musl.
RUN apk add --no-cache libc6-compat

# Copy only manifests first so `npm ci` is cached unless a manifest changes.
# Workspaces are declared in the root package.json ("apps/*", "packages/*").
COPY package.json package-lock.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/adapter-demo/package.json packages/adapter-demo/package.json
COPY packages/audit-core/package.json packages/audit-core/package.json
COPY packages/contract/package.json packages/contract/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/identity/package.json packages/identity/package.json
COPY packages/recovery-engine/package.json packages/recovery-engine/package.json
COPY packages/spatial/package.json packages/spatial/package.json

# Deterministic install from the committed lockfile. engine-strict in .npmrc
# enforces the Node 20 / npm 10 floors.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# -----------------------------------------------------------------------------
# Stage 2 — builder: compile workspace packages (in order), then the web app.
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Same build sequence Vercel uses (vercel.json buildCommand): dependency-ordered
# workspace builds, then apps/web. RA_TOOL_TRANSPORT mirrors the Vercel build env.
ENV RA_TOOL_TRANSPORT=inproc
RUN npm run build --workspace=@ratesassist/contract --if-present \
    && npm run build --workspace=@ratesassist/identity --if-present \
    && npm run build --workspace=@ratesassist/recovery-engine --if-present \
    && npm run build --workspace=@ratesassist/spatial --if-present \
    && npm run build --workspace=@ratesassist/adapter-demo \
    && npm run build --workspace=apps/web

# apps/web currently ships no public/ dir. Ensure one exists so the runner's
# COPY is always valid (and any future public assets are picked up unchanged).
RUN mkdir -p apps/web/public

# -----------------------------------------------------------------------------
# Stage 3 — runner: minimal, non-root runtime with only the standalone output.
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next standalone server respects PORT/HOSTNAME; bind all interfaces so the ALB
# (in-VPC) can reach the task. Overridden by the ECS task definition too.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged, well-known UID/GID — never root.
RUN addgroup -g 1001 -S nodejs \
    && adduser -u 1001 -S nextjs -G nodejs

# Standalone server (monorepo-rooted) — includes traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static + public assets live next to the app entrypoint in the standalone tree.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

# Liveness from inside the container; ECS/ALB also probe /api/health externally.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Entry: the traced standalone server for apps/web.
CMD ["node", "apps/web/server.js"]
