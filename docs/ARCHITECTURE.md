# Shikigami 设计文档
## 动漫 BT + AI 刮削自托管工具（参考 nastools / *arr / AutoBangumi）

> 本文档为吸收 4 个视角（完整性 / 动漫契合度 / AI 成本 / 运维）对抗性评审意见后的**最终版**。修订要点见末尾「# 12. 评审修订记录」。

---

## 1. 项目概述与技术栈

| 层 | 选型 | 版本（已核实） | 为什么 / 替代方案对比 |
|---|---|---|---|
| 运行时 | **Bun** | `^1.3.14` | 原生 `Bun.serve` / `Bun.cron` / 内置 SQLite（仅用于 dev/migrate）+ `globalThis.fetch` + 零依赖 fast fs。替代 Node：需要额外 node-cron、node-fetch，体量更大。 |
| 后端框架 | **Hono** | `^4.12.25` | Web Standards、Bun 一等公民、`hono/client` RPC 类型安全、中间件生态完备。前后端**必须锁同版本**，否则 RPC 类型会深层实例化爆炸。 |
| Schema/校验 | **zod** | `^4.4.3` | 全栈统一 v4。补 Prisma SQLite 无 JSON/enum 约束的缺口。 |
| 路由校验 | `@hono/zod-validator` | `^0.8.0` | RPC 类型来源。 |
| OpenAPI（后置） | `@hono/zod-openapi` + `@scalar/hono-api-reference` | `^1.4.0` / `^0.11.3` | 锦上添花，MVP 不上。 |
| ORM | **Prisma** | `^6.19.x` | SQLite 驱动、migrate、TS 类型完善。锁定 6.x（生态最稳），7.x 待 Bun 兼容确认后再升。 |
| 任务队列 | **better-queue** | `^3.8.12` | concurrent / maxRetries / retryDelay（指数退避+抖动）/ id 幂等 / precondition 一站式；fallback `p-queue@^8`（ESM-only）。**注意**：`.on('drain')` 返回 EventEmitter 而非 Promise，优雅关闭需手动包 Promise（见 5.4）。 |
| 定时 | **Bun.cron** | 内置 | 零依赖、天然 no-overlap；**必须显式校验 env 传入的 cron 表达式**，错格式 fail-fast；启动时探测是否真正读取 `TZ` 环境变量，否则显式传 timezone 选项。 |
| XML 解析 | **fast-xml-parser** | `^4.5.x` | 纯 JS、Bun 友好；`ignoreAttributes:false` 读 `enclosure.@_url` / `nyaa:infoHash`，`isArray` 强制 `item` 为数组。 |
| 文件名解析 | **anitomy**（纯 TS 版） | `0.0.35` | 针对 dmhy 英文/罗马音命名优化、零 native 依赖。**关键修订**：anitomy 输出**没有 `confidence` 字段**（类型定义核验：`{file,audio,episode,release,video,...}`），需自建启发式置信度（见 5.2）。备用 `anitomy-js@5.4.0`（C++ 绑定，需 Docker 内编译，覆盖率更高）。 |
| AI 客户端 | **openai**（官方 SDK） | `^6.42.0` | 支持 `baseURL` 连 Ollama / 任意兼容网关。**关键修订**：`response_format: json_schema strict` 与 prompt caching **仅 OpenAI 官方端点保证**；Ollama / 第三方兼容网关大多仅支持 `json_object` 或两者都不支持，需能力探测 + 明确降级路径（见 5.2）。**不用 function/tool calling** 做刮削（结构化输出而非工具调用，省一次往返+token）。 |
| Schema 转 JSON Schema | `zod-to-json-schema` | `3.25.2` | `strict` 模式需 `additionalProperties:false`。**注意**：zod-to-json-schema 产物字段顺序随 zod 版本变化，是脆性前缀，需做版本固定 + schema hash 校验。 |
| 下载器 | **@ctrl/qbittorrent** | `^9.13.0` | TS 一等、基于 ofetch + node-fetch-native（exports 含 `"bun"` 条件，走原生 fetch）；自动 SID 管理、v5.2 API Key 鉴权、完整类型。 |
| 种子解析（磁链补全） | **webtorrent** | `^2.x` | 解析 mikan/bangumi.moe/nyaa 的 `.torrent` 提 infoHash 拼 magnet（可选）。 |
| 限流 | **p-limit** | `^6.x` | 进程内令牌桶，bgm.tv ≤1 req/s、各站独立桶。 |
| 前端运行时 | **React** | `^19.x` | shadcn/ui 已支持 React 19。 |
| 前端构建 | **Vite** | `^8.0.16`（保守可锁 7.x LTS） | `@vitejs/plugin-react@6.0.2` + `@tailwindcss/vite@4.3.1` + `@tanstack/router-plugin@1.168.18`（**必须在 react 之前**）。 |
| 前端 UI | **Tailwind v4 + shadcn/ui** | `4.3.1` / CLI `2.9.0` | CSS-first（无 tailwind.config.js）。 |
| 路由 | **TanStack Router** | `^1.170.15` | 类型安全文件式路由、search-param 类型推导、与 Query context 原生集成。 |
| 数据获取 | **TanStack Query** | `^5.101.0` | 服务端状态缓存/失效。 |
| 结构化日志 | **pino** | `^9.x` | JSON 日志 + 级别分级 + request id / job kind；替代裸 `console.error`。 |
| Monorepo | **pnpm workspaces** + `catalog` | pnpm 最新 | catalog 统一 hono 版本（RPC 强约束）。 |
| 部署 | **Docker Compose** | — | `oven/bun:1.3` 基础镜像，后端托管前端 dist。 |
| 目标用户 | 中文动漫社区 | — | 字幕组 fansub 命名、季番/绝对集映射、双语/字幕/字体、放送日历发现为核心痛点。 |

---

## 2. 系统架构

### 2.1 组件清单

```
┌─────────────────────────────────────────────────────────────────────┐
│                         apps/web (React SPA)                         │
│   TanStack Router + Query · hono/client RPC (类型安全)               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ 同源 /api/* (生产由后端 serveStatic)
┌──────────────────────────────▼──────────────────────────────────────┐
│                    apps/backend (Hono + Bun)                         │
│  ┌───────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ ┌───────────┐  │
│  │ API 层    │ │ 调度层   │ │ 抓取层  │ │ 订阅引擎 │ │ 下载层    │  │
│  │ Hono RPC  │ │Bun.cron+ │ │SiteAdapter│ │规则匹配 │ │ qBittor.  │  │
│  │ Zod 校验  │ │better-q  │ │ dmhy/mikan│ │ Magnet   │ │ @ctrl/qb  │  │
│  └───────────┘ └──────────┘ │ nyaa/bgmoe│ │ Seen去重 │ └─────┬─────┘  │
│  ┌───────────┐ ┌──────────┐ └─────┬────┘ │ +Episode │       │        │
│  │ AI 刮削层 │ │ 重命名&  │       │       │  去重    │       │        │
│  │ OpenAI 兼 │ │ 媒体服务 │       │       └──────────┘       │        │
│  │ 容+Zod    │ │ Jellyfin/│       │                          │        │
│  │ +ScrapeC. │ │ Emby/NFO │       │                          │        │
│  └─────┬─────┘ └──────────┘       │                          │        │
│        │                          │                          │        │
│  ┌─────▼─────────────────┐ ┌──────▼────────────────────┐      │        │
│  │ FewShot 池(自学习)    │ │ 元数据源                  │      │        │
│  │ EpisodeOverride 人工  │ │ Bangumi v0 (calendar/rel) │      │        │
│  │ 覆盖表                │ │ TMDB v3 / anime-lists.xml │      │        │
│  └───────────────────────┘ └─────┬───────────────────────┘      │        │
│        │ Prisma (SQLite, WAL)     │                              │        │
│  ┌─────▼──────────────────────────▼──────────────────────────────▼─────┐ │
│  │              共享 Volume: /downloads + /media/library               │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Docker 网络 (同卷, 硬链接前提)
                  ┌────────────▼────────────┐
                  │  qBittorrent (Web API)  │
                  │  Jellyfin / Emby (可选) │
                  └─────────────────────────┘
```

**组件职责**（含修订新增）：

| 组件 | 职责 | 外部依赖 |
|---|---|---|
| API 层 | Hono 路由 + Zod 校验 + hono/client 类型导出 + 鉴权 + 错误处理 | Prisma |
| 调度层 | `Bun.cron` 注册周期任务；`better-queue` 多队列；**正确的优雅关闭**（手动包 drain Promise）；启动 reconcile | Prisma JobRun |
| 抓取层 | `SiteAdapter` 接口四站实现；**dmhy sort_id=1（动画）/2（季度合集）分流**；**fansub 发现（team_id 搜索）**；**RSS 回填**（按 topic_id/keyword/team_id）；统一归一化 `Torrent`；XML 解析、限流、缓存去重、熔断 | dmhy/mikan/nyaa/bgmoe |
| 订阅引擎 | 规则匹配（fansub/分辨率/关键词/黑名单/语言偏好）+ `MagnetSeen` 全局去重 + **`EpisodeDedup` (seriesId,episodeId) 二级去重**（合集与单集撞集） | Prisma |
| 下载层 | qB add/list/rename/delete；**全 state 轮询（含 error/stalledDL）**；**addMagnet 响应解析（Ok./Already added./Fails. 三态）**；完成轮询；硬链接导入；**EEXIST 冲突处理** | qBittorrent Web API |
| AI 刮削层 | 文件名 → 结构化 `AnimeMeta`；**三段式：anitomy 字段完整度评分 + 中文正则字段完整度评分 + AI 兜底仲裁**；**ScrapeCache 文件名指纹缓存**；交叉验证（Bangumi 搜索召回校验 AI title）；待人工确认队列；**FewShotSample 自学习池** | OpenAI 兼容 API |
| 元数据层 | Bangumi v0（**`/calendar` 新番发现** + 中文主键、集数映射、relations）+ TMDB v3（封面/英文/episode_groups 绝对集）+ **anime-lists.xml（AniDB→TVDB 映射，回填 tvdbId）** | bgm.tv / TMDB |
| 重命名 & 媒体服务器层 | Jellyfin/Emby 命名规范、季/集映射（**修正后的 mapAbsoluteToSeason 算法**）、**路径 sanitize**、**外挂字幕与字体处理**、NFO 写入、硬链接、**tvdbId 缺失降级刷新链**、触发扫描 | Jellyfin/Emby |
| 前端 | 6 大模块（订阅/任务/媒体库/刮削结果/设置/放送日历）+ 仪表盘 + **批量人工确认** | 后端 RPC |
| 可观测性 | pino 结构化日志 + liveness/readiness 分离 + metrics 聚合（队列深度 / 抓取成功率 / qB 状态 / AI 调用次数与费用 / 磁盘占用） + 失败熔断 + 告警 | — |

### 2.2 完整数据流

```
新番发现（Web 一键导入 / 自动）
  · GET /api/calendar 代理 bgm.tv /calendar → 按星期分组的本季新番
  · 用户勾选 → POST /api/series/search 落库 Series + 默认 Subscription
        │
        ▼
用户建订阅 (Web, fansub=ANi / 关键词="葬送的芙莉莲" / 分辨率>=1080p
                  / preferredLang=CHS / 黑名单=HEVC)
        │
        ▼  写 Subscription 表
[调度: Bun.cron 每 15min]  ← 合并所有订阅到一次 cron 周期，先拉全站 RSS 再内存匹配
        │
        ▼
抓取层 SiteAdapter.fetchLatest / fetchByKeyword / fetchByTeam
   · dmhy: sort_id=1（動畫，每周单集）主用；sort_id=2（季度合集）补充
           enclosure.url 直接是 magnet
   · nyaa: nyaa:infoHash 拼 magnet（c=1_3=Non-English，含中文字幕组但也含日文，
           靠关键词+标题语言检测定向，不依赖分类号）
   · mikan/bgmoe: 仅 .torrent URL → webtorrent 解析 infoHash 拼 magnet + 公共 tr
   · RSS 回填: 若发现 gap (当前 RSS 最早 pubDate > lastSeenPubDate + 容差),
     按 team_id/keyword/bangumiId 分页抓历史列表
        │  归一化为 Torrent {source,title,magnet,infoHash,size,pubDate,fansub,
        │                    subtitleLang?,rawItem}
        ▼
订阅引擎 matchRule(torrent, subscription)
   · anitomy/正则提取 fansub/resolution/episode/subtitleLang
   · 命中黑名单/分辨率/关键词/语言偏好 → 通过
        │
        ▼
去重 MagnetSeen (infoHash 全局唯一) —— 命中且未标 deleted 则跳过
        │  新增 → upsert DownloadTask(status=PENDING, infoHash, magnet)
        ▼
下载层（先做磁盘预检）
   · GET /api/v2/sync/maindata server_state.free_space vs sizeBytes，
     不足则标 PENDING_DISK_FULL + 通知，不入 qB
   · qB addMagnet(...):
       响应 "Ok."         → DOWNLOADING
       响应 "Already added." → 幂等成功（视为已添加，不报错不重试）
       响应 "Fails."      → ERROR，重试
        │  DownloadTask.status = DOWNLOADING
        ▼
[调度: Bun.cron 每 30s]  pollQbittorrent()
   · listTorrents()（不带 filter，全量分类）
   · state ∈ {uploading, pausedUP, stoppedUP, stalledUP, ...} 或 progress===1
        → COMPLETED
   · state ∈ {error, missingFiles}
        → ERROR + Telegram 告警 + 用户可手动 RETRY/ABANDON
   · state === stalledDL 持续 > stalledThreshold (默认 24h)
        → ABANDONED + 删除 MagnetSeen 记录（允许换源/降级重下）
   · completion_on 为去重指纹
        │  DownloadTask.status = COMPLETED
        ▼
导入任务入队 (importQueue) ──► 种子内容枚举（修订新增）
   1. 遍历 qB content_path 下所有视频/字幕/字体文件，每文件生成 MediaFile
      · kind: video | subtitle | font | other
      · 合集种子: 先用 anitomy/AI 解析包标题确定 series+季,
        再对包内每个文件按文件名(通常含集数)或顺序分配 absoluteNumber/epInSeason
      · 合集 vs 单集: 用 EpisodeDedup (seriesId, episodeId) 二级去重
        (MagnetSeen 按 infoHash 去重无法拦合集/单集撞集)
   2. AI 刮削层（每文件）
      a. 三段式解析:
         · anitomy 输出 + 启发式 confidenceA (字段完整度评分, 非库自带)
         · 中文正则 + 启发式 confidenceR
         · 命中"快路径"(anitomy 同时给 release_group+episode_number+title 且非
           中英混合混名) 才直通；否则一律送 AI 仲裁
      b. AI 调用前先查 ScrapeCache (按归一化文件名指纹), 命中直接返回
      c. AI 输出 + Zod 校验 + 交叉验证(AI title_cn 必须 Bangumi 搜索召回且
         标题相似度>阈值, 否则强制 needs_review=true, 不管 confidence 多高)
      d. 标题三态(titleJp/titleCn/titleEn) 一律以 Bangumi/TMDB 回填为权威,
         AI 不输出 title_ro (避免与权威值冲突)
      e. confidence<阈值(云端 0.7 / 本地 0.8) || needs_review || Zod 失败
         → PendingScrape 队列（前端人工确认）
        │  通过 → 写 ScrapeResult 到 MediaFile
        ▼
元数据层
   · Bangumi POST /v0/search/subjects → subject_id（type=2）
   · GET /v0/episodes?subject_id=&type=0 → 本篇集表（ep=条目内, sort=全局）
   · GET /v0/subjects/{id}/subjects → relations 构建系列树，算 seasonOffset
   · TMDB：封面/still/英文标题（absolute numbering 走 /tv/{id}/episode_groups）
   · anime-lists.xml：AniDB→TVDB 映射，回填 Series.tvdbId
   · 缓存到 Prisma Anime/Episode 表（7-30 天 TTL）
   · Series.lockedAt 已锁定 → 元数据刷新跳过覆盖（仅补缺）
        │
        ▼
重命名 & 媒体服务器层
   · 绝对集 → SxxExx 映射:
       优先级 = EpisodeOverride(人工覆盖) > seasonOffset + courMode > AI 推断
       mapAbsoluteToSeason 算法（修正版，见 5.3）
   · 按 episode_type 分流路径模板:
       normal → Season XX/SxxExx
       special/ova → Season 00/S00Exx
       movie → 独立 Movie 目录（不进 Season 结构）
   · buildLibraryPath 入口断言 epInSeason 非空, 否则抛错进人工队列
   · sanitizePathSegment(): 替换非法字符 : ? * | / < > " 为 _，trim，限长
   · Bun.fs.link(src=qB content_path, dst=媒体库) — 硬链接，做种不打断
       EEXIST → stat 比较 inode:
         同 inode → 视为已导入, 跳过 (幂等)
         不同 inode → 冲突策略: 语言后缀 / 字幕组维度 / 拒绝入人工队列
       EXDEV → fallback copyFile（磁盘翻倍，文档强警告）
   · 视频与字幕用同一 basename（仅扩展名 + 语言后缀不同）确保 Jellyfin 自动挂载
       字幕: <番名> S01E01.zh-CN.ass
       字体: 单独归档（Jellyfin 不识别）
   · 写 tvshow.nfo (<uniqueid> 锁定) + 单集 .nfo
   · 写 poster.jpg / fanart.jpg（TMDB image CDN）
        │  MediaFile.scrapeState: PENDING→MATCHED→REVIEWED→RENAMED→EXPORTED
        │                       （失败可重跑; REVIEWED/LOCKED 默认 rescrape 跳过）
        ▼
触发扫描（tvdbId 缺失降级链）
   · tvdbId 存在 → POST {base}/Library/Series/Updated?tvdbId=xxx （首选）
   · tvdbId 缺失 → POST {base}/Library/Media/Updated body {Updates:[{Path}]}
   · 仍失败 → POST {base}/Library/Refresh （需 admin，兜底）
   · 调用失败必须落 JobRun.error 并可重试，绝不静默吞
        │
        ▼
通知（可选） Telegram / 企业微信 webhook
   · PendingScrape 队列长度告警（如 >50 条通知）
   · 抓取熔断告警（连续 3 次 403/超时）
```

