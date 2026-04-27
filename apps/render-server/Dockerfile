# Multi-stage build — runtime image excludes the monorepo's full devDeps.
# Single-stage was 2.2 GB (over CF Containers' 2 GB cap on standard plan);
# this layout aims for ~800 MB by:
#   - building in stage 1 with full deps
#   - copying only `dist/` + a prod-only node_modules into stage 2
#   - using `pnpm deploy` to flatten workspace deps so we don't need to
#     ship the rest of the monorepo
#
# Mirrors are overridable via build args for slow / region-specific networks.

# ── Stage 1: build ──────────────────────────────────────────────────────

FROM node:20-slim AS builder
ARG NPM_REGISTRY=https://registry.npmjs.org/

WORKDIR /app

# Workspace topology so pnpm can resolve the deps graph.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/remotion-core/package.json packages/remotion-core/
COPY packages/remotion-components/package.json packages/remotion-components/
COPY apps/render-server/package.json apps/render-server/

# Bootstrap pnpm via corepack against the configured mirror.
RUN COREPACK_NPM_REGISTRY="$NPM_REGISTRY" corepack enable && \
    pnpm config set registry "$NPM_REGISTRY" && \
    pnpm install --frozen-lockfile --filter @master-clash/render-server...

# Source.
COPY packages/remotion-core/ packages/remotion-core/
COPY packages/remotion-components/ packages/remotion-components/
COPY apps/render-server/ apps/render-server/

RUN pnpm --filter @master-clash/render-server build

# pnpm deploy: copies only prod deps + the workspace deps the target needs,
# inlined into a self-contained tree at /tmp/deploy that we can copy as-is.
RUN pnpm deploy --filter @master-clash/render-server --prod /tmp/deploy

# ── Stage 2: runtime ────────────────────────────────────────────────────

FROM node:20-slim AS runtime
ARG DEBIAN_MIRROR=

# Optional Debian mirror for slow networks.
RUN if [ -n "$DEBIAN_MIRROR" ]; then \
      sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi

# Chromium for Remotion + CJK fonts for international captions.
RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium fonts-noto-cjk && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Self-contained deployment from stage 1: dist/, package.json, prod-only
# node_modules with workspace deps already inlined.
COPY --from=builder /tmp/deploy/ /app/

# Remotion bundle() compiles from .tsx source at request time, but
# `pnpm deploy --prod` strips workspace packages down to their `files:
# ["dist"]` (no src/). Ship the original packages/ tree alongside so
# render.ts can resolve ../packages/remotion-components/src/Root.tsx.
COPY --from=builder /app/packages /app/packages

EXPOSE 8080
CMD ["node", "dist/index.js"]
