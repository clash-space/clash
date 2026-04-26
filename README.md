# Clash

> **Next-Gen Co-Creation Platform** — 重新定义 AI 与人类在创意画布上的共生关系。
> Where agents co-create, humans are welcome too.

---

## 🎯 愿景 / Vision

Clash 致力于降低优质内容的创作门槛，不只是工具降权，更是创意的升维。
Clash lowers the barrier to high-quality creative work — not by automating people away, but by amplifying them.

- **Anti-Slop / 反垃圾内容**：拒绝 AI 灌水。我们用 AI 帮人完成原本受限于成本的高质量产出，而不是批量生产同质化内容。
- **Co-Creators / 人机共创**：Human 和 Agent 是平等合作伙伴。先共创创意，再分头落地（剪辑、AIGC、Motion Graphics）。
- **Skill-Based Agents / 技能化智能体**：把行业 SOP 沉淀成可复用 Skill，Agent 按意图调度子代理执行。
- **Multi-Client Collaboration / 多端协作**：浏览器、CLI、Claude Code 插件共享同一画布，Loro CRDT 实时同步、离线可编辑。

---

## 🏗 架构 / Architecture

```
                       ┌──────────────────────────────────────┐
                       │  clash.video (Worker: web)           │
   Browser ─────WS────▶│  ├─ Vite SPA + Better Auth (in-DO)   │
                       │  └─ /api/* /sync/* /agents/* /assets/*│
                       └──────────────┬───────────────────────┘
                                      │  service binding
                                      ▼
                       ┌──────────────────────────────────────┐
                       │  api.clash.video (Worker: api)       │
                       │  ├─ Hono routes (REST)               │
                       │  ├─ DO ProjectRoom    (Loro sync)    │
                       │  ├─ DO SupervisorAgent (AI chat)     │
                       │  ├─ DO RenderContainer (Remotion)    │
                       │  └─ Workflow generation-workflow     │
                       └──────────────┬───────────────────────┘
                                      │
                       ┌──────────────┴────────┬──────────────┐
                       ▼                       ▼              ▼
                  D1 (clash-d1)          R2 (clash-r2)    GHCR (render-server)
                  users / projects /     all generated    pre-built Remotion image
                  assets / asset_refs    media / covers   pulled by Container DO
```

### Tech Stack

| Layer        | Tech                                                        |
| ------------ | ----------------------------------------------------------- |
| Frontend     | Vite SPA, React 19, Tailwind v4, Framer Motion, @xyflow/react |
| Backend      | Cloudflare Workers (Hono), Durable Objects, Workflows       |
| Real-time    | Loro CRDT (binary WebSocket)                                |
| DB / Storage | Cloudflare D1 (SQLite + Drizzle), R2                        |
| Auth         | Better Auth (cookie session + API tokens)                   |
| AI           | Google Vertex (Gemini, Veo), fal.ai (nano-banana, Sora, Kling), OpenAI |
| Video        | Remotion 4 in Cloudflare Container                          |
| Tooling      | pnpm workspaces + Turborepo                                 |

### Monorepo

```
apps/
  web/                Vite SPA + Cloudflare Worker entry
  api-cf/             Hono API + Durable Objects + Workflow
  render-server/      Remotion renderer (Cloudflare Container, image on GHCR)
  loro-sync-server/   (legacy shell — sync moved into api-cf)
packages/
  shared-types/       Zod schemas, model cards, capability + ref helpers
  shared-layout/      Canvas auto-layout
  web-ui/             Shared React components (ProjectEditor, ChatbotCopilot, …)
  cli/                Terminal CLI
  claude-code-plugin/ Claude Code integration
  remotion-core/      Timeline state
  remotion-components/ Render components
  remotion-ui/        Video editor UI
```

### Generation Flow（生成链路）

```
canvas drag image + select model + Run
  │  frontend writes pending node to Loro
  │    data: { status: 'pending', referenceImageAssetIds: [X], modelId }
  │
  ▼  ProjectRoom DO sees pending → NodeProcessor
  │  batch-resolves D1 assets WHERE id IN (...) → R2 keys
  │
  ▼  env.GENERATION_WORKFLOW.create({ params: { referenceImageR2Keys } })
  │  resolveProvider → google-image / fal-image / veo / fal-video / …
  │
  ▼  ctx.step("generate"): inline R2 read → upstream API → upload result to R2
  ▼  ctx.step("save-asset"): insert D1 asset row
  ▼  notifyCompleted → POST /sync/<projectId>/update-node
  │
  ▼  ProjectRoom updates Loro node: { status: 'completed', assetId }
  ▼  Loro broadcast → browser ImageNode → useAsset(id).srcR2Key → 显示
```

**关键不变量 / Key invariant**: `assetId` 是单一来源（single source of truth）。Loro node 上**只**写 `assetId`，永不写 `srcR2Key` —— 服务端通过 D1 解析。前端组件读图时走 `useAsset(assetId).srcR2Key`。

---

## 🚀 自托管 / Self-Hosting

OSS 这个仓库的 wrangler 配置是**模板**，资源名都改成中性的 `clash-*`，要部到自己的 Cloudflare 账号上之前先把资源建好。
This repo's wrangler config is a **template** with neutral names. Create your own CF resources before deploying.

