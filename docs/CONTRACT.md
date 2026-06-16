# 后端模块实现契约（leaf agents 必读）

> 本文件为所有并行实现 leaf 模块的 agent 提供已冻结的契约根。**只能 `import` 本文列出的符号**，不得修改 `lib/*`、`scrapers/types.ts`、`llm/schema.ts`、`media/types.ts`、`generated/prisma`。产出文件写到 `apps/backend/src/<dir>/`。

## 技术栈
- Bun 1.3 运行时，ESM，TS strict。`process.env` 已由 `lib/env.ts` 校验。
- 日志: `import { logger } from '../logger'` 或 `import { jobLogger } from '../logger'`。
- DB: `import { prisma } from '../lib/prisma'`（PrismaClient，model 名见 schema.prisma：`series/episode/subscription/downloadTask/mediaFile/magnetSeen/episodeDedup/episodeOverride/scrapeCache/fewShotSample/llmCall/settings/jobRun`）。注意 Prisma 字段为 camelCase。

## 已冻结的契约符号

### lib/env.ts
```ts
export const env: Env  // 全部字段见 src/lib/env.ts, 常用: env.LLM_BASE_URL/LLM_API_KEY/LLM_MODEL/LLM_REVIEW_THRESHOLD/LLM_DAILY_BUDGET_USD, env.QBT_*, env.LIBRARY_ROOT, env.DOWNLOADS_ROOT, env.RSS_SYNC_INTERVAL, env.QB_POLL_INTERVAL_SECONDS, env.MEDIA_SERVER_TYPE, env.JELLYFIN_*, env.EMBY_*, env.BANGUMI_ACCESS_TOKEN, env.TMDB_API_KEY, env.TELEGRAM_*
export function validateCron(expr: string): boolean
```

### lib/http.ts
```ts
export interface HttpGetOptions { method?: 'GET'|'POST'; headers?: Record<string,string>; body?: Record<string,unknown>|string; retries?: number; backoff?: 'exp'|'fixed'; onStatus?: (s:number)=>'retry'|'fail'|'circuit'; timeoutMs?: number; }
export async function httpGet(url: string, opts?: HttpGetOptions): Promise<string>  // 返回 response.text()
export class HttpError extends Error { status: number }
export class CircuitOpenError extends Error
```

### lib/circuit.ts
```ts
export function canPass(key: string, opts?): boolean
export function recordSuccess(key: string)
export function recordFailure(key: string, opts?)
export async function withCircuit<T>(key: string, fn: ()=>Promise<T>, opts?): Promise<T>
```

### lib/ratelimit.ts
```ts
export const siteLimiters: { dmhy, mikan, nyaa, bangumimoe }  // pLimit 实例, .run(async()=>...)
export async function bangumiThrottle<T>(fn: ()=>Promise<T>): Promise<T>
export const tmdbLimit
```

### lib/path.ts
```ts
export function sanitizePathSegment(name: string, maxLen?: number): string
export function extOf(fileName: string): string
export const VIDEO_EXTS, SUBTITLE_EXTS, FONT_EXTS  // Set<string>
export type FileKind = 'video'|'subtitle'|'font'|'other'
export function classifyFileKind(fileName: string): FileKind
```

### lib/cache.ts
```ts
export function normalizeFingerprint(filename: string): string  // sha256 hex
export async function getScrapeCache(fp): Promise<{result:string; model:string}|null>
export async function saveScrapeCache(fp, rawFilename, result: object, model: string, usage?: {prompt_tokens?:number; completion_tokens?:number}): Promise<void>
```

### lib/crypto.ts
```ts
export function encrypt(plain: string): string   // 'enc:iv:tag:data'
export function decrypt(payload: string): string
```

### lib/errors.ts
```ts
export class RetryableError extends Error { constructor(msg, cause?) }
export class NeedsReviewError extends Error
export class BudgetExceededError extends Error
export class ConflictError extends Error
export class HttpError extends Error { status: number }
export function isRetryable(e): boolean
```

### lib/statvfs.ts
```ts
export async function diskUsage(path: string): Promise<DiskUsage|null>  // {totalBytes,freeBytes,usedBytes,usedRatio}
```

### scrapers/types.ts
```ts
export type SiteSource = 'dmhy'|'mikan'|'nyaa'|'bangumimoe'
export interface Torrent { source; sourceItemId; title; magnet?; torrentFileUrl?; infoHash?; size?: bigint; pubDate?: Date; fansub?; subtitleLang?; category?; rawItem }
export interface SiteAdapter { readonly source: SiteSource; fetchLatest(category?): Promise<Torrent[]>; fetchByKeyword(keyword): Promise<Torrent[]>; fetchByTeam?(teamId): Promise<Torrent[]> }
export interface FilterRule { sources: SiteSource[]; keyword?; teamIds?; sortId?; resolutionMin?; fansubs?; blacklist?; preferredLang?; fallbackResolution? }
export function parseInfoHash(magnet): string|undefined
export function detectSubtitleLang(title): string|undefined
```

### llm/schema.ts
```ts
export const AnimeMetaSchema: z.ZodObject<...>
export type AnimeMeta = z.infer<typeof AnimeMetaSchema>
export function getAnimeMetaJsonSchema(): { schema: object; hash: string }
// AnimeMeta 字段: release_group(string|null), title_hint(string), season(int|null), episode(int|null), absolute_episode(int|null), episode_type('normal'|'special'|'ova'|'movie'|'web'), resolution, source, video_codec, audio_codec, subtitle_lang, audio_lang, checksum, release_date, confidence(0..1), needs_review(bool), raw_tokens?(record)
```

### media/types.ts
```ts
export interface MediaServerClient { readonly type: 'jellyfin'|'emby'; refreshSeries(series: {tvdbId?:number|null; libraryPath?:string|null}): Promise<void>; ping(): Promise<boolean> }
export interface NfoEpisode { title; season; episode; showTitle; aired?; plot? }
export interface NfoShow { title; originaltitle?; plot?; premiered?; studio?; tvdbid?; tmdbid? }
```

## 约定
- 文件顶部不要重复 import lib/env 里的具体字段——用 `env.X`。
- 函数用 JSDoc 简注意图。不要写测试文件（测试由主线统一补）。
- 遵循架构文档 `docs/ARCHITECTURE.md` 第 5 章对每个模块的设计（精确到函数签名）。如果你分配到的文件在 ARCHITECTURE.md 里有伪代码，严格对齐。
- 全部中文注释。export 出文档要求的函数名/类名/对象名。
- 不要新建 lib 下的文件，不要改 schema.prisma。