### 2.3 关键边界与事件

- **同步边界**：RSS 拉取（15min）→ DB upsert → 内存队列入队。**绝不在 cron handler 内同步走完整个链路**，各阶段异步入独立队列。
- **完成检测边界**：qBittorrent **无 webhook**，必须轮询；轮询**全 state**（含 error/stalledDL），不止 completed。
- **硬链接边界**：`/downloads` 与 `/media/library` **必须在同一文件系统**，否则 EXDEV；Docker Compose 用同一 host 目录双挂，且 `/media/downloads` 在 Jellyfin 中排除扫描。
- **硬链接幂等边界**：EEXIST 必须显式处理（stat 比 inode），否则 reconcile/rescrape 永久失败。
- **做种不打断**：导入只硬链接 + 重命名（硬链 inode），**绝不** `removeTorrent(hash, true)`；做种达标后 `removeTorrent(hash, false)` 保留数据。
- **AI 边界**：低置信度 **绝不**自动重命名；REVIEWED/LOCKED 文件 rescrape 默认跳过。
- **能力探测边界**：json_schema strict / prompt caching **仅 OpenAI 官方端点保证**；非官方端点降级到 json_object + 强约束 system prompt + Zod 兜底；能力探测带 TTL（每小时或连续失败 N 次后重探）。
- **v4/v5 兼容**：完成态判定同时容忍 `pausedUP` 与 `stoppedUP`。
- **人工覆盖权威边界**：EpisodeOverride > seasonOffset + courMode > AI 推断；Series.lockedAt 锁定后元数据刷新仅补缺。

---

## 3. 仓库结构（monorepo）

```
shikigami/
├── pnpm-workspace.yaml              # packages: ['apps/*', 'packages/*'] + catalog
├── package.json                     # 根 scripts (dev/build/migrate via pnpm -r)
├── turbo.json                       # 可选: build 编排
├── tsconfig.base.json               # strict:true, composite, references
├── .env.example                     # 与 compose 逐项对齐
├── docker-compose.yml               # healthcheck + stop_grace_period + condition:service_healthy
├── Dockerfile                       # 多阶段: build web → bun build backend → 精简 runtime
├── docker-entrypoint.sh             # prisma migrate deploy && exec bun run
└── apps/
    ├── backend/
    │   ├── package.json             # name: @shikigami/backend
    │   ├── tsconfig.json
    │   ├── prisma/
    │   │   ├── schema.prisma        # datasource 统一 file:/data/shikigami.db
    │   │   └── migrations/
    │   ├── src/
    │   │   ├── index.ts             # Bun.serve + reconcileStartup + SIGTERM/SIGINT + unhandledRejection
    │   │   ├── app.ts               # 组合 .route('/api/...')，导出 AppType
    │   │   ├── client.ts            # hcWithType 助手
    │   │   ├── types.ts
    │   │   ├── logger.ts            # pino 单例 + requestId 中间件
    │   │   ├── metrics.ts           # 内存 metrics 聚合 + /api/metrics + /api/health 分级
    │   │   ├── routes/
    │   │   │   ├── auth.ts
    │   │   │   ├── calendar.ts      # 新番发现（修订新增）
    │   │   │   ├── fansub.ts        # 字幕组搜索（修订新增）
    │   │   │   ├── subscription.ts
    │   │   │   ├── feed.ts
    │   │   │   ├── task.ts          # +force redownload
    │   │   │   ├── library.ts
    │   │   │   ├── scrape.ts        # +batch review
    │   │   │   ├── qbittorrent.ts
    │   │   │   ├── metadata.ts
    │   │   │   ├── settings.ts
    │   │   │   ├── job.ts
    │   │   │   ├── metrics.ts       # 仪表盘数据（修订新增）
    │   │   │   └── override.ts      # EpisodeOverride CRUD（修订新增）
    │   │   ├── middleware/
    │   │   │   ├── auth.ts
    │   │   │   ├── error.ts
    │   │   │   ├── logger.ts
    │   │   │   └── requestId.ts
    │   │   ├── lib/
    │   │   │   ├── prisma.ts
    │   │   │   ├── env.ts           # zod 校验 env（含 cron 表达式格式校验）
    │   │   │   ├── crypto.ts        # ENCRYPTION_KEY 派生（独立于 JWT_SECRET）
    │   │   │   ├── http.ts
    │   │   │   ├── ratelimit.ts
    │   │   │   ├── circuit.ts       # 熔断（连续 N 次失败冷却 X 分钟）
    │   │   │   ├── path.ts          # sanitizePathSegment（修订新增）
    │   │   │   └── statvfs.ts       # 磁盘占用（修订新增）
    │   │   ├── scrapers/
    │   │   │   ├── types.ts         # Torrent + subtitleLang 字段
    │   │   │   ├── normalize.ts
    │   │   │   ├── dmhy.ts          # sort_id=1/2 分流；fetchByTeam 路径修正
    │   │   │   ├── mikan.ts
    │   │   │   ├── nyaa.ts          # 修正分类号语义
    │   │   │   ├── bangumimoe.ts
    │   │   │   ├── fansub.ts        # team_id 发现（修订新增）
    │   │   │   ├── backfill.ts      # RSS 漏集回填（修订新增）
    │   │   │   └── index.ts
    │   │   ├── parser/
    │   │   │   ├── anitomy.ts       # anitomy 封装 + 自建 confidence
    │   │   │   ├── regex-cn.ts      # 中文 fallback 正则 + confidence
    │   │   │   ├── confidence.ts    # 字段完整度评分（修订新增）
    │   │   │   ├── collection.ts    # 合集种子内容枚举与拆分（修订新增）
    │   │   │   └── filename.ts      # 三段式总入口（修订算法）
    │   │   ├── metadata/
    │   │   │   ├── bangumi.ts       # v0 API + calendar + 缓存
    │   │   │   ├── tmdb.ts
    │   │   │   ├── animelist.ts     # anime-lists.xml AniDB→TVDB（修订新增）
    │   │   │   └── mapping.ts       # 绝对集↔SxxExx 映射（修正算法）
    │   │   ├── llm/
    │   │   │   ├── client.ts        # 能力探测带 TTL + 失败重探
    │   │   │   ├── schema.ts        # AnimeMeta（去 title_ro）+ JSON Schema hash
    │   │   │   ├── scrape.ts        # prompt 构造 + ScrapeCache + 交叉验证 + 智能重试
    │   │   │   ├── fewshot.ts       # FewShotSample 检索/注入/回写（修订新增）
    │   │   │   └── cost.ts          # LLM 调用记账 + 预算熔断（修订新增）
    │   │   ├── downloader/
    │   │   │   ├── qbittorrent.ts   # +addMagnet 响应三态解析 + 全 state 轮询
    │   │   │   ├── diskcheck.ts     # free space 预检（修订新增）
    │   │   │   └── import.ts        # 硬链接 + EEXIST 处理 + 内容枚举
    │   │   ├── media/
    │   │   │   ├── types.ts
    │   │   │   ├── jellyfin.ts      # tvdbId 缺失降级链
    │   │   │   ├── emby.ts
    │   │   │   ├── nfo.ts
    │   │   │   └── rename.ts        # SP/OVA/movie 分流 + sanitize + 字幕/字体
    │   │   ├── notify/
    │   │   │   └── notifier.ts
    │   │   ├── scheduler/
    │   │   │   ├── cron.ts          # 注册 Bun.cron + cron 格式校验
    │   │   │   ├── queues.ts        # 4 个 better-queue + task id ↔ JobRun.id 映射
    │   │   │   ├── reconcile.ts     # 幂等断点续跑（修订算法）
    │   │   │   ├── shutdown.ts      # 正确的 drain Promise 等待（修正）
    │   │   │   └── jobs/
    │   │   │       ├── rss-sync.ts
    │   │   │       ├── qb-poll.ts   # 全 state 分类
    │   │   │       ├── scrape.ts
    │   │   │       └── import.ts
    │   │   └── schema/              # Zod schemas
    │   └── generated/prisma/
    └── web/
        └── ...                      # 同前，新增 routes/calendar、routes/metrics
```

---

## 4. 数据模型（Prisma）

> **设计原则**（含修订）：
> - Prisma SQLite 不支持原生 Json，结构化字段 `String` + zod parse。
> - SQLite 无 enum 约束，enum 编译为 TEXT，靠 service 层 zod 兜底。
> - 文件大小用 `BigInt`。
> - 主键统一 `cuid()`。
> - 级联：生产路径 Cascade，订阅关联 SetNull。
> - **明确使用 WAL 模式**（Prisma SQLite 默认开），优雅关闭里 `PRAGMA wal_checkpoint(TRUNCATE)`。
> - datasource url 统一 `file:/data/shikigami.db`（注释、env、compose 三处对齐）。
> - generator 用 `prisma-client`（6.x 新名），输出到 `../generated/prisma`。

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")   // 统一 file:/data/shikigami.db
}

// ============================================================
// 作品条目
// ============================================================
model Series {
  id              String     @id @default(cuid())
  bangumiId       Int?       @unique
  tmdbId          Int?
  tvdbId          Int?                                         // anime-lists.xml 回填
  anidbId         Int?
  titleJp         String                                       // 权威: Bangumi name
  titleCn         String?                                      // 权威: Bangumi name_cn
  titleEn         String?
  year            Int?
  seasonCount     Int        @default(1)
  // 绝对集→季集映射: 每季首集绝对集号 1-based
  // 语义已明确: {"1":1,"2":14,"3":26} 表示 S1 从 abs=1 起, S2 从 abs=14 起, S3 从 abs=26 起
  // （修订: 不再用 "第N季续接第X集" 模糊语义）
  seasonOffset    String?
  // cour 模式: split=每 cour 独立季号, absolute=长番连续（修订新增）
  courMode        String     @default("absolute")
  totalEpisodes   Int?
  status          String     @default("ONGOING")
  airWeekday      Int?                                         // 从 /calendar 回填
  posterUrl       String?
  metadataRaw     String?
  lockedAt        DateTime?                                    // 锁定后元数据刷新仅补缺
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  episodes        Episode[]
  subscriptions   Subscription[]
  mediaFiles      MediaFile[]
  overrides       EpisodeOverride[]                            // 修订新增

  @@index([status, airWeekday])
  @@index([tmdbId])
  @@index([titleCn])
}

// ============================================================
// 集
// ============================================================
model Episode {
  id              String     @id @default(cuid())
  seriesId        String
  series          Series     @relation(onDelete: Cascade)

  bangumiEpId     Int?       @unique
  // MAIN=0本篇 / SPECIAL=1(S00E##) / OP=2 / ED=3 / PREVIEW=4 / OTHER=6
  type            Int        @default(0)
  sort            Int?
  ep              Int?
  absoluteNumber  Int?
  epInSeason      Int?
  seasonIndex     Int        @default(1)
  titleJp         String?
  titleCn         String?
  airdate         String?
  duration        Int?

  mediaFiles      MediaFile[]

  @@index([seriesId, absoluteNumber])
  @@index([seriesId, seasonIndex, epInSeason])
}

// ============================================================
// 订阅规则
// ============================================================
model Subscription {
  id              String     @id @default(cuid())
  name            String
  seriesId        String?
  series          Series?    @relation(onDelete: SetNull)
  enabled         Boolean    @default(true)

  // 站点过滤参数 JSON: {sources,keyword,teamIds,sortId,resolutionMin,
  //   fansubs,blacklist,preferredLang:"CHS|CHT|DUAL|ANY",
  //   fallbackResolution:["1080p","720p"]}    （修订: 加语言偏好 + 分辨率降级链）
  filterRule      String
  matchHints      String?

  category        String     @default("动漫")
  savePath        String?
  paused          Boolean    @default(false)
  autoRename      Boolean    @default(true)

  // RSS 回填检测（修订新增）
  lastSeenPubDate DateTime?
  lastRunAt       DateTime?
  lastMatchCount  Int        @default(0)
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  downloadTasks   DownloadTask[]

  @@index([enabled])
  @@index([seriesId])
}