### Prerequisites

- Node 20+
- pnpm 10+
- Wrangler 4+ (`npm i -g wrangler`)
- Cloudflare account with Workers Paid plan (Durable Objects + Workflows + Containers require it)

### One-time CF resource setup

```bash
# Authenticate
wrangler login

# D1 — note the printed `database_id` and paste it into all 3 wrangler.toml files
wrangler d1 create clash-d1

# R2
wrangler r2 bucket create clash-r2

# Apply schema
cd apps/web && pnpm wrangler d1 migrations apply clash-d1
```

`apps/{api-cf,web,loro-sync-server}/wrangler.toml` 里 `database_id` 默认是 `00000000-...`，把它替换成上面 `wrangler d1 create` 输出的真 UUID。

### Secrets

| Secret               | Where to get it                                    |
| -------------------- | -------------------------------------------------- |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`                          |
| `BETTER_AUTH_URL`    | Your deployed domain, e.g. `https://your.app`      |
| `GOOGLE_API_KEY`     | Google AI Studio                                   |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_CLOUD_PROJECT` | Vertex AI service account JSON |
| `FAL_API_KEY`        | fal.ai dashboard                                   |
| `KLING_ACCESS_KEY` / `KLING_SECRET_KEY` | Kuaishou Kling                  |
| `CF_AIG_TOKEN` / `CF_AIG_OPENAI_URL` / `GOOGLE_AI_STUDIO_BASE_URL` / `FAL_GATEWAY_URL` | Cloudflare AI Gateway (optional but recommended) |
| `R2_PUBLIC_URL`      | Public bucket URL or signed-URL host               |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth (optional)         |

```bash
# Local dev: copy and fill apps/api-cf/.dev.vars (gitignored)
cp apps/api-cf/.dev.vars.example apps/api-cf/.dev.vars

# Production: bulk-upload to your Worker
cd apps/api-cf && wrangler secret bulk .dev.vars
```

### Deploy

```bash
# Build the render-server image once and push to GHCR (or your registry)
docker build -f apps/render-server/Dockerfile -t ghcr.io/<you>/clash-render:latest .
docker push ghcr.io/<you>/clash-render:latest
# Then point apps/render-server/Dockerfile.cf at your image

# Deploy Workers
cd apps/web && pnpm run deploy
cd apps/api-cf && pnpm run deploy
```

CI 模板在 `.github/workflows/deploy.yml`。要 enable 在 repo Settings → Secrets 里加：
The CI template is at `.github/workflows/deploy.yml`. Enable it by adding to repo Settings → Secrets:

- `CLOUDFLARE_API_TOKEN` — token with `Account.Workers Scripts(Edit)`, `Workers KV(Edit)`, `D1(Edit)`, `R2(Edit)`, `Workflows(Edit)`
- `CLOUDFLARE_ACCOUNT_ID` — visible on CF dashboard home
- 加上 `Secrets` 表里那些 worker secrets（CI 会通过 `wrangler-action` 推同步到 Worker） / Plus the worker secrets above.

---

## 💻 本地开发 / Local Development

```bash
pnpm install
pnpm -w dev                 # web :3000 + api-cf :8789 + sync :8790
```

Vite proxy 把 `/api/*` `/sync/*` `/agents/*` 转到 api-cf；本地 D1/R2 状态共享在 `.wrangler/state/`。

### CLI

```bash
cd packages/cli && pnpm link --global
clash auth login
clash projects list
clash canvas execute --project <id> --node <id>
```

### Tests

```bash
pnpm test          # unit
pnpm type-check    # tsc --noEmit, all packages
```

---

## 🧠 设计原则 / Design Principles

- **Canvas as Environment（画布即环境）**：所有 Agent 操作 = 对画布状态的 **read/write**。没有藏在 prompt 里的隐式上下文。
- **Lightweight Core, Skill-Heavy（轻核重技能）**：Agent 骨架最小化，能力来自可挂载的 Skill。
- **CRDT-first**：Loro 同步原生支持多端协作 + 离线编辑 + 自动冲突解决。
- **Async-first**：所有生成走 Cloudflare Workflows，长任务可重试、可恢复，前端只 watch 节点状态。
- **Asset-id is truth（assetId 单一来源）**：节点上只写 ID，资源在 D1 asset 行；服务端解析 R2 key。前端跨组件查图统一走 `useAsset`。

---

## 🔧 Hosted Variant

`clash.video` 跑的是 [`clash-space/clash-hosted`](https://github.com/clash-space/clash-hosted)（私有），它把这个仓库当 git submodule，叠加 billing / BYOK / plan gating。OSS 版本你自己建账号自己控制，没有 billing。

`clash.video` runs from the private [`clash-space/clash-hosted`](https://github.com/clash-space/clash-hosted) overlay, which vendors this repo as a git submodule and adds billing / BYOK keys / plan gating on top. The OSS version is fully self-contained — bring your own CF account and you own everything.

---

## License

MIT

---

*让计算永不停歇，让创意自然流淌。*
*Computation never sleeps; creativity flows.*
