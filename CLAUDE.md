# CLAUDE.md — Shikigami 项目约定

> 给后续 Claude/agent 的项目导航。架构细节看 `docs/ARCHITECTURE.md`，可 import 的契约符号看 `docs/CONTRACT.md`。

## 这是什么

动漫 BT + AI 刮削自托管工具。Hono+Bun 后端 + Vite+React 前端，pnpm monorepo，Docker Compose 部署。

## 常用命令

```bash
pnpm install                              # 装依赖
pnpm -r typecheck                         # 全量类型检查
pnpm -r build                             # 全量构建
pnpm --filter @shikigami/backend dev      # 后端 dev (watch)
pnpm --filter @shikigami/web dev          # 前端 dev
pnpm migrate                              # prisma migrate dev（需 DATABASE_URL）
pnpm generate                             # prisma generate

# 本地跑后端（需 env）
cd apps/backend && DATABASE_URL="file:$PWD/../../data/dev.db" JWT_SECRET=... ENCRYPTION_KEY=... LLM_BASE_URL=... QBT_BASE_URL=... ADMIN_PASSWORD=test bun run src/index.ts

# 测试
pnpm --filter @shikigami/backend test     # bun test
```

## 关键架构约束（不要违反）

1. **前后端 hono 版本必须一致**（pnpm catalog 锁定）。改 hono 要同时改 `apps/web` 和 `apps/backend`。
2. **后端核心类型契约冻结**在 `apps/backend/src/lib/*`、`scrapers/types.ts`、`llm/schema.ts`、`media/types.ts`。改这些前先看会不会破坏叶子模块。
3. **Prisma 用新 generator** (`prisma-client`，输出 `generated/prisma`)。import Prisma 类型从 `../../generated/prisma/client`。DB 改 schema 后必须 `prisma migrate dev`。
4. **做种不打断**：下载层绝不调 `removeTorrent(hash, true)`，只 `false`（删任务保留数据）。
5. **硬链接前提**：`/downloads` 与 `/media/library` 必须同文件系统（compose 已映射同宿主目录）。
6. **AI 输出走结构化 JSON**：`AnimeMetaSchema`（`llm/schema.ts`）。`response_format` 按 `supportsJsonSchema()` 能力探测二选一（strict json_schema / json_object）。
7. **调度用 setInterval**（`scheduler/cron.ts`），不是 Bun.cron（该版本 bun-types 的 cron 是模块路径模式，不适合内联回调）。
8. **优雅关闭**：pause 队列 → drain(≤30s) → running JobRun 回滚 queued → `PRAGMA wal_checkpoint(TRUNCATE)`（必须用 `$queryRawUnsafe`，executeRaw 会报 "returned results"）→ `$disconnect`。

## 文件地图

- 入口：`apps/backend/src/index.ts`（Bun.serve + 生命周期）
- 路由：`apps/backend/src/routes/*.ts`（15 个），组合在 `app.ts`
- 后端 RPC 类型：`apps/backend/src/app.ts` 的 `export type AppType`，前端 `apps/web/src/lib/api.ts` 用 `hc<AppType>` 消费
- 调度：`apps/backend/src/scheduler/`（queues/cron/reconcile/shutdown/jobs/）
- 抓取：`apps/backend/src/scrapers/`（dmhy/mikan/nyaa/bangumimoe + registry）
- 解析：`apps/backend/src/parser/`（anitomy 自实现/regex-cn/confidence/collection）
- 元数据：`apps/backend/src/metadata/`（bangumi/tmdb/mapping）
- AI：`apps/backend/src/llm/`（client/scrape/fewshot/cost/schema）
- 下载+导入：`apps/backend/src/downloader/`（qbittorrent/import/diskcheck）
- 重命名+媒体：`apps/backend/src/media/`（rename/nfo/jellyfin/emby）

## 测试实例

qBittorrent 测试实例（见 memory `qbittorrent-test-instance`）：`http://home.ronki.moe:16280`，admin / (见 memory)。密码含特殊字符，写 .env 用单引号。

## 已知限制 / 待办

- `metadata/animelist.ts` 是占位实现（AniDB→TVDB 映射），生产前需补全 anime-lists.xml 解析。
- `scrapers/fansub.ts`、`scrapers/backfill.ts`、`parser/filename.ts`（三段式入口）尚未接线，当前直接在 `scheduler/jobs/scrape.ts` 内联 anitomy+regex→AI。
- mikan/bangumi.moe 的 infoHash 需 `.torrent` 解析（webtorrent），当前保留 torrentFileUrl。
- 前端用编程式 TanStack Router（非文件路由），如需文件路由需重新接线 + 启用 router-plugin。
- `routes/task.ts` 手动添加 torrentUrl（非 magnet）时 infoHash 用了 URL 占位（未解析真实 btih），生产前应补 `.torrent` 下载 + hash 计算。
- `better-queue` 的 `retryDelay` 只支持数字常量（非函数），故用固定 5s 退避（见 `scheduler/queues.ts`）。
