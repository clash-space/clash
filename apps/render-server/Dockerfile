FROM node:20-slim

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

RUN corepack enable && pnpm install --frozen-lockfile --filter @master-clash/render-server...

# Copy source
COPY packages/remotion-core/ packages/remotion-core/
COPY packages/remotion-components/ packages/remotion-components/
COPY apps/render-server/ apps/render-server/

# Build
RUN pnpm --filter @master-clash/render-server build

WORKDIR /app/apps/render-server
EXPOSE 8080
CMD ["node", "dist/index.js"]
