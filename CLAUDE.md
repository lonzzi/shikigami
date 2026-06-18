# CLAUDE.md — Shikigami 项目约定

> 给后续 Claude/agent 的项目导航。架构细节看 `docs/ARCHITECTURE.md`，可 import 的契约符号看 `docs/CONTRACT.md`。

## 这是什么

动漫 BT + AI 刮削自托管工具。Hono+Bun 后端 + Vite+React 前端，pnpm monorepo，Docker Compose 部署。

## ⚠️ 提交纪律（最重要，不要违反）

1. **绝对不要用 `git commit --no-verify`**。pre-commit hook (biome check) 和 pre-push hook (typecheck + test + check) 是本地质量门，跳过 = CI 必报错。
2. **每次 commit 前确认 `pnpm exec biome check .` 通过**（0 error）。修完代码先跑 `pnpm exec biome check --write .` 格式化。
3. **每次 push 前确认 `pnpm -r typecheck` + `pnpm test` 通过**。push 会触发 pre-push hook 跑这些，失败就推不上去。
4. **commit 后等 CI 绿了再继续**。如果 CI 报错，修了再 push，不要攒着。
5. **biome 忽略 `.claude/` 目录**（其他任务的 worktree），已配在 `biome.json` 的 `includes`。

## 常用命令

```bash
pnpm install                              # 装依赖
pnpm -r typecheck                         # 全量类型检查
pnpm -r build                             # 全量构建
pnpm exec biome check .                   # lint + format 检查
pnpm exec biome check --write .           # lint + format 自动修复
pnpm --filter @shikigami/backend dev      # 后端 dev (watch)
pnpm --filter @shikigami/web dev          # 前端 dev
pnpm generate                             # prisma generate（改 schema 后必须跑）
pnpm migrate                              # prisma migrate dev（需 DATABASE_URL）

# 本地跑后端（需 .env 配好）
cd apps/backend && bun --env-file=../../.env --watch src/index.ts

# 测试（需 env）
DATABASE_URL="file:$PWD/data/dev.db" JWT_SECRET=... ENCRYPTION_KEY=... LLM_BASE_URL=... QBT_BASE_URL=... ADMIN_PASSWORD=test pnpm --filter @shikigami/backend test
```

## 关键架构约束（不要违反）

1. **前后端 hono 版本必须一致**（pnpm catalog 锁定）。改 hono 要同时改 `apps/web` 和 `apps/backend`。
2. **后端核心类型契约冻结**在 `apps/backend/src/lib/*`、`scrapers/types.ts`、`llm/schema.ts`、`media/types.ts`。改这些前先看会不会破坏叶子模块。
3. **Prisma 用新 generator** (`prisma-client`，输出 `generated/prisma`)。import Prisma 类型从 `../../generated/prisma/client`。DB 改 schema 后必须 `prisma migrate dev`。schema 里 `binaryTargets` 包含了 `linux-arm64-openssl-3.0.x`（Docker 部署用），不要删。
4. **做种不打断**：下载层绝不调 `removeTorrent(hash, true)`，只 `false`（删任务保留数据）。
5. **硬链接前提**：`/downloads` 与 `/media/library` 必须同文件系统。
6. **AI 输出走结构化 JSON**：`AnimeMetaSchema`（`llm/schema.ts`）。`response_format` 按 `supportsJsonSchema()` 能力探测二选一（strict json_schema / json_object）。reasoning 模型(glm-5.2/minimax-m3)输出有 `<think>` 和 ```json 包裹，`extractJson()` 负责提取。
7. **调度用 setInterval**（`scheduler/cron.ts`），不是 Bun.cron。
8. **优雅关闭**：pause 队列 → drain(≤30s) → running JobRun 回滚 queued → `PRAGMA wal_checkpoint(TRUNCATE)`（必须用 `$queryRawUnsafe`）→ `$disconnect`。
9. **qBittorrent 集成走 `lib/qb-direct.ts`**（直接 SID 认证），不用 `@ctrl/qbittorrent`（它在 qB v5 上 cookie 鉴权坏）。`@ctrl/qbittorrent` 只保留 `getAppVersion`/`getApiVersion`/`listTorrents`/`removeTorrent` 等只读操作。
10. **dmhy magnet 的 btih 是 base32**，`parseInfoHash()` 自动转 hex（qB v5 只认 hex）。
11. **HTTP 请求走 `lib/http.ts`**，自动从 `HTTPS_PROXY` env 读取代理（Bun fetch 的 `{ proxy }` 选项）。qB 直连(内网)，不走代理。

## 文件地图

- 入口：`apps/backend/src/index.ts`（Bun.serve + 生命周期）
- 路由：`apps/backend/src/routes/*.ts`，组合在 `app.ts`
- 后端 RPC 类型：`apps/backend/src/app.ts` 的 `export type AppType`，前端 `apps/web/src/lib/api.ts` 用 `hc<AppType>` 消费
- 调度：`apps/backend/src/scheduler/`（queues/cron/reconcile/shutdown/jobs/）
- 抓取：`apps/backend/src/scrapers/`（dmhy/mikan/nyaa/bangumimoe + registry）
- 解析：`apps/backend/src/parser/`（anitomy 自实现/regex-cn/confidence/collection）
- 元数据：`apps/backend/src/metadata/`（bangumi/tmdb/resolve/mapping）
- AI：`apps/backend/src/llm/`（client/scrape/fewshot/cost/schema）
- 下载+导入：`apps/backend/src/downloader/`（qbittorrent/import/diskcheck）
- 重命名+媒体：`apps/backend/src/media/`（rename/nfo/jellyfin/emby）

## 测试实例

qBittorrent 测试实例（见 memory `qbittorrent-test-instance`）：`http://home.ronki.moe:16280`，admin / (见 memory)。密码含特殊字符，写 .env 用单引号。

## 部署

服务器 `root@home.ronki.moe`（见 memory `server-deployment`），aarch64，Docker。
- 仓库 clone 在 `/ssd/shikigami`，`.env` 已配好
- 容器：`docker run --network host --env-file .env -v ./data:/data -v /ssd/downloads:/ssd/downloads -v /ssd/media:/ssd/media shikigami:test`
- Dockerfile: node:22-slim build(pnpm) + bun:1.3 runtime。catalog 语法需 pnpm(bun 不认)。
- Docker daemon 配了 proxy(7890) + registry-mirror(docker.1panel.live)。data-root 在 `/ssd/data/docker`，**不要改**。

## 已知限制 / 待办

- `metadata/animelist.ts` 是占位实现。
- 前端用编程式 TanStack Router + lazyRouteComponent 懒加载。
- `better-queue` 的 `retryDelay` 只支持数字常量（非函数），故用固定 5s 退避。
- 服务器直连 dmhy 可能不稳定（需要代理），本地直连通常 OK。
```