// ============================================================
// 下载任务（对接 qBittorrent）
// ============================================================
model DownloadTask {
  id              String     @id @default(cuid())
  subscriptionId  String?
  subscription    Subscription? @relation(onDelete: SetNull)
  seriesId        String?

  infoHash        String     @unique
  source          String
  sourceItemId    String?
  magnet          String?
  torrentUrl      String?
  rawTitle        String
  parsedTitle     String?
  fansub          String?
  subtitleLang    String?                                      // GB/BIG5/CHS/CHT/DUAL（修订新增）
  sizeBytes       BigInt
  pubDate         DateTime?

  // 状态机（修订扩展）:
  // PENDING → DOWNLOADING → COMPLETED → (导入链)
  //          ↘ ERROR ↘ RETRY → DOWNLOADING
  //          ↘ ABANDONED (死种, 自动清 MagnetSeen 允许换源)
  //          ↘ PENDING_DISK_FULL
  //          ↘ PAUSED | SEEDING | CHECKING | REMOVED
  status          String     @default("PENDING")
  qbStateRaw      String?
  progress        Float      @default(0)
  hash            String?
  savePath        String?
  stalledSince    DateTime?                                    // stalledDL 起算时间（修订新增）
  completedAt     DateTime?
  addedAt         DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  mediaFiles      MediaFile[]

  @@index([subscriptionId])
  @@index([status])
  @@index([source, sourceItemId])
}

// ============================================================
// 媒体文件（落盘 + AI 刮削状态机）
// 一个 DownloadTask 可产出多个 MediaFile:
//   - 单集种: 1 video + N subtitle + N font
//   - 合集种: N video + N subtitle
// ============================================================
model MediaFile {
  id              String     @id @default(cuid())
  downloadTaskId  String
  downloadTask    DownloadTask @relation(onDelete: Cascade)
  seriesId        String?
  series          Series?    @relation(onDelete: SetNull)
  episodeId       String?
  episode         Episode?   @relation(onDelete: SetNull)

  // 文件类型（修订新增）: video | subtitle | font | other
  kind            String     @default("video")
  sourcePath      String
  libraryPath     String?
  fileName        String
  sizeBytes       BigInt

  // 状态机（修订扩展）:
  // PENDING → MATCHED → REVIEWED → RENAMED → EXPORTED
  //   REVIEWED/LOCKED 默认 rescrape 跳过（force=true 才覆盖）
  // FAILED 可重跑（重跑前清理半成品硬链）
  scrapeState     String     @default("PENDING")
  scrapeResult    String?
  scrapeError     String?
  scrapedAt       DateTime?
  reviewedBy      String?
  reviewedAt      DateTime?

  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  // 修订新增: 同集同语言版本撞名拦截（应用层校验，落库阶段拦）
  @@unique([seriesId, libraryPath])
  @@index([scrapeState])
  @@index([seriesId])
  @@index([downloadTaskId])
}

// ============================================================
// 跨订阅磁链去重
// ============================================================
model MagnetSeen {
  id              String     @id @default(cuid())
  infoHash        String     @unique
  source          String
  sourceItemId    String?
  firstSeenAt     DateTime   @default(now())
  downloadTaskId  String?
  // 修订新增: 软删除标记，ABANDONED 时置 true 允许换源重下
  invalidated     Boolean    @default(false)

  @@index([source, sourceItemId])
}

// ============================================================
// 集（episodeId）级二级去重（修订新增）
// 合集种与单集种 infoHash 不同但可能撞集，MagnetSeen 拦不住
// ============================================================
model EpisodeDedup {
  id              String     @id @default(cuid())
  seriesId        String
  seasonIndex     Int
  epInSeason      Int
  // 已落地该集的 MediaFile id（首个）
  mediaFileId     String?
  infoHash        String?
  createdAt       DateTime   @default(now())

  @@unique([seriesId, seasonIndex, epInSeason])
  @@index([seriesId])
}

// ============================================================
// 人工覆盖（修订新增）
// 用户在 UI 修正的绝对集→季集映射，权威，覆盖 seasonOffset
// ============================================================
model EpisodeOverride {
  id              String     @id @default(cuid())
  seriesId        String
  series          Series     @relation(onDelete: Cascade)
  absoluteNumber  Int
  season          Int
  episode         Int
  source          String     @default("manual")                  // manual | corrected-scrape
  note            String?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  @@unique([seriesId, absoluteNumber])
  @@index([seriesId])
}

// ============================================================
// AI 刮削结果缓存（修订新增）
// key = 归一化文件名指纹（去 CRC/分辨率/版本号差异后的稳定 hash）
// 避免批量下载季番时同/相似文件名反复调用
// ============================================================
model ScrapeCache {
  id              String     @id @default(cuid())
  fingerprint     String     @unique                           // 归一化文件名 hash
  rawFilename     String
  result          String                                        // AnimeMeta JSON
  model           String
  promptTokens    Int?
  completionTokens Int?
  costUsd         Float      @default(0)
  createdAt       DateTime   @default(now())

  @@index([createdAt])
}

// ============================================================
// Few-shot 自学习池（修订新增）
// 人工修正回写，按 release_group/title LRU 检索注入 prompt
// ============================================================
model FewShotSample {
  id              String     @id @default(cuid())
  filename        String
  output          String                                        // corrected AnimeMeta JSON
  releaseGroup    String?
  titleKey        String?                                       // 归一化标题用于检索
  seriesId        String?
  source          String     @default("manual")
  // 冲突校验状态: pending | approved | rejected
  reviewStatus    String     @default("approved")
  createdAt       DateTime   @default(now())
  lastUsedAt      DateTime?

  @@index([releaseGroup, lastUsedAt])
  @@index([titleKey])
}

// ============================================================
// LLM 调用记账（修订新增）
// ============================================================
model LlmCall {
  id              String     @id @default(cuid())
  mediaFileId     String?
  model           String
  promptTokens    Int
  completionTokens Int
  costUsd         Float
  finishReason    String?                                       // stop | length | ...
  success         Boolean
  error           String?
  cached          Boolean    @default(false)
  createdAt       DateTime   @default(now())

  @@index([createdAt])
}

// ============================================================
// 配置
// ============================================================
model Settings {
  key             String     @id
  category        String
  value           String                                       // 敏感值 enc:<iv>:<ciphertext>, 主密钥从 ENCRYPTION_KEY 派生
  encrypted       Boolean    @default(false)
  updatedAt       DateTime   @updatedAt

  @@index([category])
}

// ============================================================
// Cron 运行审计 + 任务持久化
// ============================================================
model JobRun {
  id              String     @id @default(cuid())
  kind            String                                       // rss-sync|qb-poll|scrape|import|refresh-meta|backfill
  status          String                                       // queued|running|success|failed|abandoned
  // 修订新增: 关联的 better-queue task id 与幂等检查点
  queueTaskId     String?
  checkpoint      String?                                      // JSON: 当前阶段断点（如 "scraped","linked"）
  payload         String?
  result          String?
  error           String?
  runs            Int        @default(0)
  maxRetries      Int        @default(5)
  runAt           DateTime   @default(now())
  startedAt       DateTime?
  finishedAt      DateTime?
  createdAt       DateTime   @default(now())

  @@index([kind, status, runAt])
}
```

---

## 5. 核心模块设计

### 5.1 抓取层（SiteAdapter + dmhy 修正 + 字幕组发现 + 回填）

```typescript
// apps/backend/src/scrapers/types.ts
export type SiteSource = 'dmhy' | 'mikan' | 'nyaa' | 'bangumimoe';

export interface Torrent {
  source: SiteSource;
  sourceItemId: string;
  title: string;
  magnet?: string;
  torrentFileUrl?: string;
  infoHash?: string;
  size?: bigint;
  pubDate?: Date;
  fansub?: string;
  subtitleLang?: string;        // 修订新增: GB/BIG5/CHS/CHT/DUAL（从标题 [GB][BIG5][双字] 提取）
  category?: string;
  rawItem: unknown;
}

export interface SiteAdapter {
  readonly source: SiteSource;
  fetchLatest(category?: string): Promise<Torrent[]>;       // 修订: category 参数化
  fetchByKeyword(keyword: string): Promise<Torrent[]>;
  fetchByTeam?(teamId: string): Promise<Torrent[]>;
}
```

```typescript
// apps/backend/src/scrapers/dmhy.ts （修订: sort_id 修正 + 路径修正）
import { XMLParser } from 'fast-xml-parser';
import { siteLimiters } from '../lib/ratelimit';
import { httpGet } from '../lib/http';
import type { SiteAdapter, Torrent } from './types';

const BASE = 'https://share.dmhy.org';
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (name) => name === 'item',
});

// 修订核实: sort_id=1=動畫（每周单集）, sort_id=2=季度合集（整季包）
const SORT_ID = { anime: '1', seasonalPack: '2' } as const;

export const dmhyAdapter: SiteAdapter = {
  source: 'dmhy',

  // 默认抓每周单集（动画主分类）
  async fetchLatest(category: string = SORT_ID.anime): Promise<Torrent[]> {
    return poll(`${BASE}/topics/list/sort_id/${category}/rss.xml`);
  },

  async fetchByKeyword(keyword: string): Promise<Torrent[]> {
    return poll(`${BASE}/topics/rss/rss.xml?keyword=${encodeURIComponent(keyword)}`);
  },

  // 修订: 路径从 /topics/rss/team_id/ 改为 /topics/list/team_id/
  async fetchByTeam(teamId: string): Promise<Torrent[]> {
    return poll(`${BASE}/topics/list/team_id/${teamId}/rss.xml`);
  },
};

async function poll(url: string): Promise<Torrent[]> {
  // 修订: dmhy 单站全局并发=1（所有订阅的 dmhy 抓取合并到一次 cron 周期）
  return siteLimiters.dmhy.run(async () => {
    const xml = await httpGet(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN' },
      retries: 3, backoff: 'exp',
      // 修订: 403 即触发熔断（见 lib/circuit.ts），不重试到死
      onStatus: (s) => s === 403 ? 'circuit' : (s >= 500 ? 'retry' : 'fail'),
    });
    const doc = parser.parse(xml);
    const items = doc?.rss?.channel?.item ?? [];
    return items.map(normalize).filter((t): t is Torrent => !!t.infoHash && !!t.magnet);
  });
}

function normalize(item: any): Torrent | null {
  const magnet: string | undefined = item.enclosure?.['@_url'];
  const infoHash = magnet ? parseInfoHash(magnet) : undefined;
  const title: string = item.title ?? '';
  return {
    source: 'dmhy',
    sourceItemId: extractTopicId(item.link),
    title,
    magnet,
    infoHash,
    pubDate: item.pubDate ? new Date(item.pubDate) : undefined,
    fansub: item.author,
    subtitleLang: detectSubtitleLang(title),   // 修订新增
    category: item.category,
    rawItem: item,
  };
}

// 修订新增: 从标题提取语言标识
function detectSubtitleLang(title: string): string | undefined {
  if (/\[双字\]|双语|DUAL/i.test(title)) return 'DUAL';
  if (/\[GB\]|\[CHS\]|简体|简中/i.test(title)) return 'CHS';
  if (/\[BIG5\]|\[CHT\]|繁体|繁中/i.test(title)) return 'CHT';
  return undefined;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function parseInfoHash(magnet: string): string | undefined {
  const m = magnet.match(/xt=urn:btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/i);
  return m?.[1]?.toUpperCase();
}
```

```typescript
// apps/backend/src/scrapers/fansub.ts （修订新增: team_id 发现链路）
import { httpGet } from '../lib/http';
import { siteLimiters } from '../lib/ratelimit';

// dmhy 字幕组搜索: 解析 HTML 拿 team_id + name
// (dmhy 无 JSON API, 必须解析 /team/names/search/... 或站内搜索页)
export async function searchFansub(query: string): Promise<{ teamId: string; name: string }[]> {
  return siteLimiters.dmhy.run(async () => {
    const html = await httpGet(
      `https://share.dmhy.org/topics/quicksearch`,
      { method: 'POST', body: { keyword: query }, headers: { 'User-Agent': UA } },
    );
    return parseTeamOptions(html);
  });
}
```

```typescript
// apps/backend/src/scrapers/backfill.ts （修订新增: RSS 漏集回填）
// 启动/周期任务发现 gap（当前 RSS 最早 pubDate > lastSeenPubDate + 容差）时触发
export async function backfillSubscription(subscriptionId: string) {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub?.lastSeenPubDate) return;
  const rule = FilterRuleSchema.parse(JSON.parse(sub.filterRule));
  for (const src of rule.sources) {
    const adapter = registry[src];
    // dmhy: 按 team_id/keyword 分页抓 topics 列表页
    // mikan: 按 bangumiId 抓全集列表
    if (adapter.fetchByTeam && rule.teamIds?.length) {
      for (const tid of rule.teamIds) {
        const items = await adapter.fetchByTeam(tid);
        // 处理比 lastSeenPubDate 更早的条目
      }
    }
  }
}
```

**其他三站关键差异**（修订）：

| 站 | URL 模板 | magnet 来源 | 备注 |
|---|---|---|---|
| mikan | `https://mikanani.me/RSS/Classic` / `/RSS/Bangumi?bangumiId={id}` | 无，enclosure 是 `.torrent`；用 `webtorrent` 解析 infoHash 再拼 magnet + 公共 `&tr=` | mikanani.me 国内可能墙，可配镜像 |
| nyaa | `https://nyaa.si/?page=rss&q={q}&c=1_3&f=0&s=seeders&o=desc` | `nyaa:infoHash` 直接拼 magnet | **修订**：`1_3`=Non-English（含中文字幕组但也含日文/韩文标题），`1_4`=Raw 生肉。中文定向**靠关键词+标题语言检测，不依赖分类号** |
| bangumi.moe | `https://bangumi.moe/rss/latest` / `/rss/{tag_id}` | 无，需 `webtorrent` 解析 `.torrent` | tag_id 先抓 `/api/v2/common/search-team?name=` 拿；不走 JSON API（路径不稳） |

### 5.2 AI 刮削层（修订：可比较置信度 + 缓存 + 交叉验证 + 智能重试）

**职责**：文件名 → 结构化 `AnimeMeta`。三段式采用**字段完整度评分**（anitomy 自身无 confidence，需自建），让 AI 做最终仲裁。

