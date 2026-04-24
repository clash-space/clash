FROM node:20-slim

# Mirrors — overridable via build args for slow / region-specific networks.
# Default to the upstream registries; wrangler.toml image_vars can flip to
# Aliyun mirrors for dev builds run from behind slow npmjs connectivity.
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG DEBIAN_MIRROR=

# Swap Debian APT sources if a mirror is supplied (both the security and
# main archives share the same vendor pattern; do them together).
RUN if [ -n "$DEBIAN_MIRROR" ]; then \
      sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi

# Install Chromium for Remotion rendering
RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium fonts-noto-cjk && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy workspace root for monorepo resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/remotion-core/package.json packages/remotion-core/
COPY packages/remotion-components/package.json packages/remotion-components/
COPY apps/render-server/package.json apps/render-server/

# Corepack downloads pnpm itself from a registry before it's usable —
# `pnpm config set` only affects subsequent pnpm calls, not this bootstrap.
# COREPACK_NPM_REGISTRY forces corepack to honor the same mirror.
RUN COREPACK_NPM_REGISTRY="$NPM_REGISTRY" corepack enable && \
    pnpm config set registry "$NPM_REGISTRY" && \
    pnpm install --frozen-lockfile --filter @master-clash/render-server...

# Copy source
COPY packages/remotion-core/ packages/remotion-core/
COPY packages/remotion-components/ packages/remotion-components/
COPY apps/render-server/ apps/render-server/

# Build
RUN pnpm --filter @master-clash/render-server build

WORKDIR /app/apps/render-server
EXPOSE 8080
CMD ["node", "dist/index.js"]
