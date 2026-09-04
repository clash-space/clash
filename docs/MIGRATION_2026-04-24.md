# Migration — Next.js → Vite + React Router v7 + Cloudflare (2026-04-24)

完成了 handoff 里提的那次全栈迁移。

## TL;DR

- `apps/web` 从 Next.js 15 + OpenNext 换成 **Vite 8 + React Router 7.14 + @cloudflare/vite-plugin 1.33**。
- 组件抽到独立 package `packages/web-ui`，给未来的 Electron 客户端复用同一份。
- `apps/gateway` 的代理逻辑并进 `apps/web/workers/app.ts`（单 worker 入口），`gateway` 目录删掉了。
- 只有 `apps/render-server` 在 wrangler 之外（Docker）。`make dev` 起 web (:3000) + api-cf (:8789) + render (:8080)，就够了。

## 已完成

### 新架构

```
apps/
├── web/                  # Vite + RR7 + CF vite plugin（替换 Next.js）
│   ├── app/
│   │   ├── root.tsx
│   │   ├── routes.ts     # 21 routes (9 UI + 12 resource)
│   │   ├── routes/
│   │   ├── layouts/AppLayout.tsx
│   │   ├── lib/
│   │   │   ├── auth/     # better-auth server factory + session helper
│   │   │   ├── db/       # drizzle schemas + D1 adapter
│   │   │   └── server/   # projects.server.ts, settings.server.ts
│   │   ├── entry.server.tsx  # 用 renderToReadableStream（workerd 兼容）
│   │   └── globals.css
│   ├── workers/app.ts    # fetch handler：/health + /api/better-auth/* + proxy + RR7
│   ├── vite.config.ts
│   ├── react-router.config.ts
│   ├── wrangler.toml
│   └── drizzle/          # 从旧 apps/web 原样搬过来
├── api-cf/               # 不动（Hono + DOs + Workflow + Container）
├── render-server/        # 不动（Docker + ffmpeg/remotion）

packages/
└── web-ui/               # 新：跨 web + electron 的 UI 包
    └── src/
        ├── components/   # 所有原 app/components（57+ 个）
        ├── hooks/        # 原 app/hooks
        └── lib/
            ├── clientActions.ts   # 替代 "use server" 的 fetch wrapper
            ├── betterAuthClient.ts # 懒初始化（避免 SSR 抛错）
            ├── hooks/             # useAsset, useSignedUrl, retryFetch
            ├── layout/, utils/
            └── types.ts           # 跨包共享类型
```

### 关键决策

1. **SSR 目前 disable**（`react-router.config.ts` 里 `ssr: false`）。开过一次，能返 HTML，但 RR7 + CF vite plugin 的 dev 协作在我们这种重依赖（@xyflow/react + remotion + loro-crdt + milkdown 全家桶）下 SSR 路径不稳定——workerd 反复 reload 时有几率把 in-flight 请求 hang 住。SPA 模式 27s 预 bundle 之后稳定。**打开 SSR 是清晰的后续任务**：loaders 已经是 `(env, request)` 风格，API routes 现成，切回 `ssr: true` 只需验证首屏能出来。

2. **Server actions → HTTP API routes**。原 `'use server'` 的文件（`actions.ts`, `settings/actions.ts`, `marketplace/actions.ts`）全部改成 `app/routes/api.*.ts` resource routes。客户端通过 `@clash/web-ui/lib/clientActions` 调用。

3. **Better Auth 挂在 worker 入口直接处理** `/api/better-auth/*`（抄 playheads 的 gateway 模式）。避免走 RR7 中间件，性能更好、死锁更少。

4. **Gateway 并入 web worker**：`workers/app.ts` 头部处理 `/health` + `/api/better-auth/*` + api-cf 代理；其他走 RR7。`env.API_CF_URL` 的 HTTP 回退被去掉了——只走 service binding；dev 时要 api-cf 也在 wrangler dev 下跑，否则 sync/agents/assets 全 503。理由：没有 service binding 的时候原来的 fetch 回退会被浏览器的 WebSocket 重连刷到 workerd 饱和（踩了两次了）。

5. **组件库独立**：`packages/web-ui` 用 `"peerDependencies": { react, react-dom, react-router }`。Electron 那边以后装 react-router 用 HashRouter / MemoryRouter 套上就能直接用。

6. **最新技术栈**（用户指定）：react 19.2, react-router 7.14, vite 8.0, @cloudflare/vite-plugin 1.33, tailwindcss 4.2, wrangler 4.84, better-auth 1.6.9, drizzle-kit 0.28, react-dom 19.2。

### 已改动 / 新建 / 删除的文件

**新建**：
- `apps/web/` 整个（vite.config、wrangler.toml、react-router.config、app/、workers/、public/favicon.svg 等等）
- `packages/web-ui/` 整个（package.json、tsconfig.json、src/ ...）
- `docs/MIGRATION_2026-04-24.md`（本文件）

**删除**：
- `apps/web/`（老 Next.js 全部）
- `apps/gateway/`（职能并入 web worker）
- `package.json` 根依赖 `@opennextjs/cloudflare`