```typescript
// apps/backend/src/llm/schema.ts （修订: 删除 title_ro，AI 不输出罗马音）
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const AnimeMetaSchema = z.object({
  release_group: z.string().nullable(),
  // 修订: AI 只输出"识别线索"，权威标题由 Bangumi/TMDB 回填
  // 以下三个字段标注"仅供识别提示"，落库 Series 时被元数据层覆盖
  title_hint: z.string(),                                    // AI 识别到的标题（任意语言）
  season: z.number().int().min(1).nullable(),
  episode: z.number().int().min(1).nullable(),
  absolute_episode: z.number().int().nullable(),
  episode_type: z.enum(['normal', 'special', 'ova', 'movie', 'web']),
  resolution: z.string().nullable(),
  source: z.string().nullable(),                             // BDRip/Web-DL/HDTV
  video_codec: z.string().nullable(),
  audio_codec: z.string().nullable(),
  subtitle_lang: z.string().nullable(),                      // 修订新增
  audio_lang: z.string().nullable(),                         // 修订新增
  checksum: z.string().nullable(),
  release_date: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  needs_review: z.boolean(),
  raw_tokens: z.record(z.string()).optional(),
});
export type AnimeMeta = z.infer<typeof AnimeMetaSchema>;

// 修订: schema hash 固定，避免 zod-to-json-schema 字段顺序抖动破坏 prompt 前缀稳定
let _schemaJson: object | null = null;
let _schemaHash = '';
export function getAnimeMetaJsonSchema() {
  if (!_schemaJson) {
    _schemaJson = zodToJsonSchema(AnimeMetaSchema, {
      target: 'openApi3', $refStrategy: 'none', additionalProperties: false,
    });
    _schemaHash = sha256(JSON.stringify(_schemaJson));
  }
  return { schema: _schemaJson!, hash: _schemaHash };
}
```

```typescript
// apps/backend/src/parser/confidence.ts （修订新增: 字段完整度评分）
// anitomy 输出确定性，没有 confidence；自建启发式评分
import type { AnimeMeta } from '../llm/schema';

export function scoreByCompleteness(partial: Partial<AnimeMeta>): number {
  const keys = ['release_group', 'season', 'episode', 'resolution', 'video_codec'] as const;
  const present = keys.filter(k => partial[k] != null && partial[k] !== '').length;
  // 关键字段加权: release_group + episode 是必须
  const hasCritical = !!partial.release_group && (partial.episode != null || partial.absolute_episode != null);
  const base = present / keys.length;
  return hasCritical ? Math.max(base, 0.7) : base * 0.5;
}
```

```typescript
// apps/backend/src/parser/filename.ts （修订: 三段式总入口，让 AI 仲裁）
import { parse as anitomyParse } from './anitomy';
import { regexChinese } from './regex-cn';
import { scoreByCompleteness } from './confidence';
import { scrapeFilename } from '../llm/scrape';

export async function parseFilename(filename: string) {
  const a = anitomyParse(filename);
  const r = regexChinese(filename);

  // 修订: "快路径"严格 — 仅当 anitomy 同时命中 release_group+episode+title 且非中英混合混名才直通
  const aScore = a ? scoreByCompleteness(a) : 0;
  const rScore = r ? scoreByCompleteness(r) : 0;
  const looksMixed = /[\u4e00-\u9fa5]/.test(filename) && /[a-zA-Z]{4,}/.test(filename);

  if (a && aScore > 0.85 && a.episode_number && a.release_group && !looksMixed) {
    return { ...a, confidence: aScore, source: 'anitomy' };
  }
  if (r && rScore > 0.85 && r.fansub && r.episode && !looksMixed) {
    return { ...r, confidence: rScore, source: 'regex' };
  }

  // 修订: 其余一律送 AI 仲裁，anitomy/regex 产出作为预解析提示
  // (不再用 anitomy/regex 的 confidence 与 AI 共用阈值比较)
  const preParsed = a ?? r ?? undefined;
  return scrapeFilename(filename, preParsed);
}
```

```typescript
// apps/backend/src/llm/client.ts （修订: 能力探测带 TTL + 失败重探）
import OpenAI from 'openai';
import { env } from '../lib/env';

export const llm = new OpenAI({
  baseURL: env.LLM_BASE_URL,
  apiKey: env.LLM_API_KEY,
  timeout: 30_000,
});

// 修订: 不再用进程级单例缓存，改为带 TTL 的周期探测
let _probe: { supports: boolean; at: number } | null = null;
const PROBE_TTL = 60 * 60 * 1000;   // 1h
let _consecutiveFailures = 0;

export async function supportsJsonSchema(): Promise<boolean> {
  if (_probe && Date.now() - _probe.at < PROBE_TTL && _consecutiveFailures < 3) {
    return _probe.supports;
  }
  try {
    await llm.chat.completions.create({
      model: env.LLM_MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: '{}' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'probe', strict: true,
          schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
        },
      },
    });
    _probe = { supports: true, at: Date.now() };
    _consecutiveFailures = 0;
    return true;
  } catch {
    _probe = { supports: false, at: Date.now() };
    _consecutiveFailures += 1;
    return false;
  }
}
```

```typescript
// apps/backend/src/llm/scrape.ts （修订: 缓存 + 交叉验证 + 智能重试）
import { llm, supportsJsonSchema } from './client';
import { env } from '../lib/env';
import { AnimeMetaSchema, getAnimeMetaJsonSchema, type AnimeMeta } from './schema';
import { getScrapeCache, saveScrapeCache, normalizeFingerprint } from '../lib/cache';
import { retrieveFewShot } from './fewshot';
import { recordLlmCall, checkBudget } from './cost';
import { searchSubjects } from '../metadata/bangumi';

const SYSTEM = `你是动漫发布文件名识别专家。从 [字幕组] 标题 - 集数 [来源][分辨率][编码][语言] 中提取结构化字段。
规则:
1. release_group = 方括号内第一个非数字 token（字幕组），无则 null
2. title_hint = 识别到的标题（任意语言，仅用于匹配 Bangumi/TMDB，权威译名由元数据层回填）
3. absolute_episode = 文件名里的连续编号（字幕组常用，跨季连续）
4. season/episode = 按"播出季"拆分；absolute_episode 不一定等于 episode
5. 不确定 season/episode 时填 null 且 needs_review=true
6. SP/OVA/剧场版 episode_type=special/ova/movie，正片=normal
7. subtitle_lang: 简中=CHS, 繁中=CHT, 双语=DUAL, 无= scares null
8. confidence 反映整体把握；<${env.LLM_REVIEW_THRESHOLD} 一律 needs_review=true`;

export async function scrapeFilename(filename: string, preParsed?: Partial<AnimeMeta>): Promise<AnimeMeta> {
  // 1. 修订: 文件名指纹缓存（归一化后，去 CRC/分辨率/版本号差异）
  const fp = normalizeFingerprint(filename);
  const cached = await getScrapeCache(fp);
  if (cached) {
    await recordLlmCall({ cached: true, model: cached.model, costUsd: 0 });
    return AnimeMetaSchema.parse(JSON.parse(cached.result));
  }

  // 2. 修订: 预算熔断
  if (!(await checkBudget())) {
    throw new Error('LLM_BUDGET_EXCEEDED');
  }

  const useSchema = await supportsJsonSchema();
  const { schema: jsonSchema } = getAnimeMetaJsonSchema();
  const userHint = preParsed ? `\n(预解析提示: ${JSON.stringify(preParsed)})` : '';
  const fewshot = await retrieveFewShot(filename);  // 修订: 动态 few-shot

  // 修订: 第二条 system (JSON Schema) 改为静态字符串前缀，确保 caching 命中
  const SCHEMA_STR = JSON.stringify(jsonSchema);

  const completion = await llm.chat.completions.create({
    model: env.LLM_MODEL,
    temperature: 0,
    max_tokens: 1024,                                       // 修订: 512→1024 防 raw_tokens 截断
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'system', content: `输出 JSON Schema: ${SCHEMA_STR}` },
      { role: 'user', content: fewshot },
      { role: 'user', content: `filename: ${filename}${userHint}` },
    ],
    ...(useSchema
      ? { response_format: { type: 'json_schema', json_schema: { name: 'anime_meta', strict: true, schema: jsonSchema as any } } }
      : { response_format: { type: 'json_object' } }),
  }).catch(async (err) => {
    // 修订: 智能重试 — 区分错误类型
    if (err?.status === 429 || err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT') {
      // 限流/网络: 指数退避重试
      throw new RetryableError(err);
    }
    throw err;
  });

  // 修订: 检查 finish_reason 防截断
  const choice = completion.choices[0];
  if (choice.finish_reason === 'length') {
    throw new RetryableError('truncated by max_tokens');
  }

  const raw = choice.message?.content ?? '{}';
  let parsed: AnimeMeta;
  try {
    parsed = AnimeMetaSchema.parse(JSON.parse(raw));
  } catch (e) {
    // 修订: schema 违规不重试（temp=0 下大概率重复），直接进人工队列
    throw new NeedsReviewError(`schema validation failed: ${(e as Error).message}`);
  }

  // 修订: 交叉验证 — AI title_hint 必须 Bangumi 搜索召回且相似度>阈值
  const candidates = await searchSubjects(parsed.title_hint);
  if (candidates.length === 0 || titleSimilarity(parsed.title_hint, candidates[0].name_cn) < 0.6) {
    parsed.needs_review = true;
    parsed.confidence = Math.min(parsed.confidence, 0.5);
  }

  await saveScrapeCache(fp, parsed, completion);
  await recordLlmCall({ model: env.LLM_MODEL, completion, success: true });
  return parsed;
}

class RetryableError extends Error {}
class NeedsReviewError extends Error {}
```

```typescript
// apps/backend/src/llm/fewshot.ts （修订新增）
import { prisma } from '../lib/prisma';

const MAX_TOTAL = 500;          // 池上限
const MAX_PER_GROUP = 3;        // 每个 release_group 最多注入

export async function retrieveFewShot(filename: string): Promise<string> {
  // 按 release_group/title 相似度 LRU 检索 top-k，避免无限增长爆 token
  const group = extractReleaseGroup(filename);
  const samples = await prisma.fewShotSample.findMany({
    where: { reviewStatus: 'approved', OR: [{ releaseGroup: group }, { titleKey: { contains: normalizeTitle(filename) } }] },
    orderBy: { lastUsedAt: 'desc' }, take: MAX_PER_GROUP,
  });
  if (!samples.length) return '';
  await prisma.fewShotSample.updateMany({
    where: { id: { in: samples.map(s => s.id) } }, data: { lastUsedAt: new Date() },
  });
  return '示例:\n' + samples.map(s => `输入: ${s.filename}\n输出: ${s.output}`).join('\n');
}

export async function saveCorrection(filename: string, output: object, seriesId?: string) {
  // 冲突校验后才入库
  const total = await prisma.fewShotSample.count();
  if (total >= MAX_TOTAL) {
    // FIFO 淘汰最旧
    await prisma.fewShotSample.deleteMany({
      where: { id: { in: (await prisma.fewShotSample.findMany({ orderBy: { lastUsedAt: 'asc' }, take: 1 })).map(s => s.id) } },
    });
  }
  await prisma.fewShotSample.create({
    data: {
      filename,
      output: JSON.stringify(output),
      releaseGroup: extractReleaseGroup(filename),
      titleKey: normalizeTitle(filename),
      seriesId,
      reviewStatus: 'approved',
    },
  });
}
```

### 5.3 重命名 & 媒体服务器层（修订：算法修正 + sanitize + SP/OVA/movie + EEXIST）

```typescript
// apps/backend/src/media/rename.ts （修订）
import type { Episode, Series } from '@prisma/client';
import { sanitizePathSegment } from '../lib/path';

// 修订: episode_type 分流
export type EpisodePathType = 'normal' | 'special' | 'ova' | 'movie';

export function buildLibraryPath(
  s: Pick<Series, 'titleCn' | 'year'>,
  ep: Pick<Episode, 'seasonIndex' | 'epInSeason' | 'type'>,
  meta: { resolution?: string | null; fansub?: string | null; subtitleLang?: string | null },
  ext: string,
  kind: 'video' | 'subtitle' | 'font' = 'video',
): string {
  // 修订: 入口断言 — 视频和字幕必须 epInSeason 非空
  if (kind !== 'font' && ep.epInSeason == null) {
    throw new Error(`epInSeason required for kind=${kind}`);
  }

  const titleCn = sanitizePathSegment(s.titleCn || 'Unknown');
  const yearStr = s.year ? ` (${s.year})` : '';

  // 修订: 按 type 分流目录结构
  let seasonFolder: string;
  let fileName: string;
  if (ep.type === 1) {                      // SPECIAL
    seasonFolder = 'Season 00';
    const E = String(ep.epInSeason ?? 0).padStart(2, '0');
    fileName = `${titleCn}${yearStr} S00E${E}`;
  } else if (ep.type === 2 || ep.type === 6) {  // OVA / OTHER → 也归 Season 00
    seasonFolder = 'Season 00';
    const E = String(ep.epInSeason ?? 0).padStart(2, '0');
    fileName = `${titleCn}${yearStr} S00E${E}`;
  } else if (meta.episode_type === 'movie') {  // 修订: 剧场版独立 Movie 目录
    seasonFolder = 'Movies';
    fileName = `${titleCn}${yearStr}`;
  } else {                                     // normal
    seasonFolder = `Season ${String(ep.seasonIndex).padStart(2, '0')}`;
    const S = String(ep.seasonIndex).padStart(2, '0');
    const E = String(ep.epInSeason ?? 0).padStart(2, '0');
    fileName = `${titleCn}${yearStr} S${S}E${E}`;
  }

  // 修订: 字幕跟随正片 basename，加语言后缀，Jellyfin 才能自动挂载
  if (kind === 'subtitle') {
    const langSuffix = subtitleLangSuffix(meta.subtitleLang);
    return `${titleCn}${yearStr}/${seasonFolder}/${fileName}${langSuffix}.${ext}`;
  }
  if (kind === 'font') {
    // 字体不入 Season 文件夹，单独归档（Jellyfin 不识别）
    return `${titleCn}${yearStr}/Fonts/${sanitizePathSegment(meta.fansub || 'font')}.${ext}`;
  }

  const tags = [meta.resolution, meta.fansub, meta.subtitleLang && langTag(meta.subtitleLang)]
    .filter(Boolean).map(t => `[${t}]`).join('');
  return `${titleCn}${yearStr}/${seasonFolder}/${fileName} ${tags}.${ext}`;
}

function subtitleLangSuffix(lang?: string | null): string {
  switch (lang) { case 'CHS': return '.zh-CN'; case 'CHT': return '.zh-TW'; case 'DUAL': return '.zh'; default: return ''; }
}
function langTag(lang?: string | null): string | null {
  switch (lang) { case 'CHS': return 'GB'; case 'CHT': return 'BIG5'; case 'DUAL': return '双字'; default: return null; }
}
```

```typescript
// apps/backend/src/lib/path.ts （修订新增: 路径 sanitize）
import sanitizeFilename from 'sanitize-filename';

// Linux 本地允许: ? * | : < > "，但 SMB/CIFS/NTFS 外挂盘或 Jellyfin NFO 解析会出错；/ 会拆目录
const ILLEGAL = /[\\/:*?"<>|]/g;

export function sanitizePathSegment(name: string, maxLen = 120): string {
  let s = name.replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim();
  // Windows 不允许首尾 . 或空格
  s = s.replace(/^\.+|\.+$/g, '').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s || 'Unknown';
}
```

