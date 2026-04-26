# Clash

Multi-agent canvas for creative video work — humans and AI editing the
same Loro CRDT graph in real time. Backend on Cloudflare Workers + D1 +
R2; frontend is a Vite SPA. Self-hostable end-to-end.

`clash.video` runs from a private overlay
([`clash-space/clash-hosted`](https://github.com/clash-space/clash-hosted))
that vendors this repo as a submodule and adds billing. Everything in
this repo runs without it.

> 多智能体的视频创作画布。人和 Agent 编辑同一份 Loro CRDT 图，全程实时。后端
> 跑在 Cloudflare Workers + D1 + R2，前端是 Vite SPA。可完整自托管。`clash.video`
> 用的是私有 overlay（`clash-hosted`，把这个仓库当 submodule 套上 billing），
> 但本仓库本身不依赖它。

---

## Architecture

```
                        ┌──────────────────────────────┐
                        │  clash-web Worker            │
   Browser ─── WS ─────▶│  Vite SPA + Better Auth      │
                        │  proxies /api /sync /agents  │
                        └─────────────┬────────────────┘
                                      │ service binding
                                      ▼
                        ┌──────────────────────────────┐
                        │  clash-api Worker            │
                        │   • Hono routes              │
                        │   • DO ProjectRoom (Loro)    │
                        │   • DO SupervisorAgent (chat)│
                        │   • DO RenderContainer       │
                        │   • Workflow generation-*    │
                        └────┬────────────┬────────────┘
                             │            │
                       D1 clash-d1   R2 clash-r2
                       users / projects     all generated
                       assets / asset_refs  media + covers
```

**Key invariants**

- **Loro is canvas truth.** Edges, nodes, statuses live in Loro; D1 holds
  asset rows + auth + project metadata. The two never duplicate the same
  field.
- **`assetId` resolves to R2 server-side.** Pending nodes carry `assetId`
  only; the workflow batch-resolves IDs to R2 keys via D1. `node.data.src`
  does not exist.
- **Generation runs on Cloudflare Workflows.** Long tasks are restartable
  per step; the frontend just watches node status.

### Generation path

```
canvas Run
  → frontend writes pending node { status, modelId, referenceImageAssetIds }
  → ProjectRoom DO sees pending → NodeProcessor
  → batch SELECT assets WHERE id IN (...) → R2 keys
  → env.GENERATION_WORKFLOW.create({ params: { referenceImageR2Keys, ... } })
  → resolveProvider → google-image | fal-image | veo | fal-video | ...
  → step("generate"): R2 read → upstream API → upload result → D1 asset row
  → POST /sync/<projectId>/update-node { status:'completed', assetId }
  → Loro broadcast → ImageNode reads via useAsset(assetId).srcR2Key
```

### Tech

| Layer       | Tech                                                            |
| ----------- | --------------------------------------------------------------- |
| Frontend    | Vite, React 19, Tailwind v4, @xyflow/react, Framer Motion       |
| Worker      | Cloudflare Workers (Hono), Durable Objects, Workflows, Container|
| Real-time   | Loro CRDT (binary WebSocket)                                    |
| DB          | D1 + Drizzle                                                    |
| Object store| R2                                                              |
| Auth        | Better Auth (cookie session + opaque API tokens)                |
| AI          | Google Vertex (Gemini, Veo), fal.ai, OpenAI                     |
| Video       | Remotion 4 in a Cloudflare Container                            |
| Build       | pnpm workspaces, Turborepo, Vite                                |

### Layout

```
apps/
  web/                  Vite SPA + Worker entry
  api-cf/               Hono + DOs + Workflow + container DO
  render-server/        Remotion image (built once → GHCR, pulled by Container DO)
  loro-sync-server/     legacy shell, sync moved into api-cf
packages/
  shared-types/         Zod schemas, model cards, ref/capability helpers
  shared-layout/        canvas auto-layout
  web-ui/               shared React components (ProjectEditor, ChatbotCopilot, …)
  cli/                  terminal CLI
  claude-code-plugin/   Claude Code integration
  remotion-{core,components,ui}/  video editor
```

---

## Self-hosting / 自托管

The `wrangler.toml` files in this repo use neutral resource names
(`clash-api`, `clash-d1`, `clash-r2`) with placeholder UUIDs. Create your
own Cloudflare resources and paste the IDs back in.

> 仓库里的 `wrangler.toml` 用的是中性名（`clash-*`）+ 占位 UUID。先在
> 自己的 Cloudflare 账号里建好资源，把真实 ID 填回去。

### Prerequisites

- Node 20+, pnpm 10+, wrangler 4+
- Cloudflare Workers Paid plan (DO + Workflows + Containers all need it)

### One-time setup

```bash
wrangler login

wrangler d1 create clash-d1
# Copy the printed `database_id` into apps/{api-cf,web,loro-sync-server}/wrangler.toml

wrangler r2 bucket create clash-r2

cd apps/web
pnpm wrangler d1 migrations apply clash-d1 --remote
```

### Secrets

`apps/api-cf/.dev.vars.example` lists every secret. Copy and fill:

```bash
cp apps/api-cf/.dev.vars.example apps/api-cf/.dev.vars
# fill in real values, then for production:
cd apps/api-cf
wrangler secret bulk .dev.vars
```

| Secret                                  | Notes                                  |
| --------------------------------------- | -------------------------------------- |
| `BETTER_AUTH_SECRET`                    | `openssl rand -base64 32`              |
| `BETTER_AUTH_URL`                       | Public origin, e.g. `https://your.app` |
| `GOOGLE_API_KEY`                        | Google AI Studio                       |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` | Vertex AI service account |
| `FAL_API_KEY`                           | fal.ai dashboard                       |
| `KLING_ACCESS_KEY` / `KLING_SECRET_KEY` | Kuaishou Kling                         |
| `R2_PUBLIC_URL`                         | Public bucket URL or signed-URL host   |
| `CF_AIG_TOKEN` / `CF_AIG_OPENAI_URL` / `GOOGLE_AI_STUDIO_BASE_URL` / `FAL_GATEWAY_URL` | CF AI Gateway (optional but recommended) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth (optional)                |

### Deploy

```bash
cd apps/web    && pnpm run deploy
cd apps/api-cf && pnpm run deploy
```

Render container: build the heavy image once (chromium + ffmpeg + node
prod deps) and push to a registry. `apps/render-server/Dockerfile.cf`
is just `FROM <your-registry>/clash-render:latest`, so subsequent
`wrangler deploy` runs only pull.

```bash
docker build -f apps/render-server/Dockerfile -t ghcr.io/<you>/clash-render:latest .
docker push ghcr.io/<you>/clash-render:latest
# Edit apps/render-server/Dockerfile.cf to FROM your image.
```

### CI

`.github/workflows/deploy.yml` is a working template. To enable, add
to repo Settings → Secrets:

- `CLOUDFLARE_API_TOKEN` — token with `Workers Scripts(Edit)`, `Workers KV(Edit)`, `D1(Edit)`, `R2(Edit)`, `Workflows(Edit)`
- `CLOUDFLARE_ACCOUNT_ID`
- The same secret list as above (CI uses `wrangler-action` to push them to the Worker on every deploy)

---

## Local dev

```bash
pnpm install
pnpm -w dev
```

Vite dev server on `:3000` proxies `/api/*`, `/sync/*`, `/agents/*` to
`apps/api-cf` running under wrangler dev on `:8789`. D1 and R2 use the
shared `.wrangler/state/` so all services see the same local data.

### CLI

```bash
cd packages/cli && pnpm link --global
clash auth login
clash projects list
clash canvas execute --project <id> --node <id>
```

### Tests

```bash
pnpm test          # unit (vitest)
pnpm type-check    # tsc --noEmit across all packages
```

---

## License

MIT.
