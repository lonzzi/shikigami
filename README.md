# Shikigami

自托管番剧订阅与下载管理工具,集成 qBittorrent 与 Jellyfin/Emby。

- **订阅抓取**: dmhy / mikan / nyaa / bangumimoe RSS, 关键词 + 字幕组筛选
- **下载**: qBittorrent Web API, 完成轮询 + 做种不打断
- **刮削**: 文件名识别 → 结构化元数据, OpenAI 兼容 API (可接 Ollama 本地模型)
- **元数据**: TMDB 绑定 (tmdbId/tvdbId) + Bangumi 中文译名
- **媒体库**: Jellyfin/Emby 命名规范重命名 + 硬链接 (兼顾做种) + NFO
- **前端**: React + TanStack Router/Query, 6 大模块

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Hono + Bun + TypeScript |
| 前端 | Vite + React 19 + TanStack Router/Query + Tailwind v4 |
| 数据库 | SQLite + Prisma 6 |
| 部署 | Docker Compose |

完整设计见 `docs/ARCHITECTURE.md`。

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env: 至少填 JWT_SECRET / ENCRYPTION_KEY（openssl rand -hex 32）
#           ADMIN_PASSWORD、QBT_* 、LLM_* （可填 .env 也可登录后在前端设置页改）
```

生成密钥：
```bash
openssl rand -hex 32  # JWT_SECRET
openssl rand -hex 32  # ENCRYPTION_KEY
```

### 2. 本地开发

```bash
pnpm install
pnpm --filter @shikigami/backend exec prisma generate
pnpm --filter @shikigami/backend exec prisma migrate dev

# 终端 1: 后端
pnpm --filter @shikigami/backend dev    # http://localhost:3000

# 终端 2: 前端（代理 /api → 后端）
pnpm --filter @shikigami/web dev         # http://localhost:5173
```

### 3. Docker 部署（推荐）

宿主目录结构（同一文件系统，保证硬链接可用）：
```
/mnt/media/downloads   ← qB 下载目录（backend 与 qB 共享）
/mnt/media/library     ← Jellyfin 媒体库（backend 写入硬链接）
```

```bash
cp .env.example .env  # 填好密钥与 QBT_BASE_URL=http://qbittorrent:8080

docker compose up -d backend qbittorrent           # 核心（后端 + qB）
docker compose --profile jellyfin up -d jellyfin    # 可选 Jellyfin
```

访问 `http://<host>:3000`，默认账号 `admin`（密码见 `.env` 的 `ADMIN_PASSWORD`）。

> 后端容器会把前端构建产物一并托管，无需单独跑前端。

## 核心数据流

```
用户建订阅 → cron 抓 RSS → 规则匹配 → 投 qBittorrent
  → 轮询检测完成 → AI 识别文件名 → 查 Bangumi/TMDB
  → 硬链接重命名（保做种）+ 写 NFO → 触发 Jellyfin/Emby 扫描
```

## 关键设计决策

- **硬链接而非移动**：媒体库文件与 qB 做种文件共享 inode，不占双倍空间。前提是 `/downloads` 与 `/media/library` 在同一文件系统（compose 已映射为同宿主目录）。
- **AI 识别 + 人工兜底**：低置信或交叉验证不过的文件进「刮削确认」队列，人工修正会回写 FewShot 自学习池。
- **季/绝对集映射**：字幕组常用连续编号（跨季），`seasonOffset` 把绝对集映射到 SxxExx，支持人工覆盖（EpisodeOverride）。
- **做种不打断**：放弃任务只 `removeTorrent(hash, false)`，绝不删数据。

## 目录结构

```
shikigami/
├── apps/
│   ├── backend/         # Hono + Bun 后端
│   │   ├── prisma/      # schema + migrations
│   │   └── src/
│   │       ├── routes/  # API 路由
│   │       ├── scrapers/# dmhy/mikan/nyaa/bangumimoe 抓取
│   │       ├── llm/     # AI 刮削（OpenAI 兼容）
│   │       ├── metadata/# Bangumi/TMDB + 季集映射
│   │       ├── downloader/ # qBittorrent + 文件导入
│   │       ├── media/   # 重命名 + Jellyfin/Emby/NFO
│   │       └── scheduler/ # cron + 队列 + 优雅关闭
│   └── web/             # React 前端
└── docs/
    ├── ARCHITECTURE.md  # 完整设计文档
    └── research-findings.json
```

## License

MIT