```typescript
// apps/backend/src/metadata/mapping.ts （修订: 算法修正）
// seasonOffset 语义: 每季首集绝对集号 1-based
//   {"1":1,"2":14,"3":26} 表示 S1 从 abs=1, S2 从 abs=14, S3 从 abs=26
// episode = absolute - firstAbsOfSeason + 1
export function mapAbsoluteToSeason(
  absolute: number,
  seasonOffset: Record<string, number>,
  courMode: 'split' | 'absolute' = 'absolute',
  overrides?: Record<number, { season: number; episode: number }>,
): { season: number; episode: number } {
  // 修订: 人工覆盖权威优先
  if (overrides?.[absolute]) return overrides[absolute];

  // 构造 [(season, firstAbs)] 升序
  const offsets = Object.entries(seasonOffset)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([s]) => Number.isInteger(s) && s >= 1)
    .sort((a, b) => a[1] - b[1]);

  if (offsets.length === 0) return { season: 1, episode: absolute };

  // 修订: 修正逻辑 — 用 >= 而非 >，且取"当前季自己的 offset"作 firstAbsOfSeason
  let season = 1;
  let firstAbsOfSeason = offsets[0][1];   // 默认 S1 起始
  for (const [s, start] of offsets) {
    if (absolute >= start) {              // 修订: >= 处理首集边界
      season = s;
      firstAbsOfSeason = start;
    } else {
      break;
    }
  }
  const episode = absolute - firstAbsOfSeason + 1;

  // courMode=split 时每 cour 独立季号（已在 seasonOffset 体现，无需额外处理）
  return { season, episode };
}

// 必备单测用例（覆盖首尾集、跨季）:
// seasonOffset={"1":1,"2":14,"3":26}
//   abs=1   → S1E1
//   abs=13  → S1E13
//   abs=14  → S2E1   （修订: 旧算法会错算成 S2E14 或 S1E13）
//   abs=25  → S2E12
//   abs=26  → S3E1
//   abs=27  → S3E2
// overrides={14:{season:99,episode:99}} → abs=14 返回 S99E99
```

```typescript
// apps/backend/src/downloader/import.ts （修订: EEXIST + 内容枚举）
import { link, stat, mkdir, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { enumerateContent } from '../parser/collection';

// 修订: 显式处理 EEXIST（幂等），不同 inode 走冲突策略
export async function importFile(
  srcPath: string,
  dstPath: string,
  conflictStrategy: 'suffix' | 'reject' = 'suffix',
): Promise<'hardlink' | 'copy' | 'skipped'> {
  await mkdir(dirname(dstPath), { recursive: true });
  try {
    await link(srcPath, dstPath);
    return 'hardlink';
  } catch (e: any) {
    if (e.code === 'EEXIST') {
      // 修订: stat 比较 inode
      const [srcStat, dstStat] = await Promise.all([stat(srcPath), stat(dstPath)]);
      if (srcStat.ino === dstStat.ino) {
        return 'skipped';   // 同 inode = 已导入，幂等跳过
      }
      // 不同 inode = 撞名冲突
      if (conflictStrategy === 'reject') {
        throw new ConflictError(`EEXIST different inode: ${dstPath}`);
      }
      // suffix 策略: 加 .2 / .字幕组 后缀
      const ext = dstPath.lastIndexOf('.');
      const newPath = `${dstPath.slice(0, ext)}.2${dstPath.slice(ext)}`;
      return importFile(srcPath, newPath, conflictStrategy);
    }
    if (e.code === 'EXDEV') {
      await copyFile(srcPath, dstPath);
      return 'copy';
    }
    throw e;
  }
}

class ConflictError extends Error {}

// 修订: 种子内容枚举（合集种 fan-out）
export async function importDownloadTask(downloadTaskId: string) {
  const task = await prisma.downloadTask.findUnique({ where: { id: downloadTaskId } });
  if (!task) throw new Error('task not found');

  const files = await enumerateContent(task.savePath!);  // 遍历 content_path 下所有文件
  // 分类: video / subtitle / font
  for (const f of files) {
    const kind = classifyFileKind(f.path);
    // 合集种子: 先解析包标题确定 series+季, 再按文件名分配集号
    const meta = await parseFilename(f.name);
    // 创建 MediaFile(kind, sourcePath, ...)
    await prisma.mediaFile.create({ data: { downloadTaskId, kind, sourcePath: f.path, fileName: f.name, sizeBytes: f.size, ... } });
  }
}

// 绝不调 qb.removeTorrent(hash, true)！做种达标后 removeTorrent(hash, false) 保留数据。
```

```typescript
// apps/backend/src/media/jellyfin.ts （修订: tvdbId 缺失降级链）
export class JellyfinClient implements MediaServerClient {
  readonly type = 'jellyfin' as const;
  constructor(private base: string, private apiKey: string) {}

  private url(p: string) { return `${this.base}${p}?api_key=${this.apiKey}`; }

  // 修订: tvdbId 缺失降级链
  async refreshSeries(series: { tvdbId?: number | null; libraryPath?: string | null }) {
    try {
      if (series.tvdbId) {
        // 首选: 按系列增量
        const r = await fetch(this.url(`/Library/Series/Updated`), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tvdbId: series.tvdbId }),
        });
        if (r.ok) return;
      }
      // 降级 1: 按路径
      if (series.libraryPath) {
        const r = await fetch(this.url(`/Library/Media/Updated`), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Updates: [{ Path: series.libraryPath }] }),
        });
        if (r.ok) return;
      }
      // 降级 2: 全量（需 admin）
      const r = await fetch(this.url(`/Library/Refresh`), { method: 'POST' });
      if (!r.ok) throw new Error(`Jellyfin refresh ${r.status}`);
    } catch (e) {
      // 修订: 调用失败必须落 JobRun.error 并可重试，绝不静默吞
      throw new RetryableError(`Jellyfin refresh failed: ${(e as Error).message}`);
    }
  }
}
```

### 5.4 调度层（修订：cron 校验 + 全 state 轮询 + 正确的优雅关闭）

| 任务 | cron 表达式 | 队列 | 并发 | 说明 |
|---|---|---|---|---|
| RSS 同步 | `*/15 * * * *` | rssFetchQueue | 2 | **修订**：所有订阅的 dmhy 抓取合并到一次 cron 周期（先拉全站 RSS 再内存匹配），单站全局并发=1 |
| qB 完成轮询 | `*/30 * * * * *` | — | 1 | **修订**：`listTorrents()` 不带 filter 全量分类：completed→导入；error/missingFiles→ERROR+告警；stalledDL 持续 >24h→ABANDONED+清 MagnetSeen |
| AI 刮削 | 事件驱动 | aiScrapeQueue | 1-2 | **修订**：调用前查 ScrapeCache，命中跳过；预算/速率双熔断 |
| 元数据刷新 | `0 3 * * *` | rssFetchQueue | 1 | **修订**：跳过 lockedAt 已锁定的 Series（仅补缺字段） |
| RSS 回填 | gap 触发 | rssFetchQueue | 1 | **修订新增**：发现 gap（当前 RSS 最早 pubDate > lastSeenPubDate + 容差）时触发 |
| 任务 reconcile | 启动时 | — | — | **修订**：按 JobRun.checkpoint 断点续跑（非从头重跑） |

```typescript
// apps/backend/src/scheduler/cron.ts （修订: cron 格式校验 + 顶层错误处理）
import { cron } from 'bun';
import { z } from 'zod';
import { env } from '../lib/env';
import { logger } from '../logger';

// 修订: env 传入的 cron 表达式做格式校验，错格式 fail-fast
const cronSchema = z.string().regex(/^(\*|\d+|\d+-\d+|\*\/\d+)(\/\d+)?(\s+(\*|\d+|\d+-\d+|\*\/\d+)(\/\d+)?){4,5}$/);
const rssCron = cronSchema.parse(env.RSS_SYNC_INTERVAL);

cron(rssCron, async () => {
  try { await runRssSync(); }
  catch (e) { logger.error({ job: 'rss-sync', err: e }, 'cron failed'); }
}, { name: 'rss-sync' });

// 修订: 顶层错误处理，避免单次抛出崩进程
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaughtException → graceful shutdown');
  gracefulShutdown(server).finally(() => process.exit(1));
});
```

```typescript
// apps/backend/src/scheduler/jobs/qb-poll.ts （修订: 全 state 分类）
import { qb } from '../../downloader/qbittorrent';
import { prisma } from '../../lib/prisma';

const STALLED_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export async function pollQbittorrent() {
  // 修订: 不带 filter，全量分类
  const torrents = await qb.getAllTorrents();

  for (const t of torrents) {
    const task = await prisma.downloadTask.findUnique({ where: { infoHash: t.hash.toUpperCase() } });
    if (!task) continue;

    if (isCompleted(t)) {
      await prisma.downloadTask.update({ where: { id: task.id }, data: { status: 'COMPLETED', completedAt: new Date(), qbStateRaw: t.state } });
      await importQueue.push({ id: task.id });
    } else if (t.state === 'error' || t.state === 'missingFiles') {
      // 修订: 失败态显式处理
      await prisma.downloadTask.update({ where: { id: task.id }, data: { status: 'ERROR', qbStateRaw: t.state } });
      await notify({ text: `任务失败: ${task.rawTitle} (${t.state})` });
    } else if (t.state === 'stalledDL') {
      // 修订: stalledDL 超时自动放弃
      const since = task.stalledSince ?? new Date();
      if (!task.stalledSince) {
        await prisma.downloadTask.update({ where: { id: task.id }, data: { stalledSince: since } });
      } else if (Date.now() - since.getTime() > STALLED_THRESHOLD_MS) {
        await abandonTask(task);   // removeTorrent(hash,false) + 清 MagnetSeen.invalidated=true
      }
    }
  }
}

function isCompleted(t: any) {
  return ['uploading', 'pausedUP', 'stoppedUP', 'stalledUP', 'checkingUP'].includes(t.state) || t.progress === 1;
}

async function abandonTask(task: any) {
  await qb.removeTorrent(task.hash, false);   // 不删数据
  await prisma.downloadTask.update({ where: { id: task.id }, data: { status: 'ABANDONED' } });
  // 修订: 清 MagnetSeen 允许换源/降级重下
  await prisma.magnetSeen.updateMany({ where: { infoHash: task.infoHash }, data: { invalidated: true } });
}
```

```typescript
// apps/backend/src/scheduler/queues.ts （修订: task id ↔ JobRun.id 映射）
import Queue from 'better-queue';
import { prisma } from '../lib/prisma';

const expBackoff = (n: number) => Math.min(30_000, 1000 * 2 ** n) + Math.random() * 1000;

// 修订: 显式 task id 提取器，让 better-queue 用 JobRun.id 去重
const jobId = (input: { id: string }) => input.id;

export const importQueue = new Queue(runImportTask, {
  concurrent: 1, maxRetries: 5, retryDelay: expBackoff, id: jobId,
});

export const aiScrapeQueue = new Queue(runScrapeTask, {
  concurrent: 1, maxRetries: 3, retryDelay: expBackoff, id: jobId,
  precondition: async (cb) => cb(null, await checkBudget() && await llmReachable()),
});
```

```typescript
// apps/backend/src/scheduler/shutdown.ts （修订: 正确的 drain Promise）
import type { Server } from 'bun';
import { rssFetchQueue, aiScrapeQueue, qbittorrentQueue, importQueue } from './queues';
import { prisma } from '../lib/prisma';
import { logger } from '../logger';

// 修订: 手动包 Promise，因为 better-queue 的 .on('drain') 返回 EventEmitter 而非 Promise
function waitForDrain(q: Queue): Promise<void> {
  return new Promise((resolve) => {
    q.on('drain', () => resolve());
  });
}

export async function gracefulShutdown(server: Server) {
  logger.info('graceful shutdown starting');
  // 1. 停止取新任务
  rssFetchQueue.pause();
  aiScrapeQueue.pause();
  qbittorrentQueue.pause();
  importQueue.pause();

  // 2. 等 in-flight（上限 30s）
  await Promise.race([
    Promise.all([
      waitForDrain(rssFetchQueue),
      waitForDrain(aiScrapeQueue),
      waitForDrain(qbittorrentQueue),
      waitForDrain(importQueue),
    ]),
    new Promise((r) => setTimeout(r, 30_000)),
  ]);

  // 3. 把仍 running 的 JobRun 改回 queued，保留 checkpoint 下次启动续跑
  await reconcileShutdown();

  // 4. WAL checkpoint + 关 DB
  await prisma.$executeRaw`PRAGMA wal_checkpoint(TRUNCATE)`;
  await prisma.$disconnect();

  // 5. 关 HTTP
  await server.stop();
  logger.info('graceful shutdown done');
}
```

```typescript
// apps/backend/src/index.ts （修订: reconcile + 错误处理 + idleTimeout）
import { app } from './app';
import { gracefulShutdown } from './scheduler/shutdown';
import { reconcileStartup } from './scheduler/reconcile';
import { logger } from './logger';

const server = Bun.serve({
  port: 3000,
  fetch: app.fetch,
  idleTimeout: 120,
  maxRequestBodySize: 1024 * 1024 * 200,
});

await reconcileStartup();

let server: Bun.Server;
process.on('SIGTERM', () => { gracefulShutdown(server).finally(() => process.exit(0)); });
process.on('SIGINT',  () => { gracefulShutdown(server).finally(() => process.exit(0)); });
```

```typescript
// apps/backend/src/scheduler/reconcile.ts （修订: 幂等断点续跑）
import { prisma } from '../lib/prisma';
import { importQueue, aiScrapeQueue } from './queues';
import { stat } from 'node:fs/promises';

export async function reconcileStartup() {
  // 修订: 扫 JobRun.status ∈ {queued, running} 按 checkpoint 续跑，而非从头重跑
  const pending = await prisma.jobRun.findMany({
    where: { status: { in: ['queued', 'running'] } },
  });
  for (const job of pending) {
    const checkpoint = job.checkpoint ? JSON.parse(job.checkpoint) : {};

    if (job.kind === 'import') {
      // 修订: 重入队前先判断当前阶段
      const mf = await prisma.mediaFile.findFirst({ where: { downloadTaskId: job.payloadParsed().downloadTaskId } });
      if (mf?.libraryPath) {
        try {
          await stat(mf.libraryPath);
          // 已硬链接 → 直接进下一阶段，不重复 link
          if (!checkpoint.scraped) {
            aiScrapeQueue.push({ id: job.id });
          }
          continue;
        } catch { /* 文件不存在，重跑 */ }
      }
      importQueue.push({ id: job.id });
    } else if (job.kind === 'scrape') {
      // 修订: AI 缓存以 mediaFileId 为 key（而非文件名 hash），避免改名/续作误命中
      aiScrapeQueue.push({ id: job.id });
    } else {
      rssFetchQueue.push({ id: job.id });
    }
  }
}
```

---

## 6. API 设计（Hono 路由）

> 前缀统一 `/api`。所有路由通过 `export type AppType = typeof app` 暴露给 `hono/client`。`🔒` 需鉴权。

