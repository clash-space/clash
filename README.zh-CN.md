# Clash

[English](./README.md) · [简体中文](./README.zh-CN.md)

多智能体的视频创作画布。人和 Agent 编辑同一份 Loro CRDT 图，全程实时。后端
跑在 Cloudflare Workers + D1 + R2，前端是 Vite SPA，可完整自托管。

`clash.video` 用的是私有 overlay
([`clash-space/clash-hosted`](https://github.com/clash-space/clash-hosted))，
把这个仓库当 git submodule 套上 billing 层。本仓库本身不依赖它。

---

## 架构

```
                        ┌──────────────────────────────┐
                        │  clash-web Worker            │
   Browser ─── WS ─────▶│  Vite SPA + Better Auth      │
                        │  代理 /api /sync /agents     │
                        └─────────────┬────────────────┘
                                      │ service binding
                                      ▼
                        ┌──────────────────────────────┐
                        │  clash-api Worker            │
                        │   • Hono 路由                │
                        │   • DO ProjectRoom（Loro）   │
                        │   • DO SupervisorAgent（聊天）│
                        │   • DO RenderContainer       │
                        │   • Workflow generation-*    │
                        └────┬────────────┬────────────┘
                             │            │
                       D1 clash-d1   R2 clash-r2
                       用户 / 项目 /        所有生成媒体 +
                       assets / asset_refs  封面
```

**核心不变量**

- **Loro 是画布唯一真相。** 边、节点、状态都在 Loro 里；D1 只存 asset 行 +
  auth + project 元数据。两边永远不重复同一个字段。
- **`assetId` 由服务端解析成 R2。** Pending 节点只带 `assetId`；workflow 用
  D1 批量查回 R2 key。`node.data.src` 这个字段已经不存在了。
- **生成全部跑在 Cloudflare Workflows 上。** 长任务按 step 可恢复，前端只
  watch 节点 status。

### 生成链路

```
画布点 Run
  → 前端写 pending 节点 { status, modelId, referenceImageAssetIds }
  → ProjectRoom DO 看到 pending → NodeProcessor
  → 批量 SELECT assets WHERE id IN (...) → R2 keys
  → env.GENERATION_WORKFLOW.create({ params: { referenceImageR2Keys, ... } })
  → resolveProvider → google-image | fal-image | veo | fal-video | ...
  → step("generate")：读 R2 → 调上游 API → 上传结果 → 写 D1 asset 行
  → POST /sync/<projectId>/update-node { status:'completed', assetId }
  → Loro 广播 → ImageNode 通过 useAsset(assetId).srcR2Key 读图
```

### 技术栈

| 层          | 用了什么                                                          |
| ----------- | ----------------------------------------------------------------- |
| 前端        | Vite, React 19, Tailwind v4, @xyflow/react, Framer Motion         |
| Worker      | Cloudflare Workers (Hono), Durable Objects, Workflows, Container  |
| 实时同步    | Loro CRDT（二进制 WebSocket）                                     |
| 数据库      | D1 + Drizzle                                                      |
| 对象存储    | R2                                                                |
| 鉴权        | Better Auth（cookie session + opaque API token）                  |
| AI          | Google Vertex (Gemini, Veo)、fal.ai、OpenAI                       |
| 视频        | Cloudflare Container 跑 Remotion 4                                |
| 构建        | pnpm workspaces + Turborepo + Vite                                |

### 仓库结构

```
apps/
  web/                  Vite SPA + Worker 入口
  api-cf/               Hono + DOs + Workflow + container DO
  render-server/        Remotion 镜像（构一次推到 GHCR，由 Container DO 拉）
  loro-sync-server/     遗留壳子，sync 逻辑已搬进 api-cf
packages/
  shared-types/         Zod schema、model card、ref/capability 工具
  shared-layout/        画布自动布局
  web-ui/               共用 React 组件（ProjectEditor、ChatbotCopilot 等）
  cli/                  终端 CLI
  claude-code-plugin/   Claude Code 集成
  remotion-{core,components,ui}/  视频编辑器
```

---

## 自托管

仓库里的 `wrangler.toml` 都是中性资源名（`clash-api` / `clash-d1` /
`clash-r2`）+ 占位 UUID。先在自己 Cloudflare 账号建好资源，把真实 ID
填回去。

### 前置条件

- Node 20+，pnpm 10+，wrangler 4+
- Cloudflare Workers Paid plan（DO + Workflows + Containers 都需要）

### 一次性设置

```bash
wrangler login

wrangler d1 create clash-d1
# 把打印出来的 database_id 粘进 apps/{api-cf,web,loro-sync-server}/wrangler.toml

wrangler r2 bucket create clash-r2

cd apps/web
pnpm wrangler d1 migrations apply clash-d1 --remote
```

### Secrets

`apps/api-cf/.dev.vars.example` 列了所有需要的 secret，复制后填值：

```bash
cp apps/api-cf/.dev.vars.example apps/api-cf/.dev.vars
# 填好真实值，部署到生产前一次性推上去：
cd apps/api-cf
wrangler secret bulk .dev.vars
```

| Secret                                  | 说明                                       |
| --------------------------------------- | ------------------------------------------ |
| `BETTER_AUTH_SECRET`                    | `openssl rand -base64 32`                  |
| `BETTER_AUTH_URL`                       | 公开域名，例如 `https://your.app`          |
| `GOOGLE_API_KEY`                        | Google AI Studio                           |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` | Vertex AI service account |
| `FAL_API_KEY`                           | fal.ai dashboard                           |
| `KLING_ACCESS_KEY` / `KLING_SECRET_KEY` | 快手可灵                                   |
| `R2_PUBLIC_URL`                         | 公开 bucket 域名 / 签名 URL host           |
| `CF_AIG_TOKEN` / `CF_AIG_OPENAI_URL` / `GOOGLE_AI_STUDIO_BASE_URL` / `FAL_GATEWAY_URL` | Cloudflare AI Gateway（推荐配上） |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth（可选）                       |

### 部署

```bash
cd apps/web    && pnpm run deploy
cd apps/api-cf && pnpm run deploy
```

Render container：先构一次重镜像（chromium + ffmpeg + node prod deps）
推到 registry。`apps/render-server/Dockerfile.cf` 只是 `FROM
<your-registry>/clash-render:latest`，之后每次 `wrangler deploy` 只 pull。

```bash
docker build -f apps/render-server/Dockerfile -t ghcr.io/<you>/clash-render:latest .
docker push ghcr.io/<you>/clash-render:latest
# 改 apps/render-server/Dockerfile.cf 的 FROM 指向你的镜像
```

### CI

`.github/workflows/deploy.yml` 是可用模板。要 enable，去 repo Settings →
Secrets 加：

- `CLOUDFLARE_API_TOKEN` — token 权限：`Workers Scripts(Edit)`、`Workers KV(Edit)`、`D1(Edit)`、`R2(Edit)`、`Workflows(Edit)`
- `CLOUDFLARE_ACCOUNT_ID`
- 上面 secret 表里那些 worker secrets（CI 用 `wrangler-action` 每次部署会同步推到 Worker）

---

## 本地开发

```bash
pnpm install
pnpm -w dev
```

Vite dev server 在 `:3000`，把 `/api/*` `/sync/*` `/agents/*` 转给跑在
`:8789` 的 wrangler dev (apps/api-cf)。D1 和 R2 用共享的
`.wrangler/state/`，所有服务看同一份本地数据。

### CLI

```bash
cd packages/cli && pnpm link --global
clash auth login
clash projects list
clash canvas execute --project <id> --node <id>
```

### 测试

```bash
pnpm test          # 单元测试 (vitest)
pnpm type-check    # tsc --noEmit，所有包
```

---

## 许可证

[PolyForm Shield 1.0.0](./LICENSE)。Source-available，永久不转宽松。

可以 fork、改、分发、内部商用、贡献回上游、做学术研究 —— 唯一禁止的是把
它做成跟 clash 竞争的商业产品/服务（比如开 clash-clone.com 卖钱）。