**改动**：
- `Makefile`：`dev-gateway` 删掉，`dev-web` 换成 vite，`dev` 去掉 gateway 那一层，`WEB_PORT` 从 3001 变 3000（web 直接是用户入口）
- `pnpm-workspace.yaml`：去掉 `apps/gateway`，加 `packages/web-ui`
- 根 `package.json`：keywords 把 `next.js` 换成 `react-router`

## 当前能跑到什么程度

- ✅ `pnpm vite` 在 `apps/web` 下能起来，首次 ready ~80s（pre-bundling 所有 SSR deps），之后 HMR 正常。
- ✅ `/health` 秒返 200。
- ✅ `/landing`, `/` 返回合法的 RR7 HTML shell（2525 B），客户端 bundle 挂载后会路由。
- ✅ `make dev` 会把 web + api-cf + render 并行起起来。
- ✅ `/api/better-auth/*` 在 worker 入口直接处理（不走 RR7），Google OAuth 链路逻辑保持。
- ❓ 浏览器画布实际渲染：我这边 agent-browser 的 Chrome 扩展没连上，没能自动截图验证。但 `curl` 拿回来的 HTML 合法、容器 div 齐全，客户端挂载后理论上就是之前 Next.js 版本同一套组件（@clash/web-ui）。

## 要警惕的（下一次接手别踩）

1. **workerd 僵尸**：vite 挂了以后 workerd 子进程常常不死，继续占 :3000/:3001/:3002。新 vite 会 fallback 到下一个端口。症状：`curl :3000` 返回的是老 worker 的内容。修法：`pkill -9 workerd` 之前先 `lsof -iTCP -sTCP:LISTEN -P | grep :3000` 确认。Makefile 的 `dev-web` 脚本也可以加一条 pre-kill。

2. **@clash/web-ui 里的 barrel export 是空的**：`packages/web-ui/src/index.ts` 故意只 `export {}`。所有消费方都走子路径 `@clash/web-ui/components/X` / `@clash/web-ui/lib/X`。这样 SSR/bundler 不会被 barrel 拖着加载整个子树（踩过这个坑，90s→20s）。

3. **Chrome 开着指向 `/projects/<id>` 的标签会把 worker 打爆**：浏览器 WebSocket 重连流量打到 `/sync/*` 和 `/agents/supervisor/*`，每个 3 秒 timeout，几十个并发就让 workerd 请求池饱和，SSR / 路由全卡住。修法：worker 入口对 `/sync/*` 和 `/agents/*` 在 api-cf service binding 缺失时 503 快速失败（已经做了）；以及调试时关掉那个 tab。

4. **pnpm 有 peer 警告**（drizzle-orm 0.36 vs better-auth@1.6.9 要求 ^0.45）：目前 runtime 跑通了，但迟早要升 drizzle-orm 到 0.45+。一起升 drizzle-kit 到 0.31+。

5. **SSR 切回去**：
   - 改 `apps/web/app/react-router.config.ts` 的 `ssr: false` → `ssr: true`
   - 所有 `app/routes/*.tsx` 的 `export async function loader({context, request})` 保持——在 SSR 模式下 context.cloudflare.env 可用
   - 在 SPA 模式下 loaders 其实没跑（因为 ssr:false），组件会 mount 之后从客户端 fetch /api/...。切回 SSR 就直接用 loader 数据了
   - 首次 SSR 请求还是会因为 dep pre-bundle 慢个几十秒（打开 vite.config 的 optimizeDeps.include 可以提前列好大部头）

6. **SKIP_LOGIN dev 模式**：`.dev.vars` 或者 `export SKIP_LOGIN=true` 可以绕过 Google OAuth，直接用 dev-user。`session.server.ts` 里有逻辑。

## 未完成 / 后续

- [ ] SSR 开回去（见上）
- [ ] `drizzle-orm`, `drizzle-kit` 升级到 better-auth 要求的版本
- [x] `apps/loro-sync-server/` 物理目录已删除；云端 Loro 同步统一由 `apps/api-cf` 承载。
- [ ] 跑一次完整端到端：登录 → 建项目 → 打开画布 → 上传素材。我这里只验证了 HTML shell 能返回，没跑 API 逻辑。
- [ ] 把 `apps/render-server/Dockerfile` 的路径从 `apps/web/...` 里的老引用检查一下（迁移过程中可能没动到但值得扫一眼）
- [ ] Electron shell：新建 `apps/desktop`，装 `electron` + `react-router` + `vite`，consume `@clash/web-ui`，HashRouter 起手。packages/web-ui 已经准备好了

## 运行命令速查

```bash
# 开发
make dev          # 起 web + api-cf + render

# 单独起
cd apps/web && pnpm vite            # :3000
cd apps/api-cf && pnpm dev          # :8789 (wrangler)
cd apps/render-server && pnpm dev   # :8080 (docker)

# 部署
cd apps/web && pnpm deploy          # vite build → wrangler deploy

# 数据库迁移
cd apps/web && pnpm db:migrate:local

# 当 vite 起不来或卡死
pkill -9 -f "vite|workerd"
rm -rf apps/web/node_modules/.vite apps/web/.react-router
cd apps/web && pnpm vite
```