| Method | Path | 用途 | 状态 |
|---|---|---|---|
| POST | `/api/auth/login` | 登录 | |
| POST | `/api/auth/logout` 🔒 | 登出 | |
| **GET** | **`/api/calendar`** 🔒 | **修订新增**：代理 bgm.tv /calendar，按星期分组返回本季新番 | 新增 |
| GET | `/api/series` 🔒 | 作品列表 | |
| GET | `/api/series/:id` 🔒 | 作品详情 | |
| POST | `/api/series/search` 🔒 | Bangumi 搜索 + 落库 | |
| **GET** | **`/api/fansubs/search`** 🔒 | **修订新增**：字幕组 team_id 搜索（订阅表单下拉） | 新增 |
| GET | `/api/subscriptions` 🔒 | 订阅列表 | |
| POST | `/api/subscriptions` 🔒 | 建订阅（Zod 校验 filterRule） | |
| GET/PUT/DELETE | `/api/subscriptions/:id` 🔒 | CRUD（DELETE SetNull 保留历史） | |
| POST | `/api/subscriptions/:id/run` 🔒 | 手动触发一次 RSS 拉取 | |
| POST | `/api/subscriptions/:id/backfill` 🔒 | **修订新增**：按番回填历史 RSS 漏集 | 新增 |
| GET | `/api/subscriptions/:id/preview` 🔒 | 规则预览 | |
| GET | `/api/feed/search` 🔒 | 跨站 RSS 关键词搜索预览 | |
| GET | `/api/tasks` 🔒 | 下载任务列表 | |
| POST | `/api/tasks` 🔒 | 手动添加种子（magnet/torrent） | |
| **POST** | **`/api/tasks/:id/redownload`** 🔒 | **修订新增**：强制重新下载（跳过/清 MagnetSeen） | 新增 |
| GET | `/api/tasks/:id` 🔒 | 详情（含 qB 实时状态） | |
| POST | `/api/tasks/:id/pause` 🔒 | 暂停 | |
| POST | `/api/tasks/:id/resume` 🔒 | 恢复 | |
| POST | `/api/tasks/:id/retry` 🔒 | **修订新增**：ERROR → RETRY | 新增 |
| DELETE | `/api/tasks/:id` 🔒 | 删除（removeTorrent(hash,false) 保留数据，可选 cascadeDeleteMagnetSeen） | |
| GET | `/api/library` 🔒 | 媒体库 | |
| GET | `/api/library/:id` 🔒 | 作品库视图 | |
| POST | `/api/library/:id/rescrape` 🔒 | 重新刮削（默认跳过 REVIEWED，`force=true` 才覆盖） | |
| GET | `/api/scrape/pending` 🔒 | 待人工确认队列 | |
| POST | `/api/scrape/preview` 🔒 | 单条文件名试刮削 | |
| POST | `/api/scrape/:mediaFileId/review` 🔒 | 提交人工修正（回写 FewShotSample） | |
| **POST** | **`/api/scrape/batch-review`** 🔒 | **修订新增**：按 release_group 批量修正 | 新增 |
| **GET/POST/PUT/DELETE** | **`/api/overrides`** 🔒 | **修订新增**：EpisodeOverride CRUD | 新增 |
| GET | `/api/metadata/bangumi/search` 🔒 | 直查 Bangumi | |
| GET | `/api/metadata/tmdb/search` 🔒 | 直查 TMDB | |
| GET | `/api/qb/status` 🔒 | qBittorrent 连接状态/版本/磁盘 | |
| POST | `/api/qb/connect` 🔒 | 测试连接 | |
| GET | `/api/qb/torrents` 🔒 | 直透 qB 列表 | |
| GET | `/api/settings` 🔒 | 配置（脱敏） | |
| PUT | `/api/settings` 🔒 | 更新配置（敏感字段 enc: 加密，密钥从 ENCRYPTION_KEY 派生） | |
| GET | `/api/jobs` 🔒 | JobRun 审计列表 | |
| POST | `/api/jobs/:kind/run` 🔒 | 手动触发 | |
| POST | `/api/admin/library/scan` 🔒 | 触发 Jellyfin/Emby 扫描 | |
| **GET** | **`/api/metrics`** 🔒 | **修订新增**：队列深度 / 抓取成功率 / qB 状态 / AI 调用次数与费用 / 磁盘占用 | 新增 |
| GET | `/api/health` | **修订**：liveness（进程在）| |
| **GET** | **`/api/health?ready=1`** | **修订新增**：readiness（DB 连通 + qB 连通 + LLM 可达） | 新增 |

```typescript
// apps/backend/src/app.ts （节选）
const api = new Hono()
  .use('*', logger())
  .use('*', errorHandler())
  .route('/feed', feed)
  .route('/calendar', calendar)         // 修订新增
  .route('/fansubs', fansub)            // 修订新增
  .use('*', authMiddleware)
  .route('/subscriptions', subscription)
  .route('/tasks', task)
  .route('/library', library)
  .route('/scrape', scrape)
  .route('/metadata', metadata)
  .route('/qb', qbittorrent)
  .route('/settings', settings)
  .route('/jobs', job)
  .route('/overrides', override)        // 修订新增
  .route('/metrics', metrics);          // 修订新增

export const app = new Hono()
  .use('/api/*', cors({ origin: ['http://localhost:5173'], credentials: true }))
  .route('/api', api);

export type AppType = typeof app;
```

---

## 7. 前端设计

### 7.1 页面结构（修订：6 大模块 + 仪表盘）

| 路由 | 页面 | 主要组件 |
|---|---|---|
| `/` | 仪表盘 | 今日更新（按 airWeekday）、活跃任务数、磁盘占用、近期完成、**PendingScrape 队列长度告警** |
| **`/calendar`** | **修订新增：放送日历** | 按星期分组的本季新番卡片墙 + 一键订阅（默认 fansub=ANi、1080p） |
| `/subscriptions` | 订阅列表 | 表格 + 新建 + 启用开关 |
| `/subscriptions/new` `/subscriptions/$id` | 订阅表单 | **fansub 联动下拉（来自 /api/fansubs/search）**、分辨率、关键词、黑名单、**语言偏好**、规则预览 |
| `/tasks` | 下载任务 | 表格 + 状态过滤（含 ERROR/ABANDONED）+ 添加/暂停/重试/删除/强制重下 |
| `/library` | 媒体库 | 已刮削剧集网格（海报墙） |
| `/library/$id` | 作品详情 | 季/集结构 + 绝对集映射可视化对照（文件名绝对集 ↔ SxxExx ↔ Bangumi ep，异常高亮）+ **EpisodeOverride 编辑** |
| `/scrape` | 待人工确认 | 列表 + 内联回写 few-shot + **批量编辑（按 release_group 分组）** |
| `/settings` | 设置 | 站点/AI（含阈值可配）/qB/Jellyfin/cron 子 tab |

### 7.2 数据获取（同初稿，略）

```typescript
// apps/web/src/lib/api.ts
import { hcWithType } from '@shikigami/backend/client';
export const api = hcWithType('/api');
```

### 7.3 关键交互

- **修订：放送日历一键导入**：`/calendar` 卡片墙点击"订阅"直接生成 Subscription，回填 Series.airWeekday 给仪表盘"今日更新"。
- **订阅规则预览**：表单填一半时调 `/api/subscriptions/:id/preview`，实时显示命中。
- **刮削人工确认 + 批量**：`/scrape` 列表项展开内联表单，显示 raw_tokens + AI 输出，用户改字段后 `/api/scrape/:id/review`；**支持按 release_group 批量修正 season/episode 映射**。
- **绝对集映射可视化 + 覆盖编辑**：作品详情页表格展示三列对照，异常高亮，用户可手动加 EpisodeOverride。
- **修订：仪表盘 PendingScrape 告警**：队列长度 >50 时显眼提示。

---

## 8. 配置与密钥管理

### 8.1 环境变量（修订）

```bash
# ===== 运行时 =====
TZ=Asia/Shanghai
PORT=3000
DATABASE_URL=file:/data/shikigami.db       # 修订: 与 schema.prisma/compose 三处对齐
LOG_LEVEL=info

# ===== 鉴权 =====
JWT_SECRET=<32+ bytes random>              # 仅用于内部 token 签名
ENCRYPTION_KEY=<32 bytes random>           # 修订新增: 独立主密钥, 用于 Settings 加密 (与 JWT_SECRET 分离)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<bcrypt hash>

# ===== AI（OpenAI 兼容；可指 Ollama http://host:11434/v1） =====
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
LLM_REVIEW_THRESHOLD=0.7                   # 修订新增: 进人工队列的阈值（本地模型建议 0.8）
LLM_DAILY_BUDGET_USD=1.0                   # 修订新增: 单日 LLM 费用上限（熔断）

# ===== qBittorrent =====
QBT_BASE_URL=http://qbittorrent:8080
QBT_USERNAME=admin
QBT_PASSWORD=adminadmin
QBT_API_KEY=                               # v5.2+ 优先
QBT_CATEGORY_DEFAULT=动漫
QBT_SAVEPATH_ROOT=/downloads
QBT_STALLED_TIMEOUT_HOURS=24               # 修订新增: stalledDL 放弃阈值

# ===== Jellyfin / Emby =====
MEDIA_SERVER_TYPE=jellyfin                  # jellyfin|emby（决定 JELLYFIN/EMBY 哪组生效）
JELLYFIN_BASE_URL=http://jellyfin:8096
JELLYFIN_API_KEY=
EMBY_BASE_URL=http://emby:8096
EMBY_API_KEY=

# ===== Bangumi =====
BANGUMI_ACCESS_TOKEN=                       # 可选; 有 token 可见 NSFW/完整摘要
BANGUMI_USER_AGENT=lonzzi/shikigami (https://github.com/lonzzi/shikigami)

# ===== TMDB =====
TMDB_API_KEY=
TMDB_LANGUAGE=zh-CN

# ===== 媒体库路径 =====
LIBRARY_ROOT=/media/library                 # 修订: 与 /downloads 同文件系统; Jellyfin 只挂此目录避免扫到 downloads
DOWNLOADS_ROOT=/downloads

# ===== 调度（修订: cron 格式启动校验，错格式 fail-fast） =====
RSS_SYNC_INTERVAL=*/15 * * * *
QB_POLL_INTERVAL_SECONDS=30

# ===== 通知 =====
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
WECHAT_WORK_WEBHOOK_KEY=

# ===== HTTP 代理 =====
HTTPS_PROXY=
```

### 8.2 密钥存储（修订）

- **修订**：敏感字段加密**主密钥从独立的 `ENCRYPTION_KEY` 派生**（不再用 JWT_SECRET，避免密钥复用——任何能验证 JWT 的人都能解 Settings 的安全漏洞）。
- `.env` 仅首次引导；UI 修改后落 Settings 表。
- **优先级**：Settings 表 > `.env` > 内置默认值。
- 生产推荐 Docker secrets（`_FILE` 后缀变量）。

---

## 9. Docker Compose 编排（修订）

```yaml
# docker-compose.yml （修订: healthcheck + stop_grace_period + condition + 路径收窄）
services:
  backend:
    build: { context: ., dockerfile: Dockerfile }
    image: shikigami:latest
    container_name: shikigami
    restart: unless-stopped
    user: "1000:1000"                          # 修订: 与 qB/jellyfin 统一 uid，硬链接权限打通
    stop_grace_period: 35s                     # 修订: 略大于内部 30s 优雅关闭上限
    environment:
      TZ: Asia/Shanghai
      DATABASE_URL: file:/data/shikigami.db
    env_file: .env
    volumes:
      - ./data:/data
      - /mnt/media:/media                      # host 同一文件系统
      - /mnt/media/downloads:/downloads        # qB 也挂同 host 目录（同 inode 边界）
    ports: [ "3000:3000" ]
    depends_on:
      qbittorrent:
        condition: service_healthy             # 修订: 等 WebUI ready，不止容器启动
    healthcheck:                               # 修订新增
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks: [shikigami]

  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: shikigami-qbittorrent
    restart: unless-stopped
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: Asia/Shanghai
      WEBUI_PORT: "8080"
    volumes:
      - /mnt/media/downloads:/downloads
      - ./qbittorrent-config:/config
    ports:
      - "${QBT_WEBUI_PORT:-8080}:8080"          # 修订: 变量化同步
      - "${QBT_BT_PORT:-6881}:6881"
      - "${QBT_BT_PORT:-6881}:6881/udp"
    healthcheck:                                # 修订新增
      test: ["CMD", "curl", "-sf", "http://localhost:8080/api/v2/app/version"]
      interval: 30s
      timeout: 5s
      retries: 5
    networks: [shikigami]

  jellyfin:
    image: lscr.io/linuxserver/jellyfin:latest
    container_name: shikigami-jellyfin
    restart: unless-stopped
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: Asia/Shanghai
    volumes:
      # 修订: 收窄到 /mnt/media/library，避免扫到 /mnt/media/downloads
      - /mnt/media/library:/media:ro
      - ./jellyfin-config:/config
    ports: [ "8096:8096" ]
    healthcheck:                                # 修订新增
      test: ["CMD", "curl", "-sf", "http://localhost:8096/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks: [shikigami]

networks:
  shikigami: { driver: bridge }
```

```dockerfile
# Dockerfile （修订: build 与 CMD 一致 + 精简 + entrypoint migrate）
FROM oven/bun:1.3 AS web-build
WORKDIR /app
COPY pnpm-workspace.yaml package.json ./
COPY apps/web ./apps/web
RUN bun install
RUN bun --filter @shikigami/web build

FROM oven/bun:1.3 AS backend-build
WORKDIR /app
COPY . .
COPY --from=web-build /app/apps/web/dist ./apps/backend/public
RUN bun install --production
RUN bun --filter @shikigami/backend prisma generate
# 修订: 二选一, 这里用 bun build 产物
RUN bun build apps/backend/src/index.ts --target=bun --outdir dist

FROM oven/bun:1.3 AS runtime
WORKDIR /app
USER 1000:1000                                  # 修订: 与 qB/jellyfin 统一 uid
# 修订: 精简拷贝 — dist + generated + migrations + public + production deps
COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/generated ./generated
COPY --from=backend-build /app/apps/backend/prisma ./prisma
COPY --from=backend-build /app/apps/backend/public ./public
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
# 修订: entrypoint 先跑 prisma migrate deploy 再启 bun
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "dist/index.js"]             # 修订: CMD 跑 dist 产物，与 build 一致
```

```bash
# docker-entrypoint.sh （修订新增）
#!/bin/sh
set -e
# 修订: 生产用 migrate deploy（非交互），首次启动 / 升级自动迁移
bunx prisma migrate deploy --schema ./prisma/schema.prisma
exec "$@"
```

**关键约束（修订）**：

- host 目录树对照表：

| host 路径 | backend 容器内 | qB 容器内 | jellyfin 容器内 | 用途 |
|---|---|---|---|---|
| `/mnt/media/downloads` | `/downloads` | `/downloads` | — | qB savepath（硬链接源） |
| `/mnt/media/library` | `/media/library` | — | `/media`（ro） | 媒体库（硬链接目标） |
| `/var/lib/shikigami/data` | `/data` | — | — | SQLite DB |

