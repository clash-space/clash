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
make dev-web                # Frontend only (:3000, Next.js + Turbopack)
make dev-api-cf             # API only (:8789, Wrangler)
make dev-gateway            # Auth gateway only (:8788)
make dev-render             # Render server only (:8080)

# Database
make db-local               # Run D1 migrations locally (web + api-cf)

# Build, test, lint
make build                  # turbo run build
make test                   # turbo run test
make lint                   # turbo run lint
make format                 # prettier on all TS/JSON/MD

# Per-app testing
cd apps/api-cf && pnpm test           # API unit tests (vitest)
cd apps/api-cf && pnpm test:watch     # API tests in watch mode
cd apps/api-cf && pnpm test:integration  # Integration tests

# Remotion
make remotion-bundle        # Build Remotion video bundle
```

**After completing a task, run `make lint` to verify.** Do not run `make build` — the project uses hot-reload in dev.

## Architecture

### Monorepo Structure

pnpm workspaces + Turborepo. All apps deploy to **Cloudflare** (Workers / Pages).

| Directory | What | Runtime |
|-----------|------|---------|
| `apps/web` | Next.js 15 frontend (React 19, Tailwind CSS v4) | Cloudflare Pages via OpenNext |
| `apps/api-cf` | Hono API + Durable Objects + Workflows | Cloudflare Workers |
| `apps/auth-gateway` | Reverse proxy, auth validation, request routing | Cloudflare Workers |
| `apps/render-server` | Remotion video rendering (Node.js) | Cloudflare Containers |
| `apps/loro-sync-server` | Legacy CRDT sync (functionality merged into api-cf) | Cloudflare Workers |
| `packages/shared-types` | Zod schemas, TS types, model cards, Loro operations | Shared library |
| `packages/shared-layout` | Canvas node layout algorithms (zero deps) | Shared library |
| `packages/cli` | Terminal CLI (`clash` command) for project/canvas ops | Node.js |
| `packages/claude-code-plugin` | Claude Code integration (skills, hooks) | Plugin |
| `packages/remotion-*` | Video editor: core state, components, UI | Shared libraries |

### Gateway Pattern (Request Flow)

```
User/CLI → Auth Gateway (:8788)
  ├─ /               → Web Frontend (:3000)
  ├─ /sync/:projectId → ProjectRoom DO (WebSocket, Loro CRDT binary sync)
  ├─ /agents/*       → SupervisorAgent DO (AI chat WebSocket)
  ├─ /api/v1/*       → REST API (projects CRUD, authenticated)
  ├─ /api/tasks/*    → Task submission & polling (unauthenticated)
  ├─ /api/generate/* → Image/video generation endpoints
  ├─ /assets/*       → R2 asset serving (unauthenticated)
  ├─ /upload/*       → Asset upload to R2
  └─ /thumbnails/*   → Thumbnail generation/serving
```

Auth gateway injects `x-user-id` header for downstream services. Two auth methods: **Better Auth session** (cookie-based, browser) and **API token** (`clsh_*` prefix, CLI/agents).

### Real-time Sync (Loro CRDT)

Canvas state (nodes, edges) lives in **Loro CRDT** documents managed by the `ProjectRoom` Durable Object. Clients connect via WebSocket at `/sync/:projectId` and exchange binary CRDT updates. The flow:

1. Client connects → receives Loro snapshot
2. Local edits → generate CRDT update (binary) → send to ProjectRoom
3. ProjectRoom applies update → broadcasts to all other clients
4. Conflict resolution is automatic (CRDT properties)

Relational data (users, projects, sessions, API tokens) lives in **D1** (SQLite) via **Drizzle ORM**.

### Durable Objects (api-cf)

- **`ProjectRoom`** (`src/agents/project-room.ts`) — Loro CRDT host, WebSocket hub, presence tracking, activity broadcasts (throttled 500ms), task polling, periodic snapshots.
- **`SupervisorAgent`** (`src/agents/supervisor.ts`) — AI chat agent per project. Maintains Loro replica synced with ProjectRoom. Has canvas tools (list/read/create/update/delete nodes, run generation). Room name format: `projectId:agentId`.
- **`GenerationWorkflow`** (`src/agents/generation.ts`) — Cloudflare Workflow for multi-step AIGC: generate → upload to R2 → update asset node.

### AI & Generation Providers

- **Image**: Google Generative AI (Gemini), Recraft
- **Video**: Kling, FAL AI (Sora, Flux)
- **AI Chat**: OpenAI SDK via Cloudflare AI Gateway
- **Description**: Claude (via AI SDK)
- Model configs centralized in `packages/shared-types/src/models.ts` — never hardcode model parameters.

### Authentication

**Better Auth** with Drizzle adapter on D1. Supports email/password and Google OAuth. Base path: `/api/better-auth`.

API tokens: `clsh_` + 40 hex chars. Only SHA-256 hash stored in D1 (`api_token` table). Created via Settings UI, validated by auth gateway and api-cf auth module.

### Collaboration Visibility

Sideband JSON messages over the same WebSocket used for CRDT sync:
- **Presence**: `{ type: "presence", clients: [...] }` — who's connected (browser/CLI)
- **Activity**: `{ type: "activity", actor, action, nodeId, ... }` — who did what, throttled per node

Types defined in `packages/shared-types/src/presence.ts`. Detected via `isSidebandMessage()` type guard (string messages vs binary CRDT).

## Key Patterns

### Shared Types as Single Source of Truth

All schemas in `packages/shared-types`. Both frontend and backend validate against the same Zod schemas. Canvas node types, task schemas, model cards — all defined once. Python types can be generated via `pnpm generate:python`.

### Loro Operations

Runtime canvas operations (insert/update/delete nodes/edges) live in `packages/shared-types/src/loro-operations.ts`. The `LoroSyncClient` in `loro-client.ts` wraps these for CLI/agent use. Layout integration via `packages/shared-layout` for auto-positioning.

### agents.json Documentation

Significant directories contain `agents.json` files for progressive disclosure. When creating new modules, add an `agents.json`. When modifying architecture, update the relevant ones.

### API Validation

All API requests validated with Zod schemas in `apps/api-cf/src/domain/requests.ts`. Validation errors return 400 with structured details.

## Frontend Specifics (apps/web)

- **Styling**: Tailwind CSS v4, Framer Motion animations, Phosphor Icons (`weight="bold"` or `"duotone"`)
- **Fonts**: Inter (body), Space Grotesk (headings), JetBrains Mono (mono)
- **Design**: Modern minimalist — soft shadows, rounded corners (`rounded-xl`, `rounded-2xl`), glass morphism (`bg-white/30 backdrop-blur-xl`), red accent (`red-500`/`red-600` as brand)
- **Component model**: Server components by default, `'use client'` only when needed
- **Canvas**: ReactFlow for node graph, dnd-kit for drag-and-drop
- **Path alias**: `@/*` maps to project root
- **DB schema**: `apps/web/lib/db/app.schema.ts` (projects, API tokens), `apps/web/lib/db/better-auth.schema.ts` (users, sessions)

## CLI (packages/cli)

Installed as `clash` command. Connects to canvas via WebSocket (Loro CRDT sync), REST for project CRUD.

```bash
clash auth login              # Configure API token
clash auth status             # Verify authentication
clash projects list           # List projects
clash canvas list --project <id>    # List canvas nodes
clash canvas execute --project <id> --node <id>  # Trigger generation
clash tasks wait --task-id <id>     # Poll task to completion
```

Config stored at `~/.clash/config.json`. Server URL via `CLASH_SERVER_URL` env var (defaults to `http://localhost:8788`).
