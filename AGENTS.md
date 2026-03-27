# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies
make install                # pnpm install

# Development (most common)
make dev                    # Start web (:3000) + api-cf (:8789) in parallel
make dev-gateway-full       # Start all services behind auth gateway (:8788)

# Individual services
make dev-web                # Frontend only (:3000)
make dev-api-cf             # API only (:8789)
make dev-gateway            # Auth gateway only (:8788)

# Database
make db-local               # Run D1 migrations locally

# Build, test, lint
make build                  # turbo run build
make test                   # turbo run test
make lint                   # turbo run lint
make format                 # prettier on all TS/JSON/MD

# Per-app testing
cd apps/api-cf && pnpm test           # API unit tests (vitest)
cd apps/api-cf && pnpm test:watch     # API tests in watch mode
cd apps/web && pnpm test              # Frontend tests

# Remotion
make remotion-bundle        # Build Remotion video bundle
```

**After completing a task, run `make lint` to verify.** Do not run `make build` — the project uses hot-reload in dev.

## Architecture

### Monorepo Structure

pnpm workspaces + Turborepo. All apps deploy to **Cloudflare Workers**.

- **`apps/web`** — Next.js 15 frontend (React 19, Tailwind CSS v4). Built with OpenNext for Cloudflare deployment.
- **`apps/api-cf`** — Hono API on Cloudflare Workers. Houses Durable Objects (`ProjectRoom`, `SupervisorAgent`, `GenerationAgent`), REST endpoints, R2 asset serving.
- **`apps/auth-gateway`** — Hono reverse proxy that validates auth and routes to web/api-cf services.
- **`apps/loro-sync-server`** — Legacy CRDT sync server (functionality mostly merged into api-cf).
- **`packages/shared-types`** — Zod schemas, TypeScript types, model card configs. Single source of truth for API contracts.
- **`packages/shared-layout`** — Canvas node layout algorithms.
- **`packages/remotion-core`** — Video editor state management (React hooks).
- **`packages/remotion-components`** — Remotion rendering components.
- **`packages/remotion-ui`** — Video editor UI components.

### Gateway Pattern (Request Flow)

```
User → Auth Gateway (:8788)
  ├─ /           → Web Frontend (:3000)
  ├─ /sync/*     → ProjectRoom Durable Object (WebSocket, Loro CRDT)
  ├─ /agents/*   → SupervisorAgent Durable Object (AI chat)
  ├─ /api/*      → api-cf REST endpoints
  └─ /assets/*   → R2 asset storage
```

### Real-time Sync

Canvas state (nodes, edges, tasks) is stored in **Loro CRDT** documents managed by the `ProjectRoom` Durable Object. Clients connect via WebSocket at `/sync/:projectId` and exchange binary CRDT updates. Relational data (users, projects, sessions) lives in **Cloudflare D1** (SQLite) via **Drizzle ORM**.

### Durable Objects (api-cf)

- **`ProjectRoom`** — Loro CRDT document host, WebSocket hub for real-time collaboration.
- **`SupervisorAgent`** — AI chat agent per project. Room name format: `projectId:agentId`.
- **`GenerationAgent`** — Handles image/video generation tasks.

### Authentication

**Better Auth** with Drizzle adapter on D1. Supports email/password and Google OAuth. Base path: `/api/better-auth`. Auth gateway validates sessions and proxies authenticated requests.

### AI & Generation

- Image generation: Google Generative AI (Gemini)
- Video generation: Kling, FAL AI
- AI chat: OpenAI SDK, Google AI SDK
- Model configs centralized in `packages/shared-types/src/models.ts`

## Key Patterns

### Backend Design Principles (from AGENTS.md)

1. Domain-driven design
2. Functional programming — prefer protocols/ADTs over classes, prefer pattern matching
3. Async-first — go async or go die

### Model Configuration

All model cards, aspect ratios, and generation parameters are defined in `packages/shared-types/src/models.ts`. Both frontend and backend consume these. Never hardcode model parameters — use the shared constants.

### Multi-Provider Architecture

Models can have multiple provider implementations (e.g., official API vs proxy). Provider routing is configured in model cards via `availableProviders` and `defaultProvider` fields.

### agents.json Documentation

Significant directories contain `agents.json` files for progressive disclosure navigation. When creating new modules, add an `agents.json`. When modifying architecture, update the relevant `agents.json`.

### API Validation

All API requests validated with Zod schemas defined in `apps/api-cf/src/domain/requests.ts`. Validation errors return 400 with structured error details.

## Frontend Specifics (apps/web)

- **Styling**: Tailwind CSS v4, Framer Motion for animations, Phosphor Icons
- **Fonts**: Inter (body), Space Grotesk (headings), JetBrains Mono (mono)
- **Component model**: Server components by default, `'use client'` only when needed
- **State**: Loro CRDT for canvas data, ReactFlow for node graph, dnd-kit for drag-and-drop
- **Path alias**: `@/*` maps to project root