- 三容器统一 `PUID/PGID=1000`，**backend 用 `USER 1000:1000`** 落实（修订）。
- qB `web_ui_host_header_validation` 默认开 → 前端不可直连，靠后端 BFF 转发。
- `/mnt/media/library` 才是 Jellyfin 挂载点，避免扫到 `/mnt/media/downloads` 污染库（修订）。

---

## 10. 实现路线图（修订）

### 阶段 0：脚手架（1-2 天）
同初稿。新增：pino 日志、`/api/health` + `/api/health?ready=1` 分级。

### 阶段 1：MVP 完整链路（5-7 天，单站单番）
**修订**：
- 抓取层 dmhy **sort_id=1**（动画主分类，每周单集），实测确认 RSS 真的能抓到当周新番（不再用 sort_id=2）。
- 硬链接 EEXIST 冲突处理 + path sanitize 必做。
- prisma migrate deploy entrypoint 跑通。
- 失败态（ERROR）检测与 Telegram 告警。

**判定**：《葬送的芙莉莲》跑通"订阅→下载→硬链接→重命名→Jellyfin 出现该集"；中途 `docker compose restart backend` 任务自动续跑（reconcile 按 checkpoint）。

### 阶段 2：AI 刮削 + 元数据（5-7 天）
**修订**：
- AI 刮削用**自建 confidence**（不依赖 anitomy 自带）。
- ScrapeCache + 预算熔断 + LlmCall 记账。
- 交叉验证（AI title 必须能 Bangumi 搜索召回）。
- 放送日历 `/api/calendar` + 一键订阅。
- EpisodeOverride + REVIEWED/LOCKED 状态机。
- 绝对集映射函数**单测覆盖** S1/S2/S3 首尾集边界。

**判定**：50 条 dmhy 真实标题，云端模型 confidence≥0.7 命中率 ≥80%（**本地模型用 0.8 阈值，单独验收**）；低置信度全进人工队列；rescrape 默认跳过 REVIEWED。

### 阶段 3：多站 + 订阅引擎（4-5 天）
**修订**：
- 字幕组 team_id 发现链路（fansub search）。
- nyaa 不依赖分类号定向（关键词 + 语言检测）。
- EpisodeDedup 合集/单集二级去重。
- 双语/外挂字幕/字体处理。
- RSS 漏集回填。

### 阶段 4：调度健壮性 + 可观测性（3-4 天，修订扩展）
- better-queue 多队列 + **正确的 drain Promise 优雅关闭**。
- 启动 reconcile 按 checkpoint 断点续跑。
- **pino 结构化日志 + /api/metrics 仪表盘数据**。
- 失败熔断 + Telegram 通知 + PendingScrape 堆积告警。
- v4/v5 qB 完成态双兼容。

### 阶段 5：前端完整化（5 天）
同初稿。新增：放送日历页、EpisodeOverride 编辑、批量人工确认。

### 阶段 6：打磨与加固（持续）
- OpenAPI 文档。
- 单元测试（解析器/映射器/匹配规则，覆盖率 ≥80%）。
- **SQLite 备份方案**（`sqlite3 .backup` 在线热备，停机 cp 三件套）。
- README（含合规声明：仅公开 RSS、不绕验证码、不分发种子本体、用户自负合规责任）。

---

## 11. 风险与权衡（修订）

| 风险 | 影响 | 缓解 / 权衡 |
|---|---|---|
| **AI 误识别** | 错误重命名污染 Jellyfin 库（NFO 本地优先无法纠错） | 三段式 + 字段完整度评分（anitomy 自带无 confidence）；强制输出 `confidence`+`needs_review`；交叉验证（AI title 必须 Bangumi 召回）；<阈值进人工队列，**绝不**自动重命名；REVIEWED/LOCKED 默认 rescrape 跳过；人工修正回写 FewShotSample（带上限 + LRU + 冲突校验）。 |
| **绝对集映射无标准答案** | TMDB season/episode 与粉丝绝对集冲突；split-cour 双流派 | 双源（Bangumi sort/ep + TMDB episode_groups）；`seasonOffset`（**每季首集 abs，1-based**）+ `courMode: split\|absolute` 开关 + **EpisodeOverride 用户覆盖权威优先**；修正 mapAbsoluteToSeason 算法（`>=` 比较 + 当前季 offset 作 firstAbsOfSeason）；单测覆盖首尾集；可视化对照便于纠错。 |
| **OpenAI 专属能力被当通用**（strict json_schema / prompt caching 在 Ollama/第三方不可用） | 静默降级到不可靠 json_object，结构化输出失效 | 标注"仅 OpenAI 官方端点保证"；能力探测带 TTL（每小时或连续失败 3 次重探）；降级路径明确（json_object + 强约束 system + 完整 schema 拼接 + Zod 兜底）；区分"模型不确定"与"输出非 JSON"两种 needs_review 语义。 |
| **prompt caching 实际不省 90%** | 单次刮削前缀刚到 1024 token 阈值边缘；schema 拼接脆性 | 删除乐观描述，改为"OpenAI 端点少量缓存折扣"；schema hash 固定；真正省成本的杠杆是 **ScrapeCache 文件名指纹缓存** + 预算熔断。 |
| **站点反爬/封 IP** | 抓取失败、漏集 | RSS 优先；每站独立令牌桶 + 单站全局并发=1（**所有订阅的 dmhy 抓取合并到一次 cron**）；熔断（连续 3 次 403 → 该站冷却 60min + Telegram 告警）；mikan 镜像可配；只抓公开 RSS。 |
| **qBittorrent 做种与重命名冲突** | rename/setTorrentLocation 打断做种；removeTorrent(hash,true) 连媒体一起删 | 硬链接；同文件系统（EXDEV → copy 磁盘翻倍强警告）；EEXIST 显式 stat 比 inode 幂等；做种达标后只 removeTorrent(hash,false)。 |
| **下载失败/卡死永不检测** | 死种永远停在 DOWNLOADING，用户无感知，MagnetSeen 阻止换源 | **全 state 轮询**：error/missingFiles → ERROR + 告警；stalledDL 超阈值 → ABANDONED + 清 MagnetSeen.invalidated 允许换源/降级；磁盘预检（free space vs sizeBytes，不足标 PENDING_DISK_FULL）。 |
| **合集/批量包处理** | 一个种含 N 集，单文件刮削拿不到每集信息；合集与单集撞集 | 导入阶段**种子内容枚举** fan-out 多 MediaFile；合集先解析包标题确定 series+季，再按文件名/顺序分配集号；**EpisodeDedup (seriesId,seasonIndex,epInSeason) 二级去重**。 |
| **双语/字幕/字体处理** | 双语版本撞名 EEXIST；外挂字幕不跟随正片 Jellyfin 不挂载；字体显示方块 | AnimeMeta 加 subtitle_lang/audio_lang；Subscription 加 preferredLang；buildLibraryPath 加语言后缀；字幕 `<basename>.<lang>.<ext>`；MediaFile.kind 分流；字体归 Fonts 目录。 |
| **SP/OVA/剧场版库结构** | OVA/movie 落 Season 文件夹错误 | 按 episode_type 分流：normal→Season XX/SxxExx；special/ova→Season 00；movie→独立 Movie 目录；mapAbsoluteToSeason 仅对 normal 生效。 |
| **路径特殊字符** | `:` `?` `*` `\|` `/` `<` `>` `"` 拆目录或 SMB/NTFS 出错 | sanitizePathSegment() 在 mkdir 前强制执行；trim 首尾点和空格；限长。 |
| **人工覆盖无处持久化 / 会被重刮覆盖** | 用户修正的字段被一次 rescrape 冲掉 | EpisodeOverride 表权威优先；MediaFile.scrapeState 加 REVIEWED/LOCKED；rescrape 默认跳过，force=true 才覆盖；Series.lockedAt 锁定后元数据刷新仅补缺。 |
| **reconcile 重跑副作用** | 重启重复硬链接（EEXIST）+ 重复消耗 AI token | EEXIST stat 比 inode 幂等；AI 缓存以 mediaFileId 为 key（**不**用文件名 hash 避免改名/续作误命中）；JobRun.checkpoint 断点续跑；better-queue task id ↔ JobRun.id 映射不被自身去重拦截。 |
| **MagnetSeen 阻止重下** | 删任务后文件被删想重下，下次 RSS 被 MagnetSeen 拦 | DELETE task 提供 cascadeDeleteMagnetSeen 选项；`/api/tasks/:id/redownload` 强制重下；addMagnet 响应三态解析（Ok./Already added./Fails.）—— 已存在视为幂等成功而非错误。 |
| **Jellyfin/Emby 元数据来源选择** | 单源各有缺口 | Bangumi 中文主键 + 集映射；TMDB 补封面/英文/绝对集 episode groups；anime-lists.xml（AniDB→TVDB）回填 tvdbId 做 Jellyfin 匹配主路径；NFO 写 `<uniqueid>` 锁定。 |
| **tvdbId 缺失 Jellyfin 刷新失败** | refreshSeries 发空 tvdbId，文件已入库但 Jellyfin 看不到 | **三级降级链**：tvdbId → Series/Updated；缺失 → Library/Media/Updated（按 Path）；再失败 → Library/Refresh（admin）；调用失败落 JobRun.error 可重试。 |
| **Jellyfin vs Emby API 差异** | 路径前缀 / 认证头不同 | 统一 `?api_key=` query；MediaServerClient 抽象 + 两实现，差异只在 base 前缀和 header。Jellyfin 不再兼容 `/emby/` 前缀。 |
| **qB v4/v5 命名差异** | 完成态漏判 | 完成态集合同时容忍两套；@ctrl/qbittorrent enum 已列全。 |
| **Hono RPC 类型爆炸** | IDE 卡、编译慢 | strict + project references + catalog 锁同版本 + hcWithType 后端预编译。 |
| **Prisma SQLite 限制** | 脏数据、迁移失败 | 结构化字段 String + zod parse；enum 应用层校验；**生产用 migrate deploy**（entrypoint 自动跑）。 |
| **进程内 cron 单点 + 漏抓窗口** | 重启漏执行；RSS 窗口期漏集 | JobRun + checkpoint；启动 reconcile；**RSS 回填**（lastSeenPubDate gap 检测 + 按 team_id/keyword/bangumiId 抓历史）。 |
| **优雅关闭代码错误** | drain 不生效，任务丢失 | 手动包 waitForDrain Promise；compose `stop_grace_period: 35s` 略大于内部 30s 上限。 |
| **DB 迁移缺失** | 生产容器首次/升级启动失败 | docker-entrypoint.sh 跑 `prisma migrate deploy`；schema/env/compose 三处 DATABASE_URL 对齐。 |
| **密钥复用安全漏洞** | JWT_SECRET 同时用于 token 签名和 Settings 加密，能验证 JWT 者可解 Settings | 独立 `ENCRYPTION_KEY`；Settings 加密从 ENCRYPTION_KEY 派生。 |
| **可观测性缺失** | 夜里出错只能 ssh 看 console | pino 结构化日志；/api/health liveness + readiness 分离；/api/metrics 聚合（队列/抓取/qB/AI 成本/磁盘）；PendingScrape 堆积告警；熔断告警。 |
| **SQLite WAL 备份丢事务** | 强制 kill 后 `-wal` 残留，备份只拷 db 丢数据 | 优雅关闭 `PRAGMA wal_checkpoint(TRUNCATE)`；备份用 `sqlite3 .backup` 在线热备。 |
| **PUID/PGID 不一致硬链不通** | backend root 创建的 libraryPath jellyfin(1000) 读不了 | 三容器统一 uid=1000，backend `USER 1000:1000`。 |
| **法律合规** | 项目被定性侵权工具 | 只抓公开 RSS/页面，不绕登录墙/验证码/CF；不缓存/分发种子本体；遵守 robots.txt；README 明确免责。 |
| **Telegram 国内网络** | 通知失效 | HTTPS_PROXY 可选；企业微信群机器人 webhook 国内备选。 |
| **Bangumi NSFW 内容** | 无 token 时部分封面/摘要裁剪 | Settings 可配 BANGUMI_ACCESS_TOKEN；前端标注 nsfw 让用户选择是否显示。 |

---

### 附：关键 API 端点速查（修订）

