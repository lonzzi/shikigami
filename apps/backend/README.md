# @shikigami/backend

Hono + Bun 后端服务。

## 职责

- **抓取层**: dmhy / mikan / nyaa / bangumimoe RSS 适配器 (base32 btih → hex 自动转换)
- **下载层**: qBittorrent Web API 集成 (直接 SID 认证,绕过 @ctrl/qbittorrent cookie bug)
- **AI 刮削**: OpenAI 兼容 API 识别文件名 → 结构化 JSON (适配 reasoning 模型)
- **元数据**: TMDB 绑定 (tmdbId/tvdbId) + Bangumi 中文译名
- **媒体层**: Jellyfin/Emby 命名规范重命名 + 硬链接 (兼顾做种) + NFO
- **调度层**: 进程内 cron + better-queue, 优雅关闭 WAL checkpoint

## 目录结构

```
src/
├── index.ts          # 入口: Bun.serve + 生命周期
├── app.ts            # Hono 路由组合 + AppType (前端 RPC 类型)
├── routes/           # API 路由 (15 个)
├── middleware/       # requestId / logger / error / auth
├── lib/              # env / prisma / http / crypto / qb-direct / ...
├── scrapers/         # dmhy/mikan/nyaa/bangumimoe 站点适配器
├── parser/           # anitomy (自实现) / regex-cn / confidence
├── metadata/         # tmdb / bangumi / resolve (TMDB 绑定) / mapping (季集映射)
├── llm/              # client / scrape / schema / fewshot / cost
├── downloader/       # qbittorrent / import (硬链接) / diskcheck
├── media/            # rename / nfo / jellyfin / emby
├── notify/           # telegram / 企业微信
└── scheduler/        # cron / queues / reconcile / shutdown / jobs/
```

## 常用命令

```bash
bun run dev           # watch 模式 (读 .env)
bun run build         # 生产构建
bun run typecheck     # 类型检查
bun test              # 单元测试 (53 个)
bun run db:migrate    # prisma migrate dev
bun run generate      # prisma generate
```

## 环境变量

见根目录 `.env.example`。启动前必须设置: `DATABASE_URL` / `JWT_SECRET` / `ENCRYPTION_KEY` / `ADMIN_PASSWORD` / `LLM_BASE_URL` / `QBT_BASE_URL`。