| 服务 | 端点 | 要点 |
|---|---|---|
| **dmhy 动画主分类** | `GET https://share.dmhy.org/topics/list/sort_id/1/rss.xml` | **修订：sort_id=1=動畫**（每周单集），enclosure.url=magnet |
| dmhy 季度合集 | `GET https://share.dmhy.org/topics/list/sort_id/2/rss.xml` | sort_id=2=季度合集（补充） |
| dmhy 关键词 | `GET https://share.dmhy.org/topics/rss/rss.xml?keyword={ENC}` | |
| **dmhy 字幕组** | `GET https://share.dmhy.org/topics/list/team_id/{id}/rss.xml` | **修订：路径用 /list/team_id/**；team_id 需 HTML 解析 |
| mikan 列表 | `GET https://mikanani.me/RSS/Classic` | enclosure=.torrent，需 webtorrent 解析 |
| nyaa 搜索 | `GET https://nyaa.si/?page=rss&q={q}&c=1_3&f=0&s=seeders&o=desc` | nyaa:infoHash 拼 magnet；**修订：c=1_3=Non-English（非"中文"），中文定向靠关键词+语言检测** |
| bangumi.moe | `GET https://bangumi.moe/rss/latest` | 仅 .torrent，无 magnet |
| **Bangumi 放送日历** | `GET https://api.bgm.tv/calendar` | **修订新增**：按星期返回本季新番 |
| Bangumi 搜索 | `POST https://api.bgm.tv/v0/search/subjects` body `{keyword,sort:'match',filter:{type:[2]}}` | 强制描述性 UA，≤1 req/s |
| Bangumi 集表 | `GET https://api.bgm.tv/v0/episodes?subject_id={id}&type=0&limit=200&offset=0` | ep=条目内, sort=全局 |
| Bangumi 关系 | `GET https://api.bgm.tv/v0/subjects/{id}/subjects` | 多季串联 |
| TMDB 季 | `GET https://api.themoviedb.org/3/tv/{id}/season/{n}?language=zh-CN` | Bearer |
| TMDB 绝对集 | `GET https://api.themoviedb.org/3/tv/{id}/episode_groups` | absolute order |
| **anime-lists.xml** | `https://raw.githubusercontent.com/AnimeLib/anime-lists/master/anime-list-master.xml` | **修订新增**：AniDB→TVDB 映射，回填 Series.tvdbId |
| qB 登录 | `POST /api/v2/auth/login` | v5.2+ 用 Bearer API Key |
| qB 加种 | `POST /api/v2/torrents/add` | **修订：响应 "Ok."/"Already added."/"Fails." 三态**，已存在视为幂等成功 |
| qB 列表 | `GET /api/v2/torrents/info` | **修订：不带 filter 全量分类**（含 error/stalledDL） |
| qB 删除 | `POST /api/v2/torrents/delete` | deleteFiles=**false** |
| qB 主数据 | `GET /api/v2/sync/maindata` | server_state.free_space 做磁盘预检 |
| Jellyfin 增量 | `POST /Library/Series/Updated?tvdbId={id}` | tvdbId 存在时首选 |
| Jellyfin 路径 | `POST /Library/Media/Updated` body `{Updates:[{Path}]}` | tvdbId 缺失降级 |
| Jellyfin 全量 | `POST /Library/Refresh` | 再降级（admin） |
| Telegram | `POST https://api.telegram.org/bot{token}/sendMessage` | 国内需代理 |

---

## 12. 评审修订记录

本文档吸收了 4 个视角对抗性评审中的全部 **critical** 与 **important** 问题（及部分 high-value **minor**）。逐项落点如下。

### Completeness（完整性与边界情况）

- **C1 硬链接 EEXIST 未处理**（critical）→ 5.3 `importFile` 改为显式 stat 比 inode（同 inode 跳过幂等，不同 inode 走 suffix/reject 冲突策略）；MediaFile 加 `@@unique([seriesId, libraryPath])` 落库拦截。
- **C2 mapAbsoluteToSeason 算法错误**（critical）→ 5.3 重写：`>=` 比较 + 取"当前季自己 offset"作 firstAbsOfSeason；明确 seasonOffset 语义为"每季首集 abs（1-based）"；附 S1/S2/S3 首尾集单测用例。
- **C3 下载失败/卡死态永不检测**（critical）→ 5.4 `pollQbittorrent` 改为不带 filter 全量分类：error/missingFiles→ERROR+告警；stalledDL 超 24h→ABANDONED+清 MagnetSeen；DownloadTask.status 状态机扩展 ERROR/ABANDONED/PENDING_DISK_FULL/RETRY；新增 `/api/tasks/:id/retry`、`/redownload`。
- **C4 人工覆盖无持久化 / 会被重刮覆盖**（critical）→ 新增 `EpisodeOverride` 表（seriesId, absoluteNumber, season, episode, source）作为 mapAbsoluteToSeason 权威来源；MediaFile.scrapeState 加 REVIEWED/LOCKED；rescrape 默认跳过 REVIEWED，force=true 才覆盖；Series.lockedAt 锁定后元数据刷新仅补缺；新增 `/api/overrides` CRUD。
- **C5 合集/批量包解析缺失**（critical）→ 导入阶段新增"种子内容枚举"（`enumerateContent`）fan-out 多 MediaFile；合集先解析包标题定 series+季，再按文件名/顺序分配集号；新增 `EpisodeDedup` 表（seriesId, seasonIndex, epInSeason）做合集/单集二级去重（MagnetSeen 按 infoHash 拦不住撞集）。
- **I6 双语/多语言维度缺失**（important）→ Torrent 加 subtitleLang；AnimeMeta 加 subtitle_lang/audio_lang；Subscription.filterRule 加 preferredLang；buildLibraryPath 加语言后缀避免撞名。
- **I7 外挂字幕/字体处理缺失**（important）→ MediaFile 加 kind 枚举（video/subtitle/font/other）；字幕 `<basename>.<lang>.<ext>` 跟随正片；字体归 Fonts 目录；buildLibraryPath 按 kind 分流。
- **I8 tvdbId 缺失 Jellyfin 刷新无降级**（important）→ 新增 anime-lists.xml 模块回填 tvdbId；JellyfinClient 三级降级链（Series/Updated → Media/Updated → Library/Refresh）；调用失败落 JobRun.error 可重试。
- **I9 reconcile 缺副作用防护**（important）→ JobRun.checkpoint 断点续跑（非从头重跑）；重入队前 stat 判断阶段；AI 缓存以 mediaFileId 为 key（非文件名 hash）；better-queue task id ↔ JobRun.id 显式映射。
- **I10 buildLibraryPath E00 非法文件名**（important）→ 入口断言 epInSeason 非空，空则抛错进人工队列；SP/OVA/movie 按 type 分流（movie 走独立目录）。
- **I11 文件名特殊字符未 sanitize**（important）→ 新增 `sanitizePathSegment()`，替换非法字符、trim、限长，在 mkdir 前强制执行。
- **I12 MagnetSeen 阻止重下 + addMagnet 响应未解析**（important）→ MagnetSeen 加 invalidated 软删字段；DELETE task 提供 cascadeDeleteMagnetSeen；`/api/tasks/:id/redownload` 强制重下；addMagnet 响应三态解析（Ok./Already added./Fails.，已存在视为幂等成功）。
- **I13 SP/OVA/movie 库结构只处理 type===1**（important）→ buildLibraryPath 按 episode_type 分流：normal→Season XX；special/ova→Season 00；movie→Movies；mapAbsoluteToSeason 明确仅对 normal 生效。
- **I14 few-shot 池未设计**（important）→ 新增 FewShotSample 表（filename, output, releaseGroup, titleKey, reviewStatus）；retrieveFewShot 按 group LRU 检索（每组 ≤3，总池 ≤500 FIFO 淘汰）；回写经冲突校验；标注阶段 6 落地。
- **M15 磁盘预检缺失**（minor）→ 新增 diskcheck.ts，addMagnet 前调 /sync/maindata 比对 free_space vs sizeBytes；不足标 PENDING_DISK_FULL；stalledDL 超时计数器。
- **M16 RSS 回填缺失**（minor）→ Subscription 加 lastSeenPubDate；gap 检测（当前 RSS 最早 pubDate > lastSeenPubDate + 容差）触发 backfill；新增 `/api/subscriptions/:id/backfill`。

### Anime-fit（动漫生态契合度）

- **C1 dmhy sort_id 错误**（critical）→ sort_id=1=動畫（每周单集，主用），sort_id=2=季度合集（补充）；fetchLatest 接受 category 参数化；附表修正。
- **C2 anitomy 无 confidence 字段**（critical）→ 新增 `confidence.ts` 基于"字段完整度"自建评分（anitomy/regex 共用）；快路径严格（必须同时 release_group+episode+title 且非中英混名才直通），其余一律送 AI 仲裁。
- **I3 nyaa 分类号误读**（important）→ 修正表述：1_3=Non-English（含中文但也含日文）；中文定向靠关键词 + 标题语言检测，不依赖分类号。
- **I4 字幕组 RSS 路径错 + team_id 获取缺失**（important）→ 路径改 `/topics/list/team_id/{id}/rss.xml`；新增 `scrapers/fansub.ts` 提供 team_id 发现（HTML 解析）；新增 `/api/fansubs/search`，订阅表单做联动下拉禁止手填。
- **I5 放送日历/新番发现缺失**（important）→ 新增 `/api/calendar` 代理 bgm.tv /calendar；前端 `/calendar` 卡片墙一键订阅；Series.airWeekday 从 calendar 回填给仪表盘"今日更新"。
- **I6 AI 生成罗马音不一致**（important）→ AnimeMeta 删除 title_ro/title_cn/title_en 输出字段，改为 `title_hint`（仅供识别）；权威标题三态一律 Bangumi/TMDB 回填。
- **I7 绝对集映射 bug + cour 模式开关**（important）→ 同 completeness C2；新增 Series.courMode: split|absolute 开关。
- **I8 外挂字幕/字体处理**（important）→ 同 completeness I7。
- **M9 Bangumi NSFW 处理**（minor）→ Settings 可配 BANGUMI_ACCESS_TOKEN；前端标注 nsfw。
- **M10 DMHY 限流矛盾**（minor）→ 统一 dmhy 单站全局并发=1；所有订阅 dmhy 抓取合并到一次 cron；熔断：连续 3 次 403 → 冷却 60min + 告警；调度表与代码注释数字对齐。

### AI-cost（AI 质量与成本）

- **C1 OpenAI 专属能力被当通用**（critical）→ 标注 strict json_schema / prompt caching 仅 OpenAI 官方保证；能力探测改带 TTL（每小时或连续失败 3 次重探）；Ollama 等降级路径明确（json_object + 强约束 system + Zod 兜底）；区分"模型不确定"与"输出非 JSON"两种 needs_review 语义。
- **I2 prompt caching 失效 + 90% 描述夸张**（important）→ 删除"省 90% 输入费"说法；schema 拼接做 hash 固定保前缀稳定；明确真正杠杆是减少调用次数（ScrapeCache）。
- **I3 文件名级缓存缺失**（important）→ 新增 ScrapeCache 表（fingerprint, result, model, promptTokens, completionTokens, costUsd）；归一化 fingerprint（去 CRC/分辨率/版本号差异）；aiScrapeQueue 加预算/速率双熔断（LLM_DAILY_BUDGET_USD）；新增 LlmCall 记账表。
- **I4 三段 confidence 不可比**（important）→ 同 anime-fit C2；anitomy/regex 的产出作为"预解析提示"传给 AI，不直接判定采用；保留快路径但严格条件。
- **I5 few-shot 回写机制缺失 + 污染风险**（important）→ 同 completeness I14；明确阶段 6 落地，MVP 阶段 FEWSHOT 为只读常量。
- **I6 字段级一致性无保证（title 拼写偏差高置信错误）**（important）→ 新增交叉验证：AI title_hint 必须 Bangumi 搜索召回 ≥1 且相似度 >0.6，否则强制 needs_review=true 不论 confidence。
- **I7 重试策略放大成本**（important）→ 区分错误类型：限流/网络/超时→指数退避重试；schema 违规/JSON 解析失败→不重试直接进人工队列（temp=0 下大概率重复）；max_tokens 512→1024 防 raw_tokens 截断；检查 finish_reason===length 单独处理。
- **M8 PendingScrape 缺回压**（minor）→ 队列长度监控 + Telegram 告警（>50 条）；前端批量编辑；超时未处理可选"规则引擎最佳猜测落地标 UNSURE"策略。
- **M9 本地模型兼容性**（minor）→ 标注本地模型需独立标定（建议阈值 0.8 而非 0.7）；LLM_REVIEW_THRESHOLD 按 env 可配；路线图阶段 2 区分云端/本地两套验收线。

### Ops（运维可落地性）

- **C1 优雅关闭代码错**（critical）→ 5.4 `waitForDrain` 手动包 `new Promise(res => q.on('drain', res))`；compose `stop_grace_period: 35s` 略大于内部 30s 上限。
- **C2 DB 迁移机制缺失**（critical）→ 新增 docker-entrypoint.sh 跑 `prisma migrate deploy`；schema/env/compose 三处 DATABASE_URL 统一 `file:/data/shikigami.db`；明确区分 dev（migrate dev）与 prod（migrate deploy）；generated/prisma 与 migrations 在镜像中的位置明确。
- **I3 healthcheck + depends_on 缺失**（important）→ 三服务全加 healthcheck（backend `/api/health`、qB `/api/v2/app/version`、jellyfin `/health`）；backend depends_on 改 `condition: service_healthy`；新增 `/api/health?ready=1` readiness（DB + qB + LLM 连通性）。
- **I4 密钥管理矛盾 + 安全漏洞**（important）→ 引入独立 `ENCRYPTION_KEY` 与 JWT_SECRET 分离；明确 `.env` 仅 bootstrap，Settings 表覆盖优先级；标注生产推荐 Docker secrets

（`_FILE` 变量）。
- **I5 硬链接 inode 边界 + Jellyfin 扫到 downloads**（important）→ compose 路径收窄：Jellyfin 只挂 `/mnt/media/library:/media:ro`，backend 同时挂 `/downloads` 与 `/media/library`；新增 host 目录树对照表；明确 qB category savepath 与 backend srcPath 用 `/downloads/...` 统一。
- **I6 PUID/PGID 未覆盖 backend**（important）→ backend Dockerfile 加 `USER 1000:1000`，三容器统一 uid=1000；host 目录确保 1000 读写。
- **I7 可观测性几乎为零**（important）→ 新增 pino 结构化日志（requestId / job kind / 错误码）；`/api/health` liveness 与 `/api/health?ready=1` readiness 分离；新增 `/api/metrics` 聚合（队列深度 / 抓取成功率 / qB 状态 / AI 调用次数与费用 / 磁盘占用 statvfs）；PendingScrape 堆积告警；前端仪表盘 metrics 数据对接。
- **I8 SQLite WAL 备份未交代**（important）→ 明确 WAL 模式；优雅关闭 `PRAGMA wal_checkpoint(TRUNCATE)` 后再 disconnect；路线图阶段 6 补备份方案（`sqlite3 .backup` 在线热备 / 停机 cp 三件套）。
- **I9 Dockerfile build 与 CMD 不一致**（important）→ runtime 只 COPY 必要文件（dist + generated + migrations + public + production node_modules）；CMD 改为 `bun run dist/index.js` 与 build 一致；entrypoint.sh 跑 migrate deploy。
- **M10 stop_grace_period 缺失**（minor）→ 见 C1，compose 加 35s。
- **M11 时区/cron 隐患**（minor）→ env.ts 用 zod 校验 cron 表达式格式，错格式 fail-fast；启动探测 Bun.cron 是否读 TZ，否则显式传 timezone；统一 DB 存 UTC、cron 解释本地、日志带时区。
- **M12 .env 与 compose 脱节**（minor）→ env.example 与 compose 逐项对齐；schema.prisma 注释删除 `file:./data/...` 误导；标注 MEDIA_SERVER_TYPE 决定哪组生效。
- **M13 qB 端口写死**（minor）→ ports 改 `${QBT_WEBUI_PORT:-8080}:8080` / `${QBT_BT_PORT:-6881}:6881`；文档说明改 WEBUI_PORT 须同步改映射。
- **M14 顶层错误处理 + 半成品清理**（minor）→ index.ts 加 unhandledRejection / uncaughtException 记录并优雅退出让 restart 接管；import.ts 重跑前 best-effort 清理半成品硬链；明确 scrapeState 状态机幂等性。

### 未被吸收的低优先级 minor
- 极个别风格性、文档排版类 minor 建议未逐字落入（如 UI 微文案、README 细节结构），将在阶段 6 打磨期处理，不影响架构正确性。

---

以上即最终设计文档全文。关键文件落地路径（实现期参考）：
- 数据模型：`/Users/lonzzi/workspace/shikigami/apps/backend/prisma/schema.prisma`
- 抓取层：`/Users/lonzzi/workspace/shikigami/apps/backend/src/scrapers/{dmhy,mikan,nyaa,bangumimoe,fansub,backfill}.ts`
- AI 刮削：`/Users/lonzzi/workspace/shikigami/apps/backend/src/llm/{client,schema,scrape,fewshot,cost}.ts`
- 映射算法（修正版）：`/Users/lonzzi/workspace/shikigami/apps/backend/src/metadata/mapping.ts`
- 导入与 EEXIST：`/Users/lonzzi/workspace/shikigami/apps/backend/src/downloader/import.ts`
- 调度与优雅关闭（修正版）：`/Users/lonzzi/workspace/shikigami/apps/backend/src/scheduler/{queues,shutdown,reconcile,cron}.ts`
- 部署：`/Users/lonzzi/workspace/shikigami/{Dockerfile,docker-compose.yml,docker-entrypoint.sh,.env.example}`